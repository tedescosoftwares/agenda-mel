#!/usr/bin/env bash
#
# MIMO — troca o número do WhatsApp da Evolution (o número da casa).
#
#   ./trocar-numero.sh 5513999990000        # só dígitos, com o 55 na frente
#   ./trocar-numero.sh 5513999990000 --qr   # prefere QR em vez do código de pareamento
#
# Faz, nesta ordem:
#   1. desconecta e apaga as instâncias antigas (o chip velho sai)
#   2. cria a instância "mimo" já amarrada ao número novo
#   3. mostra o CÓDIGO DE PAREAMENTO: no celular do chip, WhatsApp →
#      Aparelhos conectados → Conectar aparelho → "Conectar com número"
#      (ou o QR pelo Manager, com --qr)
#   4. espera a instância ficar "open"
#   5. roda o conectar.sh (webhook + segredos no Supabase)
#   6. imprime o SQL para o banco usar o número novo
#
# A chave da API vale a mesma; se ela vazou, rode ./trocar-chaves.sh antes.
set -euo pipefail
cd "$(dirname "$0")"
azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

NUMERO=$(printf '%s' "${1:-}" | tr -dc '0-9')
QR=${2:-}
if [ -z "$NUMERO" ] || [ "${#NUMERO}" -lt 12 ] || [ "${NUMERO:0:2}" != "55" ]; then
  vermelho 'Uso: ./trocar-numero.sh 55DDDNUMERO   (ex.: 5513999990000)'
  exit 1
fi
[ -f .env ] || { vermelho 'Não achei o .env. Rode o ./bootstrap.sh primeiro.'; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${DOMINIO:-}" ] && [ -n "${API_KEY:-}" ] || { vermelho 'Falta DOMINIO ou API_KEY no .env.'; exit 1; }

API="https://${DOMINIO}"
chamar() { # metodo caminho [json]
  curl -sS --max-time 25 -X "$1" "${API}$2" -H "apikey: ${API_KEY}" -H 'Content-Type: application/json' ${3:+-d "$3"}
}
campo() { python3 -c 'import sys,json
d=json.load(sys.stdin); p=sys.argv[1].split(".")
for k in p:
    d = d[int(k)] if isinstance(d, list) else d.get(k, {}) if isinstance(d, dict) else {}
print(d if isinstance(d,(str,int)) else "")' "$1" 2>/dev/null || true; }

azul "== 1/5  Instâncias antigas =="
LISTA=$(chamar GET /instance/fetchInstances)
NOMES=$(printf '%s' "$LISTA" | python3 -c '
import sys,json
d=json.load(sys.stdin)
itens = d if isinstance(d, list) else d.get("instances", [])
for i in itens:
    ninho = i.get("instance") if isinstance(i.get("instance"), dict) else i
    n = ninho.get("name") or ninho.get("instanceName")
    if n: print(n)' 2>/dev/null || true)
# a lista pode vir em formatos diferentes conforme a versão; 'mimo' entra sempre
for n in $(printf '%s\nmimo\n' "$NOMES" | sort -u); do
  [ -z "$n" ] && continue
  chamar DELETE "/instance/logout/$n" >/dev/null 2>&1 || true
  sleep 1
  R=$(chamar DELETE "/instance/delete/$n" 2>/dev/null || true)
  if printf '%s' "$R" | grep -qi '"status":"SUCCESS"\|deleted\|removed'; then verde "  apagada: $n"
  elif printf '%s' "$R" | grep -qi 'not found\|does not exist'; then :
  else amarelo "  $n: $R"; fi
done

azul "== 2/5  Criando a instância 'mimo' para +${NUMERO} =="
RESP=$(chamar POST /instance/create "{\"instanceName\":\"mimo\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true,\"number\":\"${NUMERO}\"}")
if printf '%s' "$RESP" | grep -qi 'already'; then
  amarelo "  'mimo' já existia e não deixou apagar; sigo com ela e só pareio o número novo"
elif ! printf '%s' "$RESP" | grep -q '"instance"'; then
  vermelho "A Evolution não criou a instância: $RESP"
  exit 1
else
  verde '  criada'
fi
sleep 3

azul "== 3/5  Parear o celular =="
if [ "$QR" = "--qr" ]; then
  echo "  Abra https://${DOMINIO}/manager, entre com a API_KEY, instância 'mimo' → QR code."
  echo "  No celular do chip: WhatsApp → Aparelhos conectados → Conectar → aponte para o QR."
else
  CODIGO=""
  for _ in 1 2 3; do
    C=$(chamar GET "/instance/connect/mimo?number=${NUMERO}")
    CODIGO=$(printf '%s' "$C" | campo pairingCode)
    [ -n "$CODIGO" ] && break
    sleep 4
  done
  if [ -n "$CODIGO" ]; then
    echo
    printf '  \033[1;35m  CÓDIGO DE PAREAMENTO:  %s  \033[0m\n' "$CODIGO"
    echo
    echo "  No celular do chip (+${NUMERO}): WhatsApp → Aparelhos conectados → Conectar aparelho"
    echo "  → 'Conectar com número de telefone' → digite o código acima. Vale por ~1 minuto;"
    echo "  se vencer, rode de novo: ./trocar-numero.sh ${NUMERO}"
  else
    amarelo "  Não veio código de pareamento. Use o QR: https://${DOMINIO}/manager (instância 'mimo')."
  fi
fi

azul "== 4/5  Esperando o WhatsApp conectar (até 3 min) =="
ESTADO=""
for i in $(seq 1 36); do
  ESTADO=$(chamar GET /instance/connectionState/mimo | campo instance.state)
  [ "$ESTADO" = "open" ] && break
  printf '.'
  sleep 5
done
echo
if [ "$ESTADO" != "open" ]; then
  amarelo "  Ainda não conectou (estado: ${ESTADO:-?}). Termine o pareamento e rode ./conectar.sh depois."
  exit 0
fi
verde '  conectado!'

azul "== 5/5  Webhook e segredos (conectar.sh) =="
./conectar.sh

BONITO="+${NUMERO:0:2} (${NUMERO:2:2}) ${NUMERO:4:5}-${NUMERO:9}"
echo
azul '== Agora cole isto no SQL Editor do Supabase =='
cat <<SQL
-- todas as agendas passam a mandar pelo número da casa
update public.whatsapp_channels
   set canal = 'evolution', identificador = 'mimo', numero_exibicao = '${BONITO}', ativo = true;
-- o "Contato e ajuda" do app aponta para ele
select public.definir_config_publica('whatsapp_suporte', '${NUMERO}');
SQL
echo
verde "Pronto: +${NUMERO} é o número da casa."
