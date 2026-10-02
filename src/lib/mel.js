// A Mel muda de roupa com o tempo (2.86). Cada condição tem de seis a
// nove imagens em public/imagens/mel/<condicao>-<n>.webp (recortes sem
// fundo, recortados das pranchas). Uma é sorteada por visita.
// Condição sem imagem ainda cai na padrão.
export const MEL_PADRAO = '/imagens/mel.webp'

// quantas imagens existem por condição (public/imagens/mel)
export const MEL_VARIANTES = {
  ensolarado: 6,
  nublado: 9,
  chuva: 9,
  trovoada: 9,
  noite: 9,
  frio: 9,
  calor: 8,
}

export function imagemDaMel(condicao) {
  const n = MEL_VARIANTES[condicao] ?? 0
  if (!condicao || n <= 0) return MEL_PADRAO
  return `/imagens/mel/${condicao}-${1 + Math.floor(Math.random() * n)}.webp`
}

// O avatar pela chave que o motor devolve (2.88): '<clima>_<tom>'. O clima
// escolhe a pasta; dentro dela a imagem é fixa por tom e por dia (nada de
// trocar a cada abertura). Chave desconhecida cai no clima, e sem clima no
// padrão.
export function avatarDaMel(avatarKey) {
  const [condicao, tom = 'neutra'] = String(avatarKey || '').split('_')
  const n = MEL_VARIANTES[condicao] ?? 0
  if (!condicao || n <= 0) return MEL_PADRAO
  const dia = Math.floor(Date.now() / 864e5)
  let h = 0
  for (const ch of tom + dia) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `/imagens/mel/${condicao}-${1 + (h % n)}.webp`
}
