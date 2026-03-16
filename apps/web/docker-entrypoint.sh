#!/bin/sh
set -e

# === License Validation ===
echo "[entrypoint] Checking license..."
if [ -n "$LICENSE_KEY" ]; then
  # Phone-home to license API
  RESP=$(curl -sf --max-time 10 "${LICENSE_API_URL:-https://lead-routing-license.artyagi2011.workers.dev}/v1/licenses/validate" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${LICENSE_KEY}\",\"fingerprint\":\"$(hostname)\"}" \
    2>/dev/null || echo '{"valid":false,"offline":true}')

  # Parse response using Node (available in the image)
  VALID=$(echo "$RESP" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).valid)}catch{console.log('false')}})")
  OFFLINE=$(echo "$RESP" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).offline||false)}catch{console.log('true')}})")
  TIER=$(echo "$RESP" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tier||'free')}catch{console.log('free')}})")

  if [ "$VALID" = "true" ]; then
    echo "[entrypoint] License valid (${TIER} tier)"
    export LICENSE_TIER="${TIER}"
  elif [ "$OFFLINE" = "true" ]; then
    echo "[entrypoint] License server unreachable, attempting offline verification..."
    # Try offline JWT verification
    if node apps/web/verify-license.js "$LICENSE_KEY" 2>/dev/null; then
      echo "[entrypoint] Offline verification passed"
    else
      if [ "$LICENSE_TIER" != "pro" ]; then
        echo "[entrypoint] WARNING: Could not verify license offline. Running in FREE tier."
        export LICENSE_TIER="free"
      else
        echo "[entrypoint] WARNING: Could not verify license offline, but LICENSE_TIER=pro set via environment. Keeping pro."
      fi
    fi
  else
    echo "[entrypoint] License invalid or expired. Running in FREE tier."
    echo "[entrypoint] Renew at https://openedgeai.tech/account"
    export LICENSE_TIER="free"
  fi
else
  # Only downgrade to free if LICENSE_TIER wasn't already set to pro via env
  if [ "$LICENSE_TIER" != "pro" ]; then
    echo "[entrypoint] No license key provided. Running in FREE tier."
    export LICENSE_TIER="free"
  else
    echo "[entrypoint] No license key, but LICENSE_TIER=pro set via environment. Keeping pro."
  fi
fi
# === End License Validation ===

echo "[entrypoint] Running database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma

# Seed admin user on first run (if ADMIN_EMAIL is set and no org exists yet)
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Checking if seed is needed..."
  node apps/web/seed.js
fi

# Read license tier from DB if activated via web UI
DB_TIER=$(node -e "
const { execSync } = require('child_process');
try {
  const r = execSync('node ./node_modules/prisma/build/index.js db execute --stdin --url \"' + process.env.DATABASE_URL + '\"', {
    input: 'SELECT \"licenseTier\" FROM organizations WHERE \"licenseKey\" IS NOT NULL LIMIT 1;',
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const match = r.match(/(free|pro)/i);
  if (match) process.stdout.write(match[1].toLowerCase());
} catch(e) {}
" 2>/dev/null || echo "")
if [ -n "$DB_TIER" ]; then
  echo "[entrypoint] License tier from DB activation: $DB_TIER"
  export LICENSE_TIER="$DB_TIER"
fi

echo "[entrypoint] Starting Next.js..."
exec node apps/web/server.js
