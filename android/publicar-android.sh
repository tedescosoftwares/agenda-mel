#!/usr/bin/env bash
# Gera o pacote Android (AAB) do MIMO Pro a partir da PWA, com Bubblewrap.
# Uso:  ./android/publicar-android.sh            (só gera)
#       ./android/publicar-android.sh --subir     (gera e sobe a versão: appVersionCode + 1)
#
# Pré-requisitos (uma vez só): Node 18+, `npm i -g @bubblewrap/cli`, e o
# keystore em android/mimo-pro/mimo-pro.keystore (NUNCA vai para o git).
# O Bubblewrap baixa o JDK e o Android SDK sozinho na primeira vez.
set -euo pipefail
cd "$(dirname "$0")/mimo-pro"

if ! command -v bubblewrap >/dev/null 2>&1; then
  echo "Instale o Bubblewrap:  npm i -g @bubblewrap/cli"; exit 1
fi
if [ ! -f mimo-pro.keystore ]; then
  echo "Falta o keystore android/mimo-pro/mimo-pro.keystore."
  echo "Crie com:  keytool -genkeypair -v -keystore mimo-pro.keystore -alias mimo-pro -keyalg RSA -keysize 2048 -validity 10000"
  exit 1
fi

# a versão do app acompanha a do site (src/lib/versao.js)
VERSAO=$(sed -n "s/.*VERSAO = '\([0-9.]*\).*/\1/p" ../../src/lib/versao.js)
if [ "${1:-}" = "--subir" ]; then
  node -e "
    const fs=require('fs'); const m=JSON.parse(fs.readFileSync('twa-manifest.json','utf8'));
    m.appVersionCode=(m.appVersionCode||0)+1; m.appVersionName='$VERSAO'; m.appVersion='$VERSAO';
    fs.writeFileSync('twa-manifest.json', JSON.stringify(m,null,2)+'\n');
    console.log('versionCode', m.appVersionCode, '· versionName', m.appVersionName)"
fi

# regenera o projeto Android a partir do twa-manifest e empacota
bubblewrap update
bubblewrap build

echo
echo "Pronto. Suba no Play Console (Produção ou Teste interno):"
ls -1 app-release-bundle.aab app-release-signed.apk 2>/dev/null || true
echo
echo "Impressões da chave (confira o assetlinks.json em public/.well-known/):"
keytool -list -v -keystore mimo-pro.keystore -alias mimo-pro 2>/dev/null | grep -i "SHA256" || true
