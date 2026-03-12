#!/usr/bin/env bash
set -euo pipefail

# Smoke test: verify critical files exist inside a Docker image
# Usage: ./scripts/smoke-test.sh <image-name>
# Example: ./scripts/smoke-test.sh ghcr.io/atgatzby/lead-routing-web:latest

IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "Usage: $0 <image-name>"
  echo "  e.g. $0 ghcr.io/atgatzby/lead-routing-web:latest"
  exit 1
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local desc="$1"
  local cmd="$2"

  result=$(docker run --rm --entrypoint sh "$IMAGE" -c "$cmd" 2>&1) || true
  if [[ "$result" == "OK" ]]; then
    echo -e "  ${GREEN}[PASS]${NC} $desc"
    ((PASS++))
  else
    echo -e "  ${RED}[FAIL]${NC} $desc"
    ((FAIL++))
  fi
}

# Detect service type from image name
if [[ "$IMAGE" == *"web"* ]]; then
  SERVICE="web"
elif [[ "$IMAGE" == *"engine"* ]]; then
  SERVICE="engine"
else
  echo "Cannot determine service type from image name: $IMAGE"
  echo "Image name must contain 'web' or 'engine'."
  exit 1
fi

echo ""
echo "Smoke-testing $SERVICE image: $IMAGE"
echo "-------------------------------------------"

if [[ "$SERVICE" == "web" ]]; then
  check "sfdc-package/ directory exists with force-app" \
    "test -d /app/sfdc-package/force-app && echo OK || echo FAIL"

  check "prisma/schema.prisma exists" \
    "test -f /app/packages/db/prisma/schema.prisma && echo OK || echo FAIL"

  check "prisma/migrations/ has migration dirs" \
    "ls -d /app/packages/db/prisma/migrations/*/  >/dev/null 2>&1 && echo OK || echo FAIL"

  check ".next/ directory exists" \
    "test -d /app/apps/web/.next && echo OK || echo FAIL"

  check "docker-entrypoint.sh exists" \
    "test -f /app/docker-entrypoint.sh && echo OK || echo FAIL"

  check "seed.js exists" \
    "test -f /app/apps/web/seed.js && echo OK || echo FAIL"

elif [[ "$SERVICE" == "engine" ]]; then
  check "dist/server.js exists" \
    "test -f /app/dist/server.js && echo OK || echo FAIL"

  check "node_modules/.prisma/ exists" \
    "test -d /app/node_modules/.prisma && echo OK || echo FAIL"
fi

echo "-------------------------------------------"
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Smoke test FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}Smoke test PASSED${NC}"
  exit 0
fi
