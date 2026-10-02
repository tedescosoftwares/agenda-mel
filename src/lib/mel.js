// A Mel muda de roupa com o tempo (2.86). Cada condição tem de duas a
// três imagens em public/imagens/mel/<condicao>-<n>.webp (recortes sem
// fundo, mesmo enquadramento da mel.webp). Uma é sorteada por visita.
// Condição sem imagem ainda cai na padrão.
export const MEL_PADRAO = '/imagens/mel.webp'

// quantas imagens existem por condição: ao chegar as imagens, ajuste aqui
export const MEL_VARIANTES = {
  ensolarado: 0,
  nublado: 0,
  chuva: 0,
  trovoada: 0,
  noite: 0,
  frio: 0,
  calor: 0,
}

export function imagemDaMel(condicao) {
  const n = MEL_VARIANTES[condicao] ?? 0
  if (!condicao || n <= 0) return MEL_PADRAO
  return `/imagens/mel/${condicao}-${1 + Math.floor(Math.random() * n)}.webp`
}
