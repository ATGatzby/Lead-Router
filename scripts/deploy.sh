#!/usr/bin/env bash
set -euo pipefail

# All-in-one deploy script for lead-routing services
# Usage: ./scripts/deploy.sh [--web] [--engine] [--all]
# Default: --all

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VPS_HOST="187.77.194.136"
VPS_USER="root"
VPS_PASS='omWiJ,;51jtC#J/j'
VPS_DIR="/root/lead-routing"

WEB_IMAGE="ghcr.io/atgatzby/lead-routing-web:latest"
ENGINE_IMAGE="ghcr.io/atgatzby/lead-routing-engine:latest"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

DEPLOY_WEB=false
DEPLOY_ENGINE=false

# Parse args
if [[ $# -eq 0 ]]; then
  DEPLOY_WEB=true
  DEPLOY_ENGINE=true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web)    DEPLOY_WEB=true; shift ;;
    --engine) DEPLOY_ENGINE=true; shift ;;
    --all)    DEPLOY_WEB=true; DEPLOY_ENGINE=true; shift ;;
    *)        echo "Unknown arg: $1"; echo "Usage: $0 [--web] [--engine] [--all]"; exit 1 ;;
  esac
done

# SSH helper using expect
ssh_cmd() {
  local cmd="$1"
  expect -c "
    set timeout 120
    spawn ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} \"$cmd\"
    expect {
      \"*assword*\" { send \"${VPS_PASS}\r\"; exp_continue }
      eof
    }
  "
}

scp_file() {
  local local_path="$1"
  local remote_path="$2"
  expect -c "
    set timeout 600
    spawn scp -o StrictHostKeyChecking=no \"$local_path\" ${VPS_USER}@${VPS_HOST}:${remote_path}
    expect {
      \"*assword*\" { send \"${VPS_PASS}\r\"; exp_continue }
      eof
    }
  "
}

WEB_OK=""
ENGINE_OK=""

deploy_service() {
  local service="$1"
  local image="$2"
  local dockerfile="$3"

  echo ""
  echo -e "${YELLOW}========================================${NC}"
  echo -e "${YELLOW}  Deploying: ${service}${NC}"
  echo -e "${YELLOW}========================================${NC}"
  echo ""

  # 1. Build
  echo -e "${YELLOW}[1/5] Building image (--no-cache --platform linux/amd64)...${NC}"
  docker buildx build --no-cache --platform linux/amd64 \
    -f "$dockerfile" -t "$image" --load "$REPO_ROOT"

  # 2. Smoke test
  echo ""
  echo -e "${YELLOW}[2/5] Running smoke test...${NC}"
  "$SCRIPT_DIR/smoke-test.sh" "$image"

  # 3. Push to GHCR (CLI pulls from here)
  echo ""
  echo -e "${YELLOW}[3/6] Pushing to GHCR...${NC}"
  docker push "$image"

  # 4. Save and SCP to VPS
  local tarball="/tmp/lead-routing-${service}.tar.gz"
  echo ""
  echo -e "${YELLOW}[4/6] Saving image and uploading to VPS...${NC}"
  docker save "$image" | gzip > "$tarball"
  echo "  Tarball: $(du -h "$tarball" | cut -f1)"
  scp_file "$tarball" "/tmp/"

  # 5. Load and restart on VPS
  echo ""
  echo -e "${YELLOW}[5/6] Loading image and restarting on VPS...${NC}"
  ssh_cmd "docker rmi ${image} 2>/dev/null || true"
  ssh_cmd "docker load < /tmp/lead-routing-${service}.tar.gz"
  ssh_cmd "cd ${VPS_DIR} && docker compose up -d --force-recreate ${service}"

  # 6. Verify
  echo ""
  echo -e "${YELLOW}[6/6] Verifying deployment...${NC}"
  local container_name="lead-routing-${service}-1"
  local created
  created=$(expect -c "
    log_user 0
    set timeout 30
    spawn ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} \"docker inspect ${container_name} --format '{{.Created}}'\"
    expect {
      \"*assword*\" { send \"${VPS_PASS}\r\"; exp_continue }
      -re {(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})} { puts \$expect_out(1,string) }
      eof
    }
  " 2>/dev/null | tail -1)

  if [[ -n "$created" ]]; then
    echo -e "  ${GREEN}Container created: ${created}${NC}"
  else
    echo -e "  ${RED}Could not verify container timestamp${NC}"
  fi

  # Clean up local tarball
  rm -f "$tarball"

  echo ""
  echo -e "${GREEN}${service} deployed successfully.${NC}"
}

# Deploy requested services
if [[ "$DEPLOY_WEB" == true ]]; then
  deploy_service "web" "$WEB_IMAGE" "apps/web/Dockerfile"
  WEB_OK="yes"
fi

if [[ "$DEPLOY_ENGINE" == true ]]; then
  deploy_service "engine" "$ENGINE_IMAGE" "apps/engine/Dockerfile"
  ENGINE_OK="yes"
fi

# Summary
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Deploy Summary${NC}"
echo -e "${YELLOW}========================================${NC}"
if [[ "$DEPLOY_WEB" == true ]]; then
  if [[ "$WEB_OK" == "yes" ]]; then
    echo -e "  ${GREEN}[OK]${NC}  web"
  else
    echo -e "  ${RED}[FAIL]${NC}  web"
  fi
fi
if [[ "$DEPLOY_ENGINE" == true ]]; then
  if [[ "$ENGINE_OK" == "yes" ]]; then
    echo -e "  ${GREEN}[OK]${NC}  engine"
  else
    echo -e "  ${RED}[FAIL]${NC}  engine"
  fi
fi
echo ""
