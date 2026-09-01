#!/usr/bin/env bash
#
# Agenda Mel — aproveita, dentro da máquina, um disco EBS que você
# já aumentou no console da AWS.
#
# Aumentar o volume na AWS NÃO aumenta o sistema de arquivos: o Linux
# continua vendo o tamanho antigo. Faltam dois passos, que é o que
# este script faz.
#
#   1) Console AWS -> EC2 -> Volumes -> marque o volume -> Actions ->
#      Modify volume -> troque Size (ex.: 8 para 30) -> Modify.
#      Espera até o State sair de "optimizing" para "in-use".
#   2) Aqui na máquina:  ./crescer-disco.sh
#
# Pode rodar quantas vezes quiser: se já estiver no tamanho máximo,
# ele só avisa e sai.

set -euo pipefail

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
verde()   { printf '\033[1;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[1;33m%s\033[0m\n' "$*"; }
vermelho(){ printf '\033[1;31m%s\033[0m\n' "$*"; }

azul '== Antes =='
df -h / | sed 's/^/  /'
echo
lsblk | sed 's/^/  /'
echo

# Descobre qual partição está montada em / e de qual disco ela veio.
# Em EC2 moderna (Nitro) isso é /dev/nvme0n1p1 vindo de /dev/nvme0n1;
# em instâncias antigas é /dev/xvda1 vindo de /dev/xvda.
PARTICAO=$(findmnt -n -o SOURCE / | sed 's/\[.*\]//')
if [ ! -b "$PARTICAO" ]; then
  vermelho "Não achei o dispositivo da raiz (achei '$PARTICAO')."
  vermelho 'Se a raiz estiver em LVM ou btrfs, este script não serve — me avise.'
  exit 1
fi

DISCO="/dev/$(lsblk -no PKNAME "$PARTICAO")"
NUMERO=$(echo "$PARTICAO" | grep -o '[0-9]*$')

echo "raiz:      $PARTICAO"
echo "disco:     $DISCO"
echo "partição:  $NUMERO"
echo

command -v growpart >/dev/null || {
  amarelo 'Instalando o cloud-guest-utils (traz o growpart)...'
  sudo apt-get update -qq
  sudo apt-get install -y cloud-guest-utils >/dev/null
}

azul '== 1/2  Esticando a partição até o fim do disco =='
# growpart devolve 1 quando não há nada a fazer ("NOCHANGE"): não é erro
if sudo growpart "$DISCO" "$NUMERO"; then
  verde 'Partição esticada.'
else
  amarelo 'A partição já ocupava o disco inteiro.'
  amarelo 'Se você acabou de aumentar o volume na AWS, espere o State'
  amarelo 'sair de "optimizing" e rode de novo.'
fi

azul '== 2/2  Esticando o sistema de arquivos =='
TIPO=$(findmnt -n -o FSTYPE /)
case "$TIPO" in
  ext2|ext3|ext4) sudo resize2fs "$PARTICAO" ;;
  xfs)            sudo xfs_growfs -d / ;;
  *) vermelho "Sistema de arquivos '$TIPO' que eu não sei esticar."; exit 1 ;;
esac

echo
azul '== Depois =='
df -h / | sed 's/^/  /'
echo
verde 'Pronto. Espaço livre agora:'
df -h / | awk 'NR==2{print "  " $4}'
