/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions; o tsc confere o resto */
// guia-gerar (3.9): escreve com IA o texto de uma página do guia de salões e
// guarda como rascunho, esperando alguém da Plataforma aprovar.
//
// POST { lugar?: uuid, pagina?: uuid, contexto?: uuid, instrucao?: string, angulo?: string, provedor?: 'gemini' | 'groq' }
// com o Authorization de quem está logado na Plataforma.
//   lugar   uma linha de guia_lugares (a página de um salão)
//   pagina  uma linha de guia_paginas (a página da cidade ou de uma categoria)
//   contexto  3.28: a linha da cidade em guia_paginas: a IA sugere o "Sobre a cidade" e devolve sem gravar
//             ({ ok, contexto, confira, fontes }); quem guarda é a Plataforma, depois de alguém conferir.
//             Com gravar: true (3.30), a função grava (origem "ia") e devolve.
//   3.30: o "Sobre a cidade" nasce sozinho. Ao gerar qualquer página de uma cidade cujo contexto está vazio ou ainda é a
//   semente, a função escreve o contexto antes (no Gemini, pesquisando no Google; as fontes ficam gravadas), grava e segue.
//   O que a equipe editou à mão (origem "editado") nunca é tocado.
//   instrucao  o pedido do revisor ("mais curto", "fale de noivas"), até 400 letras
//   angulo     o id de um ângulo editorial (conteudo.ts) ou um tema em texto livre
//   provedor   3.27: qual IA escreve. Sem ele, GUIA_IA_PADRAO; sem ela, o Gemini se tiver chave, senão o Groq
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
  ANGULOS, ANGULOS_PAGINA, limpar, limparInstrucao, provedoresDe, escolherProvedor, bairroValido,
  prepararLugar, prepararPagina, angulosPara, escolherAngulo, escolherAbertura, anguloAnterior,
  montarPromptLugar, montarPromptPagina, frasesUsadas, gerarConteudo, maisParecido, comMeta, sugerirContexto, URL_GEMINI_NATIVA,
  type LugarLinha, type PaginaLinha, type LugarDaPagina, type Pedir, type PedirNativo, type Provedor, type BairroDaFicha,
} from './conteudo.ts'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// 3.27: Gemini (GEMINI_API_KEY, GUIA_IA_MODELO_GEMINI) e Groq (GROQ_API_KEY, GUIA_IA_MODELO) lado a lado; a Plataforma
// escolhe a cada geração e GUIA_IA_PADRAO decide quando ninguém escolhe. GUIA_IA_URL e GUIA_IA_CHAVE trocam o lado
// do Groq por outro provedor compatível com a OpenAI (OpenRouter, xAI)
const PROVEDORES = provedoresDe(Deno.env)
const IA_PADRAO = Deno.env.get('GUIA_IA_PADRAO') ?? ''

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

// a porta nativa do Gemini (3.30): só o "Sobre a cidade" passa por ela, para pesquisar no Google
const pedirNativoCom = (prov: Provedor): PedirNativo => async (modelo, corpo, timeoutMs) => {
  const r = await fetch(`${URL_GEMINI_NATIVA}/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': prov.chave, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: r.status, headers: r.headers, texto: await r.text() }
}
// a única porta para a rede da IA (conteudo.ts recebe isto e fica testável)
const pedirCom = (prov: Provedor): Pedir => async (corpo, timeoutMs) => {
  const r = await fetch(prov.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${prov.chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: r.status, headers: r.headers, texto: await r.text() }
}

type Linha = Record<string, unknown>
type Pedido = { lugar?: unknown; pagina?: unknown; contexto?: unknown; gravar?: unknown; instrucao?: unknown; angulo?: unknown; provedor?: unknown }

// os salões da cidade (ou de uma categoria) que viram o retrato (prepararPagina): bairros, ruas, horários, o que informam
async function lugaresDaCidade(db: SupabaseClient, cidadeSlug: string, categoria = ''): Promise<LugarDaPagina[]> {
  let consulta = db.from('guia_lugares').select('nome, bairro, categoria, servicos, horarios, endereco, atributos').eq('cidade_slug', cidadeSlug).in('status', VIVOS).limit(3000)
  if (categoria) consulta = consulta.eq('categoria', categoria)
  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LugarDaPagina[]
}

type PaginaDaCidade = PaginaLinha & { id: string; contexto: unknown; contexto_origem?: unknown }
type Escrita = Awaited<ReturnType<typeof sugerirContexto>> & { gravado?: boolean }
// a IA escreve o "Sobre a cidade" (3.28/3.30): no Gemini, pesquisando no Google; grava quando pedido (origem "ia",
// com o que conferir e as fontes em contexto_fontes). 'se_semente' só grava se a linha ainda estiver vazia ou com a
// semente (alguém pode ter editado enquanto a IA escrevia). Sem a 176, grava só o texto
async function escreverContexto(db: SupabaseClient, ia: Provedor, p: PaginaDaCidade, gravar: false | 'sempre' | 'se_semente'): Promise<Escrita> {
  const lugares = await lugaresDaCidade(db, String(p.cidade_slug ?? ''))
  const { ficha, checagem } = prepararPagina({ ...p, categoria: '' }, lugares, p.contexto)
  const atual = limpar(p.contexto, 1500) || null
  const r = await sugerirContexto({ ficha, atual, provedor: ia, checagem, pedir: pedirCom(ia), pedirNativo: ia.id === 'gemini' ? pedirNativoCom(ia) : undefined })
  if (!r.ok || !gravar) return { ...r, gravado: false }
  const fontes = { confira: r.confira, fontes: r.fontes, modelo: ia.modelo, provedor: ia.id, pesquisou: r.pesquisou, em: new Date().toISOString() }
  let gravacao = db.from('guia_paginas').update({ contexto: r.texto, contexto_origem: 'ia', contexto_fontes: fontes }).eq('id', p.id)
  if (gravar === 'se_semente') gravacao = gravacao.or('contexto_origem.is.null,contexto_origem.eq.semente')
  const { error } = await gravacao
  if (error && /contexto_(origem|fontes)/.test(error.message)) {
    const { error: e2 } = await db.from('guia_paginas').update({ contexto: r.texto }).eq('id', p.id)
    if (e2) return { ok: false, erro: e2.message }
  } else if (error) return { ok: false, erro: error.message }
  return { ...r, gravado: true }
}

// "Sobre a cidade" (3.22, migração 170): na linha da cidade em guia_paginas; vale para todas as páginas
// dela. 3.30: vazio ou ainda a semente (176), a IA escreve agora e grava, para esta e para as próximas
// páginas; o que a equipe editou fica. Sem a 176 (ou sem a 170), o que houver, como antes
async function contextoPronto(db: SupabaseClient, ia: Provedor, cidadeSlug: string): Promise<string | null> {
  const { data, error } = await db.from('guia_paginas').select('id, cidade, cidade_slug, uf, contexto, contexto_origem').eq('cidade_slug', cidadeSlug).eq('categoria', '').maybeSingle()
  if (error) return contextoDa(db, cidadeSlug)
  const p = data as unknown as PaginaDaCidade | null
  if (!p) return null
  const atual = limpar(p.contexto, 1500) || null
  // com texto que não é a semente (a IA já escreveu, ou alguém guardou), fica como está
  if (atual && p.contexto_origem !== 'semente') return atual
  try {
    const r = await escreverContexto(db, ia, p, 'se_semente')
    return r.ok ? r.texto : atual
  } catch { return atual }
}
async function contextoDa(db: SupabaseClient, cidadeSlug: string): Promise<string | null> {
  const { data } = await db.from('guia_paginas').select('contexto').eq('cidade_slug', cidadeSlug).eq('categoria', '').maybeSingle()
  const c = (data as { contexto?: unknown } | null)?.contexto
  return typeof c === 'string' && c.trim() ? c : null
}

async function gerarLugar(db: SupabaseClient, ia: Provedor, id: string, instrucao: string | null, pedidoAngulo: string | null): Promise<Response> {
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

  // 3.30: o bairro do salão no guia (a linha dele no retrato da cidade) e o "Sobre a cidade", escrito agora se ainda não há
  let bairro: BairroDaFicha | null = null
  try {
    const retrato = prepararPagina({ cidade: String(l.cidade ?? ''), cidade_slug: String(l.cidade_slug ?? ''), uf: l.uf, categoria: '' }, await lugaresDaCidade(db, String(l.cidade_slug ?? '')))
    const meu = bairroValido(l.bairro)
    bairro = (meu && retrato.ficha.onde_ficam.find((b) => b.bairro === meu)) || null
  } catch { bairro = null }
  const { ficha, cidade, checagem } = prepararLugar(l, await contextoPronto(db, ia, String(l.cidade_slug ?? '')), bairro)
  const anterior = l.rascunho ?? l.conteudo ?? null
  const candidatos = angulosPara(l.categoria, ficha.servicos_divulgados, cidade.praia)
  const angulo = escolherAngulo({ candidatos, todos: ANGULOS[l.categoria] ?? ANGULOS.beleza, semente: l.slug, pedido: pedidoAngulo, anterior: anguloAnterior(anterior) })
  const mensagens = montarPromptLugar({
    ficha, cidade, angulo, instrucao, anterior,
    abertura: escolherAbertura(l.slug, angulo, candidatos, !!(ficha.bairro || ficha.endereco)),
    jaUsadas: frasesUsadas(outros.map((o) => ({ sobre: o.r_sobre ?? o.c_sobre, chamada: o.r_chamada ?? o.c_chamada }))),
  })

  const g = await gerarConteudo({ tipo: 'lugar', mensagens, checagem, modelo: ia.modelo, pedir: pedirCom(ia) })
  if (!g.ok) return json(g.limite ? { ok: false, erro: g.erro, tentar_em: g.tentarEm } : { ok: false, erro: g.erro })

  const semelhanca = maisParecido((g.conteudo as { sobre: string[] }).sobre, outros.flatMap((o) => [{ slug: String(o.slug), texto: o.c_sobre }, { slug: String(o.slug), texto: o.r_sobre }]))
  const rascunho = comMeta(g.conteudo, { modelo: ia.modelo, provedor: ia.id, angulo: angulo.id, instrucao, semelhanca, avisos: g.avisos })
  // importado/descartado viram "gerado"; publicado continua publicado (a página
  // no ar só muda quando aprovarem); removido nunca é tocado
  const mudanca: Linha = { rascunho, gerado_em: rascunho._meta.gerado_em }
  if (l.status === 'importado' || l.status === 'descartado') mudanca.status = 'gerado'
  const { data: gravado, error: erroGravar } = await db.from('guia_lugares').update(mudanca).eq('id', l.id).neq('status', 'removido').select('id').maybeSingle()
  if (erroGravar) return json({ erro: erroGravar.message }, 500)
  if (!gravado) return json({ erro: 'o salão saiu do guia enquanto a IA escrevia' }, 409)
  return json({ ok: true, rascunho })
}

async function gerarPagina(db: SupabaseClient, ia: Provedor, id: string, instrucao: string | null, pedidoAngulo: string | null): Promise<Response> {
  const { data, error } = await db.from('guia_paginas').select('id, cidade, cidade_slug, uf, categoria, status, conteudo, rascunho').eq('id', id).maybeSingle()
  if (error) return json({ erro: error.message }, 500)
  if (!data) return json({ erro: 'página não encontrada no guia' }, 404)
  const p = data as unknown as PaginaLinha & { id: string; categoria: string; conteudo: unknown; rascunho: unknown }

  // os salões da cidade (ou da categoria) viram números para o texto; os
  // nomes só servem para a validação recusar texto que cite algum
  // 3.26: o endereço e os atributos entram no retrato da cidade (ruas com mais lugares, o que os cadastros informam)
  let lugares: LugarDaPagina[]
  try { lugares = await lugaresDaCidade(db, String(p.cidade_slug ?? ''), String(p.categoria ?? '')) } catch (e) { return json({ erro: String((e as Error).message) }, 500) }
  if (!lugares.length) return json({ erro: 'ainda não há salões desta cidade ou categoria no guia' }, 409)

  const { data: irmasCru } = await db.from('guia_paginas')
    .select('cidade_slug, categoria, c_intro:conteudo->intro, r_intro:rascunho->intro')
    .eq('cidade_slug', p.cidade_slug).neq('id', p.id)
  const irmas = (irmasCru ?? []) as unknown as Linha[]

  const { ficha, cidade, checagem } = prepararPagina(p, lugares, await contextoPronto(db, ia, String(p.cidade_slug ?? '')))
  const anterior = p.rascunho ?? p.conteudo ?? null
  const candidatos = ANGULOS_PAGINA.filter((a) => !a.praia || cidade.praia)
  const angulo = escolherAngulo({ candidatos, todos: ANGULOS_PAGINA, semente: `${p.cidade_slug}/${p.categoria}`, pedido: pedidoAngulo, anterior: anguloAnterior(anterior) })
  const mensagens = montarPromptPagina({ ficha, cidade, angulo, instrucao, anterior })

  const g = await gerarConteudo({ tipo: 'pagina', mensagens, checagem: { ...checagem, angulo: angulo.id }, modelo: ia.modelo, pedir: pedirCom(ia) })
  if (!g.ok) return json(g.limite ? { ok: false, erro: g.erro, tentar_em: g.tentarEm } : { ok: false, erro: g.erro })

  const semelhanca = maisParecido((g.conteudo as { intro: string[] }).intro, irmas.flatMap((o) => {
    const slug = String(o.categoria || o.cidade_slug)
    return [{ slug, texto: o.c_intro }, { slug, texto: o.r_intro }]
  }))
  const rascunho = comMeta(g.conteudo, { modelo: ia.modelo, provedor: ia.id, angulo: angulo.id, instrucao, semelhanca, avisos: g.avisos })
  const { error: erroGravar } = await db.from('guia_paginas').update({ rascunho, gerado_em: rascunho._meta.gerado_em }).eq('id', p.id)
  if (erroGravar) return json({ erro: erroGravar.message }, 500)
  return json({ ok: true, rascunho })
}

// 3.28: a sugestão do "Sobre a cidade": o que a IA sabe da cidade (3.30: o que ela pesquisou no Google, no Gemini),
// ancorado nos bairros e nas ruas que o guia tem. Sem gravar, a Plataforma mostra, alguém confere (a lista "confira")
// e guarda; com gravar (o botão "escrever todas"), a função grava e devolve
async function gerarContexto(db: SupabaseClient, ia: Provedor, id: string, gravar: boolean): Promise<Response> {
  const { data, error } = await db.from('guia_paginas').select('id, cidade, cidade_slug, uf, categoria, contexto').eq('id', id).maybeSingle()
  if (error) return json({ erro: error.message }, 500)
  if (!data) return json({ erro: 'página não encontrada no guia' }, 404)
  const p = data as unknown as PaginaDaCidade & { categoria: string }
  if (p.categoria) return json({ erro: '"Sobre a cidade" é da página da cidade, não da categoria' }, 400)
  let r: Escrita
  try { r = await escreverContexto(db, ia, p, gravar ? 'sempre' : false) } catch (e) { return json({ erro: String((e as Error).message) }, 500) }
  if (!r.ok) return json(r.limite ? { ok: false, erro: r.erro, tentar_em: r.tentarEm } : { ok: false, erro: r.erro })
  return json({ ok: true, contexto: r.texto, confira: r.confira, fontes: r.fontes, pesquisou: r.pesquisou, gravado: !!r.gravado, modelo: ia.modelo, provedor: ia.id, avisos: r.avisos })
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
  const contexto = limpar(corpo.contexto, 40)
  const alvos = [lugar, pagina, contexto].filter(Boolean)
  if (alvos.length !== 1) return json({ erro: 'mande lugar, pagina ou contexto (um dos três)' }, 400)
  if (!UUID.test(alvos[0])) return json({ erro: 'id inválido' }, 400)

  // quem pede é a Plataforma? (como a própria pessoa, pela RPC de sempre)
  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: plataforma, error: erroPapel } = await quem.rpc('eh_plataforma')
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma gera o texto do guia' }, 403)
  const escolha = escolherProvedor(corpo.provedor, PROVEDORES, IA_PADRAO)
  if ('erro' in escolha) return json({ erro: escolha.erro }, /desconhecido/.test(escolha.erro) ? 400 : 500)
  const ia = escolha.provedor

  // o resto com a service role: a função lê os vizinhos e grava o rascunho
  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const instrucao = limparInstrucao(corpo.instrucao)
  const angulo = limpar(corpo.angulo, 200) || null
  try {
    if (contexto) return await gerarContexto(servico, ia, contexto, corpo.gravar === true)
    return lugar ? await gerarLugar(servico, ia, lugar, instrucao, angulo) : await gerarPagina(servico, ia, pagina, instrucao, angulo)
  } catch (e) {
    return json({ erro: `não deu para gerar: ${String((e as Error)?.message ?? e).slice(0, 200)}` }, 500)
  }
})
