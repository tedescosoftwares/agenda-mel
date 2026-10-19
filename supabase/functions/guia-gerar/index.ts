/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions; o tsc confere o resto */
// guia-gerar (3.9): escreve com IA o texto de uma página do guia de salões e
// guarda como rascunho, esperando alguém da Plataforma aprovar.
//
// POST { lugar?: uuid, pagina?: uuid, instrucao?: string, angulo?: string }
// com o Authorization de quem está logado na Plataforma.
//   lugar   uma linha de guia_lugares (a página de um salão)
//   pagina  uma linha de guia_paginas (a página da cidade ou de uma categoria)
//   instrucao  o pedido do revisor ("mais curto", "fale de noivas"), até 400 letras
//   angulo     o id de um ângulo editorial (conteudo.ts) ou um tema em texto livre
//
// Respostas:
//   200 { ok: true, rascunho }                       gravado em rascunho, com _meta
//   200 { ok: false, erro, tentar_em }               limite da IA (429): espere e chame de novo
//   200 { ok: false, erro }                          a IA falhou ou errou duas vezes
//   400/401/403/404/409/500 { erro }                 pedido, permissão ou dado
//
// O prompt, a ficha, a validação e a semelhança moram em conteudo.ts (puro,
// testado com node). Aqui ficam só o banco e a rede. Desde a 3.22 a ficha do
// salão leva os atributos do cadastro (pagamento, acessibilidade, estacionamento)
// e todas as páginas da cidade levam o "Sobre a cidade" da Plataforma (170).
//
// Nada vai para o ar daqui: o texto fica em rascunho até guia_aprovar(). Um
// salão já publicado continua com a página de antes enquanto a versão nova
// espera revisão.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  URL_GROQ, MODELO_PADRAO, ANGULOS, ANGULOS_PAGINA, limpar, limparInstrucao,
  prepararLugar, prepararPagina, angulosPara, escolherAngulo, escolherAbertura, anguloAnterior,
  montarPromptLugar, montarPromptPagina, frasesUsadas, gerarConteudo, maisParecido, comMeta,
  type LugarLinha, type PaginaLinha, type LugarDaPagina, type Pedir,
} from './conteudo.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// qualquer API compatível com a da OpenAI serve (ex.: xAI): troque a URL, a chave e o modelo
const URL_IA = Deno.env.get('GUIA_IA_URL') || URL_GROQ
const CHAVE_IA = Deno.env.get('GUIA_IA_CHAVE') || Deno.env.get('GROQ_API_KEY') || ''
const MODELO = Deno.env.get('GUIA_IA_MODELO') || MODELO_PADRAO

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// quem pode servir de contexto e de comparação (descartado e removido, não)
const VIVOS = ['importado', 'gerado', 'publicado']
// a lista fechada do que se lê de um salão: nota, avaliações, CNPJ,
// coordenadas e o CSV de origem nem saem do banco
const COLUNAS_LUGAR = 'id, slug, nome, categoria, cidade, cidade_slug, uf, bairro, endereco, telefone, whatsapp, instagram, site, horarios, servicos, selecao, salon_id, status, conteudo, rascunho, atributos'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

// a única porta para a rede da IA (conteudo.ts recebe isto e fica testável)
const pedir: Pedir = async (corpo, timeoutMs) => {
  const r = await fetch(URL_IA, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CHAVE_IA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: r.status, headers: r.headers, texto: await r.text() }
}

type Linha = Record<string, unknown>
type Pedido = { lugar?: unknown; pagina?: unknown; instrucao?: unknown; angulo?: unknown }

// "Sobre a cidade" (3.22, migração 170): na linha da cidade em guia_paginas; vale para todas as páginas
// dela. Sem a coluna (banco sem a 170) ou sem texto, null, e o conteudo.ts usa o que tem
async function contextoDa(db: SupabaseClient, cidadeSlug: string): Promise<string | null> {
  const { data } = await db.from('guia_paginas').select('contexto').eq('cidade_slug', cidadeSlug).eq('categoria', '').maybeSingle()
  const c = (data as { contexto?: unknown } | null)?.contexto
  return typeof c === 'string' && c.trim() ? c : null
}

async function gerarLugar(db: SupabaseClient, id: string, instrucao: string | null, pedidoAngulo: string | null): Promise<Response> {
  const { data, error } = await db.from('guia_lugares').select(COLUNAS_LUGAR).eq('id', id).maybeSingle()
  if (error) return json({ erro: error.message }, 500)
  if (!data) return json({ erro: 'salão não encontrado no guia' }, 404)
  const l = data as unknown as LugarLinha & { id: string; status: string; conteudo: unknown; rascunho: unknown }
  if (l.status === 'removido') return json({ erro: 'este salão saiu do guia a pedido do dono; não dá para gerar' }, 409)

  // os outros da mesma cidade e categoria: para comparar o texto e para o
  // modelo não abrir todas as páginas do mesmo jeito (só o que interessa do jsonb)
  const { data: outrosCru } = await db.from('guia_lugares')
    .select('slug, c_sobre:conteudo->sobre, r_sobre:rascunho->sobre, c_chamada:conteudo->>chamada, r_chamada:rascunho->>chamada')
    .eq('cidade_slug', l.cidade_slug).eq('categoria', l.categoria).neq('id', l.id).in('status', VIVOS)
    .or('conteudo.not.is.null,rascunho.not.is.null')
    .order('gerado_em', { ascending: false, nullsFirst: false })
    .limit(300)
  const outros = (outrosCru ?? []) as unknown as Linha[]

  const { ficha, cidade, checagem } = prepararLugar(l, await contextoDa(db, String(l.cidade_slug ?? '')))
  const anterior = l.rascunho ?? l.conteudo ?? null
  const candidatos = angulosPara(l.categoria, ficha.servicos_divulgados, cidade.praia)
  const angulo = escolherAngulo({ candidatos, todos: ANGULOS[l.categoria] ?? ANGULOS.beleza, semente: l.slug, pedido: pedidoAngulo, anterior: anguloAnterior(anterior) })
  const mensagens = montarPromptLugar({
    ficha, cidade, angulo, instrucao, anterior,
    abertura: escolherAbertura(l.slug, angulo, candidatos, !!(ficha.bairro || ficha.endereco)),
    jaUsadas: frasesUsadas(outros.map((o) => ({ sobre: o.r_sobre ?? o.c_sobre, chamada: o.r_chamada ?? o.c_chamada }))),
  })

  const g = await gerarConteudo({ tipo: 'lugar', mensagens, checagem, modelo: MODELO, pedir })
  if (!g.ok) return json(g.limite ? { ok: false, erro: g.erro, tentar_em: g.tentarEm } : { ok: false, erro: g.erro })

  const semelhanca = maisParecido((g.conteudo as { sobre: string[] }).sobre, outros.flatMap((o) => [{ slug: String(o.slug), texto: o.c_sobre }, { slug: String(o.slug), texto: o.r_sobre }]))
  const rascunho = comMeta(g.conteudo, { modelo: MODELO, angulo: angulo.id, instrucao, semelhanca, avisos: g.avisos })
  // importado/descartado viram "gerado"; publicado continua publicado (a página
  // no ar só muda quando aprovarem); removido nunca é tocado
  const mudanca: Linha = { rascunho, gerado_em: rascunho._meta.gerado_em }
  if (l.status === 'importado' || l.status === 'descartado') mudanca.status = 'gerado'
  const { data: gravado, error: erroGravar } = await db.from('guia_lugares').update(mudanca).eq('id', l.id).neq('status', 'removido').select('id').maybeSingle()
  if (erroGravar) return json({ erro: erroGravar.message }, 500)
  if (!gravado) return json({ erro: 'o salão saiu do guia enquanto a IA escrevia' }, 409)
  return json({ ok: true, rascunho })
}

async function gerarPagina(db: SupabaseClient, id: string, instrucao: string | null, pedidoAngulo: string | null): Promise<Response> {
  const { data, error } = await db.from('guia_paginas').select('id, cidade, cidade_slug, uf, categoria, status, conteudo, rascunho').eq('id', id).maybeSingle()
  if (error) return json({ erro: error.message }, 500)
  if (!data) return json({ erro: 'página não encontrada no guia' }, 404)
  const p = data as unknown as PaginaLinha & { id: string; categoria: string; conteudo: unknown; rascunho: unknown }

  // os salões da cidade (ou da categoria) viram números para o texto; os
  // nomes só servem para a validação recusar texto que cite algum
  // 3.26: o endereço e os atributos entram no retrato da cidade (ruas com mais lugares, o que os cadastros informam)
  let consulta = db.from('guia_lugares').select('nome, bairro, categoria, servicos, horarios, endereco, atributos').eq('cidade_slug', p.cidade_slug).in('status', VIVOS).limit(3000)
  if (p.categoria) consulta = consulta.eq('categoria', p.categoria)
  const { data: lugares, error: erroLugares } = await consulta
  if (erroLugares) return json({ erro: erroLugares.message }, 500)
  if (!lugares?.length) return json({ erro: 'ainda não há salões desta cidade ou categoria no guia' }, 409)

  const { data: irmasCru } = await db.from('guia_paginas')
    .select('cidade_slug, categoria, c_intro:conteudo->intro, r_intro:rascunho->intro')
    .eq('cidade_slug', p.cidade_slug).neq('id', p.id)
  const irmas = (irmasCru ?? []) as unknown as Linha[]

  const { ficha, cidade, checagem } = prepararPagina(p, lugares as unknown as LugarDaPagina[], await contextoDa(db, String(p.cidade_slug ?? '')))
  const anterior = p.rascunho ?? p.conteudo ?? null
  const candidatos = ANGULOS_PAGINA.filter((a) => !a.praia || cidade.praia)
  const angulo = escolherAngulo({ candidatos, todos: ANGULOS_PAGINA, semente: `${p.cidade_slug}/${p.categoria}`, pedido: pedidoAngulo, anterior: anguloAnterior(anterior) })
  const mensagens = montarPromptPagina({ ficha, cidade, angulo, instrucao, anterior })

  const g = await gerarConteudo({ tipo: 'pagina', mensagens, checagem: { ...checagem, angulo: angulo.id }, modelo: MODELO, pedir })
  if (!g.ok) return json(g.limite ? { ok: false, erro: g.erro, tentar_em: g.tentarEm } : { ok: false, erro: g.erro })

  const semelhanca = maisParecido((g.conteudo as { intro: string[] }).intro, irmas.flatMap((o) => {
    const slug = String(o.categoria || o.cidade_slug)
    return [{ slug, texto: o.c_intro }, { slug, texto: o.r_intro }]
  }))
  const rascunho = comMeta(g.conteudo, { modelo: MODELO, angulo: angulo.id, instrucao, semelhanca, avisos: g.avisos })
  const { error: erroGravar } = await db.from('guia_paginas').update({ rascunho, gerado_em: rascunho._meta.gerado_em }).eq('id', p.id)
  if (erroGravar) return json({ erro: erroGravar.message }, 500)
  return json({ ok: true, rascunho })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  let corpo: Pedido = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const lugar = limpar(corpo.lugar, 40)
  const pagina = limpar(corpo.pagina, 40)
  if (!!lugar === !!pagina) return json({ erro: 'mande lugar ou pagina (um dos dois)' }, 400)
  if (!UUID.test(lugar || pagina)) return json({ erro: 'id inválido' }, 400)

  // quem pede é a Plataforma? (como a própria pessoa, pela RPC de sempre)
  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: plataforma, error: erroPapel } = await quem.rpc('eh_plataforma')
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma gera o texto do guia' }, 403)
  if (!CHAVE_IA) return json({ erro: 'a chave da IA não está configurada (supabase secrets set GROQ_API_KEY=...)' }, 500)

  // o resto com a service role: a função lê os vizinhos e grava o rascunho
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const instrucao = limparInstrucao(corpo.instrucao)
  const angulo = limpar(corpo.angulo, 200) || null
  try {
    return lugar ? await gerarLugar(servico, lugar, instrucao, angulo) : await gerarPagina(servico, pagina, instrucao, angulo)
  } catch (e) {
    return json({ erro: `não deu para gerar: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, 500)
  }
})
