#!/usr/bin/env bash
# Gera o pacote Android (AAB) de um dos apps da MIMO a partir da PWA, com Bubblewrap.
# Uso:  ./android/publicar-android.sh pro               (MIMO Pro: profissionais e salões)
#       ./android/publicar-android.sh cliente           (MIMO: clientes)
#       ./android/publicar-android.sh pro --subir       (gera e sobe a versão: appVersionCode + 1)
#
# Pré-requisitos (uma vez só): Node 18+, `npm i -g @bubblewrap/cli`, e o keystore do app
# em android/mimo-<app>/mimo-<app>.keystore (NUNCA vai para o git).
# O Bubblewrap baixa o JDK e o Android SDK sozinho na primeira vez.
set -euo pipefail
APP="${1:-}"
case "$APP" in
  pro|cliente) ;;
  *) echo "Qual app? pro ou cliente.  Ex.: ./android/publicar-android.sh pro [--subir]"; exit 1 ;;
esac
cd "$(dirname "$0")/mimo-$APP"
KEYSTORE="mimo-$APP.keystore"; ALIAS="mimo-$APP"

if ! command -v bubblewrap >/dev/null 2>&1; then
  echo "Instale o Bubblewrap:  npm i -g @bubblewrap/cli"; exit 1
fi
if [ ! -f "$KEYSTORE" ]; then
  echo "Falta o keystore android/mimo-$APP/$KEYSTORE."
  echo "Crie com:  keytool -genkeypair -v -keystore $KEYSTORE -alias $ALIAS -keyalg RSA -keysize 2048 -validity 10000"
  exit 1
fi

# a versão do app acompanha a do site (src/lib/versao.js)
VERSAO=$(sed -n "s/.*VERSAO = '\([0-9.]*\).*/\1/p" ../../src/lib/versao.js)
if [ "${2:-}" = "--subir" ]; then
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
echo "Pronto ($APP). Suba no Play Console (Teste interno ou Produção):"
ls -1 app-release-bundle.aab app-release-signed.apk 2>/dev/null || true
echo
echo "Impressão da chave de upload (vai no public/.well-known/assetlinks.json, junto com a do Play):"
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" 2>/dev/null | grep -i "SHA256" || true
