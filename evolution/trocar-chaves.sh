#!/usr/bin/env bash
#
# Troca a chave da Evolution e o segredo do webhook.
#
#   ./trocar-chaves.sh
#
# Use quando a chave vazar. Depois rode ./conectar.sh para republicar
# os segredos no Supabase e reapontar o webhook.
#
# A sessão do WhatsApp NÃO cai: ela vive no volume, não na chave.

set -euo pipefail
cd "$(dirname "$0")"

verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

[ -f .env ] || { vermelho 'Não achei o .env.'; exit 1; }

NOVA=$(openssl rand -hex 32)
NOVO_HOOK=$(openssl rand -hex 32)

cp .env .env.anterior
chmod 600 .env.anterior

sed -i "s|^API_KEY=.*|API_KEY=${NOVA}|" .env
sed -i "s|^WEBHOOK_TOKEN=.*|WEBHOOK_TOKEN=${NOVO_HOOK}|" .env

echo 'Recriando o container para valer a chave nova...'
# --force-recreate é obrigatório: sem ele o compose às vezes diz
# "Running" e deixa o processo antigo com a chave velha
docker compose up -d --force-recreate evolution >/dev/null

# shellcheck disable=SC1091
set -a; . ./.env; set +a

echo -n 'Esperando responder'
for _ in $(seq 1 30); do
  if curl -fsS --max-time 4 "https://${DOMINIO}/" >/dev/null 2>&1; then break; fi
  printf '.'
  sleep 5
done
echo

# confere de verdade, em vez de torcer
NO_CONTAINER=$(docker compose exec -T evolution printenv AUTHENTICATION_API_KEY 2>/dev/null | tr -d '\r\n' || echo '')
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "https://${DOMINIO}/instance/fetchInstances" -H "apikey: ${NOVA}" || echo '000')

echo
if [ "$NO_CONTAINER" = "$NOVA" ] && [ "$CODIGO" = '200' ]; then
  verde 'Chave trocada e valendo.'
  echo
  echo 'Para entrar no painel:'
  echo "    ${NOVA}"
  echo
  amarelo 'Rode ./conectar.sh para republicar no Supabase e reapontar o webhook.'
  rm -f .env.anterior
else
  vermelho "Não pegou (container=${NO_CONTAINER:0:8}... http=${CODIGO})."
  echo 'Voltando o .env de antes.'
  mv .env.anterior .env
  docker compose up -d --force-recreate evolution >/dev/null
  exit 1
fi
