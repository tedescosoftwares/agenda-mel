import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect } from 'react'
import { AppState, Dimensions, Platform, type AppStateStatus } from 'react-native'
import { useSessao } from '@/context/sessao'
import { VERSAO } from './config'
import { posicaoAtual, type Posicao } from './localizacao'
import { supabase } from './supabase'

// As métricas do app no portal (3.73, migração 217). O guia dentro do app manda ao banco os mesmos sinais
// que o site manda das páginas do guia (src/lib/eventos.js e src/lib/presenca.js na web): a visita a cada
// página, os toques (WhatsApp, como chegar, Instagram, agendar, seguir, quero na MIMO…) e a batida de
// presença enquanto a tela está à vista. Tudo com origem "app", para a Plataforma separar do site.
//
// Quem identifica a visita é um código da instalação: sorteado uma vez neste aparelho e guardado aqui, sem
// ligação com a conta, o telefone ou o IP (o banco ainda faz um hash dele com o sal do dia; o que fica lá
// não volta ao código). Sem ele o banco não contaria: o app não é navegador, e o user-agent da biblioteca
// de rede cai no filtro de robô. Quem permitiu a localização manda a posição junto, como no site (3.73.1): na
// presença com 3 casas (~100 m; o Ao vivo mostra a cidade certa e o pino "pelo GPS") e uma vez por tela no evento
// 'localizacao', uma vez por sessão (o mapa de acessos do Desempenho; o banco guarda com 6 casas, como o site).
// Quem trabalha na Plataforma (perfil "plataforma") não conta. Tudo é "manda e esquece": nunca trava a tela.
//
// Para evoluir: um toque novo é registrarEvento('tipo', pagina) com o tipo cadastrado em site_eventos_tipos;
// uma tela nova que mereça contar chama useMetricasDaPagina(caminho, titulo) com o caminho igual ao do site.

const CHAVE = 'mimo.metricas.instalacao'
const BATIDA_MS = 25000
const CODIGO_OK = /^[a-z0-9]{16,64}$/

let codigo: string | null = null
let pedindo: Promise<string> | null = null
let contar = true // falso para quem trabalha na Plataforma

function sortear(): string {
  let s = ''
  while (s.length < 32) s += Math.floor(Math.random() * 36).toString(36)
  return s
}
// o código da instalação: lido uma vez; sorteado e guardado na primeira vez
export function codigoDaInstalacao(): Promise<string> {
  if (codigo) return Promise.resolve(codigo)
  pedindo ??= (async () => {
    let c: string | null = null
    try { c = await AsyncStorage.getItem(CHAVE) } catch { /* sem storage: um código só para esta sessão */ }
    if (!c || !CODIGO_OK.test(c)) {
      c = sortear()
      try { await AsyncStorage.setItem(CHAVE, c) } catch { /* fica só na memória */ }
    }
    codigo = c
    return c
  })()
  return pedindo
}

// ---- os caminhos, iguais aos do site (o banco reconhece a cidade, a categoria e o salão pelo caminho) ----
export const paginaDoGuia = (cidade: string, categoria = '') => `/saloes/${cidade}${categoria ? `/${categoria}` : ''}`
export const paginaDaRegiao = (slug: string) => `/saloes/regiao/${slug}`
export const paginaDoSalao = (cidade: string, slug: string) => `/saloes/${cidade}/${slug}`

// ---- os eventos: visita e toques ----
export type ExtraDoEvento = { area?: string; dados?: Record<string, unknown> }
export function registrarEvento(tipo: string, pagina: string | null | undefined, extra: ExtraDoEvento = {}): void {
  if (!pagina || !contar) return
  void (async () => {
    try {
      const app_ = await codigoDaInstalacao()
      await supabase.rpc('site_evento', {
        tipo_: tipo, pagina_: pagina, origem_: 'app', ref_: null, aparelho_: 'celular',
        area_: extra.area ?? null, utm_: null, dados_: extra.dados ?? null, app_,
      })
    } catch { /* manda e esquece */ }
  })()
}
let ultima = { pagina: '', em: 0 }
// a visita de uma tela (a mesma tela em 3 s é uma só; o banco ainda junta as repetidas em 30 minutos)
export function registrarVisita(pagina: string | null | undefined): void {
  if (!pagina) return
  if (ultima.pagina === pagina && Date.now() - ultima.em < 3000) return
  ultima = { pagina, em: Date.now() }
  registrarEvento('visita', pagina)
}

// ---- a presença: uma batida a cada 25 s com a tela à vista; a de saída ao sair da tela ou do app ----
let atual: { pagina: string; titulo: string | null } | null = null
let local: { lat: number; lng: number } | null = null // a posição de quem permitiu, arredondada
let mandouLocalizacao = false // o evento de localização vai uma vez por sessão do app, como no site (guiaPerto.js)
let relogio: ReturnType<typeof setInterval> | null = null
let primeira: ReturnType<typeof setTimeout> | null = null
let ouvindo = false

function sistema(): string {
  if (Platform.OS === 'android') return `Android ${Platform.Version}`
  if (Platform.OS === 'ios') return `iOS ${Platform.Version}`
  return 'Web'
}
function idioma(): string | null {
  try { return String(Intl.DateTimeFormat().resolvedOptions().locale || '').slice(0, 16) || null } catch { return null }
}
async function bater(sair = false): Promise<void> {
  if (!atual || !contar) return
  const { pagina, titulo } = atual
  try {
    const { width, height } = Dimensions.get('window')
    const app_ = await codigoDaInstalacao()
    await supabase.rpc('site_presenca', {
      pagina_: pagina, titulo_: titulo ? titulo.slice(0, 140) : null, origem_: 'app', ref_: null, utm_: null,
      dispositivo_: 'celular', sistema_: sistema(), navegador_: `App MIMO ${VERSAO}`,
      tela_: `${Math.round(width)}x${Math.round(height)}`, idioma_: idioma(), lat_: local?.lat ?? null, lng_: local?.lng ?? null, sair_: sair, app_,
    })
  } catch { /* manda e esquece */ }
}
const ligar = () => { relogio ??= setInterval(() => { if (AppState.currentState === 'active') void bater() }, BATIDA_MS) }
const desligar = () => { if (relogio) clearInterval(relogio); relogio = null; if (primeira) clearTimeout(primeira); primeira = null }
function ouvir() {
  if (ouvindo) return
  ouvindo = true
  AppState.addEventListener('change', (s: AppStateStatus) => {
    if (!atual) return
    if (s === 'active') { void bater(); ligar() } else { void bater(true); desligar() }
  })
}
// quem permitiu a localização: a próxima batida leva a posição, com 3 casas (~100 m), como no site (presenca.js)
export function informarPosicao(p: Posicao | null): void {
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return
  const novo = { lat: Math.round(p.latitude * 1000) / 1000, lng: Math.round(p.longitude * 1000) / 1000 }
  const mudou = !local || local.lat !== novo.lat || local.lng !== novo.lng
  local = novo
  if (mudou && atual && AppState.currentState === 'active') void bater() // o banco aceita a batida com GPS mesmo logo depois da outra
}
// a tela mudou (ou saiu da tela: nulo). O título pode chegar depois: fica para a próxima batida
export function presencaNaPagina(pagina: string | null | undefined, titulo?: string | null): void {
  if (!pagina || !contar) {
    if (atual) { void bater(true); atual = null; desligar() }
    return
  }
  if (atual?.pagina === pagina) { if (titulo) atual.titulo = titulo; return }
  atual = { pagina, titulo: titulo ?? null }
  ouvir()
  desligar()
  primeira = setTimeout(() => { void bater() }, 400) // a tela nova acaba de montar: o título chega junto
  ligar()
}

// ---- o gancho das telas do guia: a visita quando a tela (ou o que ela mostra) muda; a presença com a tela à vista ----
export function useMetricasDaPagina(pagina: string | null, titulo?: string | null): void {
  const { perfil } = useSessao()
  const papel = perfil?.role ?? null
  useEffect(() => { contar = papel !== 'plataforma' }, [papel])
  useEffect(() => { registrarVisita(pagina) }, [pagina]) // registrarEvento já olha "contar" (o efeito acima roda antes)
  // a posição de quem permitiu (cache de 5 min em localizacao.ts): na presença e, uma vez por sessão, no evento de localização
  useEffect(() => {
    if (!pagina) return
    let vivo = true
    posicaoAtual().then((p) => {
      if (!vivo || !p) return
      informarPosicao(p)
      if (!mandouLocalizacao && contar) { mandouLocalizacao = true; registrarEvento('localizacao', pagina, { dados: { lat: p.latitude, lng: p.longitude, prec: 0 } }) }
    }).catch(() => {})
    return () => { vivo = false }
  }, [pagina])
  useFocusEffect(useCallback(() => {
    presencaNaPagina(pagina, titulo)
    return () => presencaNaPagina(null)
  }, [pagina, titulo]))
}
