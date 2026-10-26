import type { Cartao } from './guia'
import { distanciaKm, type Posicao } from './localizacao'

// A ordem do guia no app (3.69), a mesma regra do site (3.17): primeiro quem agenda pela MIMO, depois a Seleção
// MIMO, depois a conta de foto e nota do Google (os pontos, migração 185). Os cartões do servidor já vêm nessa
// ordem (a posição na lista é o "rank"); quando o cartão traz os pontos, eles mandam, e a mescla de várias
// cidades (uma região) fica exata.
//
// "Perto de você" respeita a mesma hierarquia em vez de só a distância: agenda → Seleção → com foto → sem foto;
// dentro de cada grupo, os mais perto primeiro. Entre os com foto, faixas de 2 km: quem está igualmente perto
// disputa pelos pontos (foto + nota). Assim um salão sem foto nunca passa na frente de um com foto por estar
// 300 metros mais perto, e o salão com agenda aparece antes de tudo.

export type Ordenavel = Cartao & { rank?: number }
export type Ordenado = Cartao & { rank: number; km: number | null }

// 0 agenda pela MIMO · 1 Seleção MIMO · 2 com foto · 3 sem foto
export function grupoDoCartao(l: Cartao): 0 | 1 | 2 | 3 {
  if (l.na_mimo) return 0
  if (l.selecao) return 1
  return l.foto || (Array.isArray(l.fotos) && l.fotos.length > 0) ? 2 : 3
}
const pontosDe = (l: Cartao) => (typeof l.pontos === 'number' && Number.isFinite(l.pontos) ? l.pontos : -1)
export const FAIXA_KM = 2
const faixa = (km: number | null) => (km == null ? 1e6 : Math.floor(km / FAIXA_KM))
const porNome = (a: Cartao, b: Cartao) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')

// a ordem pública: MIMO, Seleção, pontos; sem pontos no cartão, a posição na lista do servidor
export function porRegra(a: Ordenado, b: Ordenado): number {
  const ga = Math.min(2, grupoDoCartao(a)), gb = Math.min(2, grupoDoCartao(b))
  if (ga !== gb) return ga - gb
  const pa = pontosDe(a), pb = pontosDe(b)
  if (pa !== pb) return pb - pa
  return a.rank - b.rank || porNome(a, b)
}
// perto de você: a hierarquia e, dentro dela, a distância (com foto: faixas de 2 km, e os pontos na faixa)
export function porPerto(a: Ordenado, b: Ordenado): number {
  const ga = grupoDoCartao(a), gb = grupoDoCartao(b)
  if (ga !== gb) return ga - gb
  const ka = a.km ?? 1e6, kb = b.km ?? 1e6
  if (ga === 2) {
    const fa = faixa(a.km), fb = faixa(b.km)
    if (fa !== fb) return fa - fb
    const pa = pontosDe(a), pb = pontosDe(b)
    if (pa !== pb) return pb - pa
    if (pa < 0 && a.rank !== b.rank) return a.rank - b.rank
  }
  return ka - kb || a.rank - b.rank || porNome(a, b)
}
export function preparar(lista: Ordenavel[], posicao: Posicao | null): Ordenado[] {
  return lista.map((l, i) => ({ ...l, rank: typeof l.rank === 'number' ? l.rank : i, km: posicao ? distanciaKm(posicao, l) : null }))
}
export function ordenar(lista: Ordenavel[], posicao: Posicao | null, perto: boolean): Ordenado[] {
  return preparar(lista, posicao).sort(perto && posicao ? porPerto : porRegra)
}
