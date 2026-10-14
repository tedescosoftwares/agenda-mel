/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions; o tsc confere o resto */
// gsc-sincronizar (3.12): traz do Google Search Console as buscas que levaram
// às páginas do site da MIMO (o guia de salões, o blog e as outras páginas) e
// grava em site_buscas (migrações 160 e 162; quem separa as seções é o banco).
//
// SEGREDOS (o dono do projeto grava com `supabase secrets set`; nunca no código):
//   GSC_CONTA_SERVICO  o JSON inteiro da chave da conta de serviço do Google
//                      (Google Cloud → IAM e administrador → Contas de serviço →
//                      Chaves → Adicionar chave → JSON). Também aceita o JSON em base64.
//   GSC_PROPRIEDADE    a propriedade no Search Console: sc-domain:mimo.com.vc
//                      (tipo domínio) ou https://mimo.com.vc/ (prefixo de URL)
// A conta de serviço precisa estar como usuário dessa propriedade (permissão
// restrita basta) e a "Google Search Console API" ativada no projeto dela.
//
//   supabase secrets set --project-ref SEU_REF GSC_CONTA_SERVICO="$(cat chave.json)" GSC_PROPRIEDADE=sc-domain:mimo.com.vc
//
// POST { dias?: 1..480, ate?: 'AAAA-MM-DD' } com o Authorization de:
//   - alguém da Plataforma logado (botão "Atualizar agora" na aba Desempenho), ou
//   - a chave de serviço (o relógio: chutar_gsc() da 160, pelo pg_cron).
// Sem dias: busca o que falta desde o último dia gravado, com 5 dias de folga;
// na primeira vez, os 16 meses que o Google guarda. A resposta sai em menos
// de um minuto (o caminho até o navegador corta antes dos 150 s da função):
// o que não coube volta como parcial, com cobriu_de e faltam_dias, e a tela
// pede o resto com { dias: faltam_dias, ate: o dia anterior a cobriu_de }.
//
// Respostas:
//   200 { ok: true, de, ate, dias, linhas, janelas, pedidos, descartadas, parcial, cobriu_de, faltam_dias }
//   200 { ok: false, codigo, erro }   ainda não ligado (sem_segredos, chave_invalida)
//                                     ou o Google recusou (sem_acesso, api_desligada...)
//   401/403/405/500 { erro }          pedido, permissão ou banco
//
// O JWT, a paginação, a conversão de URL e as janelas moram em gsc.ts (puro,
// testado com node em gsc.teste.ts). Aqui ficam só o banco, a rede e a porta
// (testada inteira em index.teste.mjs, com Google e PostgREST falsos).
// Cada execução fica anotada em site_buscas_execucoes: o erro do relógio
// aparece na tela da Plataforma em vez de passar em silêncio.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clienteDoChamador, semPermissao } from '../_shared/porteiro.ts'
import { ErroGsc, lerContaServico, normalizarPropriedade, diasParaBuscar, sincronizar, somarDias, diasEntre, DIAS_MAX, PRAZO_PADRAO_MS, type ContaServico, type Fetcher, type LinhaSite } from './gsc.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// a função tem até 150 s, mas a resposta precisa chegar ao navegador bem antes: o prazo é conferido
// entre lotes de janelas, e o que não coube volta como parcial (gsc.ts)
const PRAZO_MS = PRAZO_PADRAO_MS

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // a lista que o supabase-js manda (de @supabase/supabase-js/cors), para o preflight não barrar
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

// a única porta para a rede do Google (gsc.ts recebe isto e fica testável)
const buscar: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) })

type Origem = 'plataforma' | 'relogio'

// quem chama: a Plataforma (pela RPC de sempre, como a própria pessoa) ou a
// chave de serviço. Para a chave, o padrão de _shared/porteiro.ts: em vez de
// comparar strings, o token do chamador tenta site_buscas_gravar com lista
// vazia (não grava nada); a função é revogada de anon e authenticated, então
// quem não é serviço leva "permission denied".
async function quemChama(req: Request, auth: string): Promise<{ origem: Origem; db: SupabaseClient } | Response> {
  const pessoa = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: plataforma } = await pessoa.rpc('eh_plataforma')
  if (plataforma === true) {
    if (!CHAVE_SERVICO) return json({ erro: 'SUPABASE_SERVICE_ROLE_KEY não está no ambiente da função' }, 500)
    return { origem: 'plataforma', db: createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } }) }
  }
  const chamador = clienteDoChamador(req)
  if (!chamador) return json({ erro: 'não autorizado' }, 401)
  const { error } = await chamador.rpc('site_buscas_gravar', { lote_: crypto.randomUUID(), linhas: [] })
  if (error && semPermissao(error)) return json({ erro: 'só a Plataforma (ou o relógio, com a chave de serviço) atualiza as buscas do Google' }, 403)
  if (error) return json({ erro: /site_buscas_gravar|schema cache|function/i.test(error.message) ? 'rode antes a migração 160 (supabase/160_buscas_do_google.sql)' : error.message }, 500)
  return { origem: 'relogio', db: chamador }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  let corpo: { dias?: unknown; ate?: unknown } = {}
  try { corpo = await req.json() } catch { /* vazio */ }

  const quem = await quemChama(req, auth)
  if (quem instanceof Response) return quem
  const { origem, db } = quem
  const anotar = async (ok: boolean, extra: { de?: string; ate?: string; linhas?: number; parcial?: boolean; erro?: string }) => {
    // anotar não pode derrubar a resposta
    try {
      await db.rpc('site_buscas_registrar', {
        origem_: origem, ok_: ok, de_: extra.de ?? null, ate_: extra.ate ?? null,
        linhas_: extra.linhas ?? 0, parcial_: extra.parcial ?? false, erro_: extra.erro ?? null,
      })
    } catch { /* fica sem anotação */ }
  }

  // os dois segredos; sem eles, a tela mostra o passo a passo para ligar
  let conta: ContaServico, propriedade: string
  try {
    conta = lerContaServico(Deno.env.get('GSC_CONTA_SERVICO') ?? '')
    propriedade = normalizarPropriedade(Deno.env.get('GSC_PROPRIEDADE') ?? '')
  } catch (e) {
    const err = e instanceof ErroGsc ? e : new ErroGsc('sem_segredos', String((e as Error)?.message ?? e))
    await anotar(false, { erro: err.message })
    return json({ ok: false, codigo: err.codigo, erro: err.message })
  }

  // quantos dias: o que falta desde o último dia gravado (mais a folga), ou o pedido;
  // até que dia: hoje, ou o que o pedido disser (a continuação de um histórico parcial), dentro dos 16 meses
  const hoje = new Date().toISOString().slice(0, 10)
  const ate = typeof corpo.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(corpo.ate) && corpo.ate < hoje && diasEntre(corpo.ate, hoje) < DIAS_MAX ? corpo.ate : hoje
  const { data: ultimo, error: erroUltimo } = await db.from('site_buscas').select('dia').order('dia', { ascending: false }).limit(1).maybeSingle()
  if (erroUltimo) return json({ erro: /site_buscas|schema cache/i.test(erroUltimo.message) ? 'rode antes a migração 160 (supabase/160_buscas_do_google.sql)' : erroUltimo.message }, 500)
  const dias = Math.min(diasParaBuscar((ultimo as { dia?: string } | null)?.dia ?? null, ate, corpo.dias), diasEntre(somarDias(hoje, -(DIAS_MAX - 1)), ate) + 1)

  const lote = crypto.randomUUID()
  const gravar = async (linhas: LinhaSite[], diasInteiros: string[] | null) => {
    const { error } = await db.rpc('site_buscas_gravar', { lote_: lote, linhas, dias_: diasInteiros })
    if (error) throw new ErroGsc('banco', `não deu para gravar no banco: ${error.message.slice(0, 200)}`)
  }
  try {
    const resumo = await sincronizar({ conta, propriedade, dias, hoje: ate, fetcher: buscar, gravar, prazoMs: PRAZO_MS })
    await anotar(true, resumo)
    // o que ficou para trás (os dias de 'de' até o dia anterior a cobriu_de), para a tela continuar
    const faltam = resumo.parcial && resumo.cobriu_de ? Math.max(0, diasEntre(resumo.de, resumo.cobriu_de)) : 0
    return json({ ok: true, ...resumo, faltam_dias: faltam })
  } catch (e) {
    const err = e instanceof ErroGsc ? e : new ErroGsc('falhou', `não deu para buscar no Google: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
    await anotar(false, { erro: err.message })
    return json({ ok: false, codigo: err.codigo, erro: err.message })
  }
})
