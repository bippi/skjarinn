#!/usr/bin/env bash
# Keyrt í Docker: docker compose run --rm apk
set -euo pipefail
cd /src

# Fastur undirritunarlykill svo hægt sé að uppfæra appið yfir eldri útgáfu
if [ ! -f skjarinn.keystore ]; then
  keytool -genkeypair -keystore skjarinn.keystore -storepass skjarinn -keypass skjarinn \
    -alias skjarinn -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Skjarinn" > /dev/null
fi

gradle --no-daemon -q assembleRelease
mkdir -p dist
cp app/build/outputs/apk/release/app-release.apk dist/skjarinn.apk
echo "Tilbúið: android/dist/skjarinn.apk"

# Valfrjálst: setja beint upp á Shield, t.d. SHIELD=192.168.1.50 docker compose run --rm -e SHIELD apk
if [ -n "${SHIELD:-}" ]; then
  adb connect "$SHIELD"
  adb -s "$SHIELD:5555" wait-for-device
  adb -s "$SHIELD:5555" install -r dist/skjarinn.apk
fi
