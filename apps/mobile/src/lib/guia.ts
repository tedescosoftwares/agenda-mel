import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEMO, WEB_URL } from './config'
import { supabase } from './supabase'

// O guia de salões dentro do app (3.64). Os mesmos dados do site: o gerador deixa JSON no servidor
// (mimo.com.vc/dados/guia/...), leve e sem passar pelo Supabase; quando o arquivo não existe (uma cidade
// recém-publicada, o desenvolvimento), as funções públicas do banco respondem (guia_cidades, guia_cidade,
// guia_pagina). Cache em memória por alguns minutos, como na web (src/lib/guiaPublico.js).

export type Cidade = { cidade: string; cidade_slug: string; uf: string; total: number }
export type Cartao = {
  id?: string; slug: string; nome: string; cidade?: string; cidade_slug: string; uf?: string; bairro: string | null; endereco?: string | null; categoria: string
  resumo?: string | null; foto?: string | null; fotos?: string[] | null; selecao?: boolean; na_mimo?: boolean; latitude?: number | null; longitude?: number | null
  servicos?: string[] | null; horarios?: Horario[] | null
}
export type Horario = { dia: number; faixas: [string, string][] }
export type Lugar = Cartao & {
  id: string; cidade: string; uf: string; telefone?: string | null; whatsapp?: string | null; instagram?: string | null; site?: string | null
  atributos?: Record<string, unknown> | null; conteudo?: Record<string, unknown> | null; validado_receita?: boolean
  mimo?: { salao_id: string; nome: string | null; slug: string | null; subdominio: string | null } | null
  bairro_total?: number; cidade_total?: number
}
export type CidadeDados = {
  cidade: string; cidade_slug: string; uf: string; total: number
  categorias?: { categoria: string; total: number; foto?: string | null }[]
  bairros?: { bairro: string; total: number }[]
  lugares: Cartao[]
  lista?: { total: number; partes: number; por_parte: number } | null
}
export type Pagina = { lugar: Lugar; vizinhos?: Cartao[] | null; mesma_categoria?: Cartao[] | null }
export type Contato = { ligado: boolean; numero?: string; botoes?: string[]; msg_cliente?: string }

const VALIDADE = 5 * 60 * 1000
const cache = new Map<string, { em: number; promessa: Promise<unknown> }>()
function lembrar<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const g = cache.get(chave)
  if (g && Date.now() - g.em < VALIDADE) return g.promessa as Promise<T>
  const promessa = buscar().catch((e) => { cache.delete(chave); throw e })
  cache.set(chave, { em: Date.now(), promessa })
  return promessa
}
const limpar = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\/+$/, '')

async function doServidor<T>(caminho: string): Promise<T | undefined> {
  if (DEMO) return undefined
  try {
    const r = await fetch(`${WEB_URL}${caminho}`, { headers: { Accept: 'application/json' } })
    if (!r.ok || !/json/i.test(r.headers.get('content-type') ?? '')) return undefined
    const j = (await r.json()) as T
    return j && typeof j === 'object' ? j : undefined
  } catch { return undefined }
}
async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw error
  return (data as T) ?? null
}

// [{ cidade, cidade_slug, uf, total }]
export function carregarCidades(): Promise<Cidade[]> {
  return lembrar('cidades', async () => {
    const r = (await doServidor<Cidade[]>('/dados/guia/cidades.json')) ?? (await rpc<Cidade[]>('guia_cidades', {}))
    return Array.isArray(r) ? r : []
  })
}
// a cidade (categoria vazia) ou uma categoria: a primeira parte da lista e os totais
export function carregarCidade(cidade: string, categoria = ''): Promise<CidadeDados | null> {
  const c = limpar(cidade), cat = limpar(categoria)
  return lembrar(`cidade:${c}/${cat}`, async () => (await doServidor<CidadeDados>(`/dados/guia/${c}${cat ? `/${cat}` : ''}.json`)) ?? rpc<CidadeDados>('guia_cidade', { cidade_: c, categoria_: cat }))
}
// as outras partes da lista (3.25): /dados/guia/<cidade>/lista/<categoria|todos>-<n>.json
export function carregarParte(cidade: string, categoria: string, n: number): Promise<Cartao[] | null> {
  const c = limpar(cidade), cat = limpar(categoria) || 'todos'
  return lembrar(`parte:${c}/${cat}/${n}`, async () => {
    const d = await doServidor<{ lugares?: Cartao[] }>(`/dados/guia/${c}/lista/${cat}-${Number(n)}.json`)
    return Array.isArray(d?.lugares) ? d.lugares : null
  })
}
// a lista inteira (para a busca por nome e por bairro)
export function carregarListaInteira(cidade: string, categoria = ''): Promise<Cartao[] | null> {
  const c = limpar(cidade), cat = limpar(categoria)
  return lembrar(`lista:${c}/${cat}`, async () => {
    const d = await doServidor<{ lugares?: Cartao[] }>(`/dados/guia/${c}/lista/${cat || 'todos'}.json`)
    if (Array.isArray(d?.lugares)) return d.lugares
    const r = await rpc<CidadeDados>('guia_cidade', { cidade_: c, categoria_: cat })
    return Array.isArray(r?.lugares) ? r.lugares : null
  })
}
// { lugar, vizinhos, mesma_categoria } | null
export function carregarPagina(cidade: string, slug: string): Promise<Pagina | null> {
  const c = limpar(cidade), s = limpar(slug)
  return lembrar(`pagina:${c}/${s}`, async () => (await doServidor<Pagina>(`/dados/guia/${c}/${s}.json`)) ?? rpc<Pagina>('guia_pagina', { cidade_: c, slug_: s }))
}
// o WhatsApp da Mel do guia (3.48): ligado, o número e a mensagem pronta da cliente
export function carregarContato(): Promise<Contato> {
  return lembrar('contato', async () => {
    try {
      const d = await rpc<Contato>('guia_contato_config', {})
      return d?.ligado && d.numero ? { ligado: true, numero: String(d.numero), botoes: Array.isArray(d.botoes) ? d.botoes : [], msg_cliente: String(d.msg_cliente ?? '') } : { ligado: false }
    } catch { return { ligado: false } }
  })
}

// a cidade escolhida fica no aparelho; na primeira vez, a cidade pela conexão (site_minha_cidade, sem guardar nada)
const CHAVE_CIDADE = 'mimo-guia-cidade'
export async function cidadeLembrada(): Promise<string | null> {
  try { return await AsyncStorage.getItem(CHAVE_CIDADE) } catch { return null }
}
export async function lembrarCidade(slug: string): Promise<void> {
  try { await AsyncStorage.setItem(CHAVE_CIDADE, slug) } catch { /* sem armazenamento */ }
}
export async function cidadePelaConexao(): Promise<{ cidade: string; uf: string } | null> {
  try {
    const d = await rpc<{ cidade?: string; uf?: string }>('site_minha_cidade', {})
    return d?.cidade ? { cidade: d.cidade, uf: d.uf ?? '' } : null
  } catch { return null }
}

// a cliente entra na agenda de um salão da MIMO a partir do guia (migração 210)
export type Entrada = { ok: boolean; novo?: boolean; motivo?: string; so_convite?: boolean; salao?: { id: string; nome: string; tipo: string | null; cidade: string | null; logo: string | null } }
export async function entrarPeloGuia(salaoId: string, lugarId: string | null): Promise<Entrada> {
  const { data, error } = await supabase.rpc('vincular_pelo_guia', { salao_: salaoId, lugar_: lugarId })
  if (error) return { ok: false, motivo: error.message }
  return ((data as Entrada | null) ?? { ok: false, motivo: 'Não deu para entrar agora.' })
}
