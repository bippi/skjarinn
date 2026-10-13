#!/usr/bin/env bash
# Byggir Docker-mynd Skjásins hér og setur hana upp á annarri vél gegnum SSH.
#   bash scripts/deploy.sh notandi@vél [port]
# Vélin þarf bara Docker (með compose); ekkert er byggt þar.
set -euo pipefail

HOST="${1:?Notkun: bash scripts/deploy.sh notandi@vél [port]}"
PORT="${2:-3000}"
DIR='~/skjarinn'
cd "$(dirname "$0")/.."

# Byggja fyrir örgjörva vélarinnar (t.d. arm64 á Raspberry Pi)
case "$(ssh "$HOST" uname -m)" in
  x86_64) PLATFORM=linux/amd64 ;;
  aarch64|arm64) PLATFORM=linux/arm64 ;;
  *) echo "Óþekktur örgjörvi á $HOST" >&2; exit 1 ;;
esac

echo "Byggi mynd fyrir $PLATFORM…"
docker build --platform "$PLATFORM" -t skjarinn:latest .

echo "Sendi mynd til $HOST…"
docker save skjarinn:latest | gzip | ssh "$HOST" 'gunzip | docker load'

ssh "$HOST" "mkdir -p $DIR"
if [ -f .env.local ]; then
  ssh "$HOST" "umask 077 && cat > $DIR/.env" < .env.local
else
  ssh "$HOST" "touch $DIR/.env"
fi
ssh "$HOST" "cat > $DIR/docker-compose.yml" <<EOF
services:
  skjarinn:
    image: skjarinn:latest
    ports:
      - "$PORT:3000"
    env_file: .env
    volumes:
      - iptv-cache:/app/.cache
    restart: unless-stopped
volumes:
  iptv-cache:
EOF

ssh "$HOST" "cd $DIR && docker compose up -d --force-recreate && docker image prune -f >/dev/null"
IP="$(ssh "$HOST" "hostname -I 2>/dev/null | cut -d' ' -f1" || true)"
echo "Tilbúið: http://${IP:-${HOST#*@}}:$PORT"
