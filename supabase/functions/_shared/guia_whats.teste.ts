// Testes da Mel do guia (4.6, pacote 1 das conversas reais), sem rede e sem banco:
//
//   node --experimental-strip-types supabase/functions/_shared/guia_whats.teste.ts
//
// O banco (guia_whats_*) é de mentira, em memória, só com o que a Mel usa; a busca por nome devolve o que cada caso
// combina (a busca de verdade, guia_whats_buscar da migração 261, é testada no Postgres). Os textos dos casos vêm das
// conversas reais exportadas (22/10 a 24/11).
import assert from 'node:assert/strict'
import { atenderGuia, ehRespostaAutomatica, pedidoDeParar, escolhasDe, textoOcioso, MSG_PAROU, MSG_SEM_SALAO, MSG_SEM_SALAO_DICA, type Deps, type Opcao, type PedidoIa, type LeituraIa } from './guia_whats.ts'

let ok = 0
async function caso(nome: string, f: () => Promise<void> | void) {
  try { await f(); ok++; console.log('  ✓', nome) } catch (e) { console.error('  ✗', nome); throw e }
}

// ---- o banco de mentira ---------------------------------------------------------------------------------------------
type Conv = { id: number; telefone: string; lugar_id: string | null; estado: string; dados: Record<string, unknown>; mensagens: Array<{ q: string; t: string }>; lead_id?: number | null }
type Lugar = { id: string; nome: string; cidade: string; cidade_slug: string; slug: string; bairro: string; salao_tel: string | null; whatsapp?: string | null; servicos?: string[]; agendar?: string | null }
const LUGARES: Lugar[] = [
  { id: 'a', nome: 'Studio Dharma', cidade: 'São Vicente', cidade_slug: 'sao-vicente', slug: 'studio-dharma', bairro: 'Centro', salao_tel: '5513911110001' },
  { id: 'b', nome: 'Espaço Spa Dharma', cidade: 'Santos', cidade_slug: 'santos', slug: 'espaco-spa-dharma', bairro: 'Aparecida', salao_tel: '5513911110002' },
  { id: 'c', nome: 'Lash Tatiane Paes', cidade: 'São José dos Campos', cidade_slug: 'sao-jose-dos-campos', slug: 'lash-tatiane-paes', bairro: 'Centro', salao_tel: '5512911110003' },
  { id: 'd', nome: 'Gabi Mendes Beauty', cidade: 'Guaratinguetá', cidade_slug: 'guaratingueta', slug: 'gabi-mendes-beauty', bairro: 'Centro', salao_tel: '5512911110004' },
]
const ofertadas: Opcao[] = [
  { id: 'b', nome: 'Espaço Spa Dharma', bairro: 'Aparecida' },
  { id: 'c', nome: 'Lash Tatiane Paes', bairro: 'Centro' },
  { id: 'd', nome: 'Gabi Mendes Beauty', bairro: 'Centro' },
]

function banco(o: { busca?: Record<string, string[]>; ia?: (p: PedidoIa) => Partial<LeituraIa>; leadSalao?: Record<string, unknown> | null; saidas?: Record<string, string> } = {}) {
  const convs: Conv[] = []
  const leads: Array<Record<string, unknown>> = []
  const saidas = new Map<string, string>(Object.entries(o.saidas ?? {}))
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = []
  const enviados: Array<{ tel: string; texto: string }> = []
  const iaPedidos: PedidoIa[] = []
  const cfg = { ligado: true, numero: '5513991151099', numero_avisos: null, instancia: 'mimo-guia', provedor: 'groq', modelo: null, orientacao: 'Você é a Mel, do guia {salao}.', msg_cliente: 'Oi', msg_salao: 'Pedido para {salao}: {cliente} quer {servico}. {link}', msg_salao_resposta: 'Obrigada!', mostrar_contato_salao: false, enquete_ativa: false, resgate_min: 30, resgate_opcoes: 3, insta_ligado: false }
  const lugarDe = (id: string | null | undefined) => LUGARES.find((l) => l.id === id) ?? null
  let nId = 0
  const rpc: Deps['rpc'] = async (nome, args) => {
    chamadas.push({ nome, args })
    const tel = String(args.tel_ ?? '')
    switch (nome) {
      case 'guia_whats_contexto': {
        const cv = [...convs].reverse().find((c) => c.telefone === tel) ?? null
        return { data: { config: cfg, saida: saidas.get(tel) ?? null, respostas_hoje: 0, lead_salao: o.leadSalao ?? null, conversa: cv ? { ...structuredClone(cv), lugar: lugarDe(cv.lugar_id) } : null }, error: null }
      }
      case 'guia_whats_conversa_salvar': {
        const novas = (args.novas_ as Conv['mensagens']) ?? []
        if (args.id_ == null) {
          const c: Conv = { id: ++nId, telefone: tel, lugar_id: (args.lugar_ as string) ?? null, estado: String(args.estado_), dados: structuredClone(args.dados_ as Record<string, unknown>), mensagens: [...novas] }
          convs.push(c)
          return { data: c.id, error: null }
        }
        const c = convs.find((x) => x.id === args.id_)!
        c.lugar_id = (args.lugar_ as string) ?? c.lugar_id
        c.estado = String(args.estado_)
        c.dados = structuredClone(args.dados_ as Record<string, unknown>)
        c.mensagens.push(...novas)
        return { data: c.id, error: null }
      }
      case 'guia_whats_lugar': return { data: lugarDe(args.id_ as string) ?? LUGARES.find((l) => l.cidade_slug === args.cidade_ && l.slug === args.slug_) ?? null, error: null }
      case 'guia_whats_buscar': {
        const ids = o.busca?.[String(args.texto_)] ?? []
        return { data: ids.map((id) => { const l = lugarDe(id)!; return { id: l.id, nome: l.nome, cidade: l.cidade, bairro: l.bairro } }), error: null }
      }
      case 'guia_whats_sair': { if (args.sair_) saidas.set(tel, String(args.quem_)); else saidas.delete(tel); return { data: null, error: null } }
      case 'guia_whats_cliente_saiu': return { data: saidas.get(tel) === 'cliente', error: null }
      case 'guia_whats_lead_criar': {
        const c = convs.find((x) => x.id === args.conversa_)!
        const l = lugarDe(c.lugar_id)!
        const ld = { id: leads.length + 1, conversa_id: c.id, salao_nome: l.nome, cidade: l.cidade, cliente_nome: c.dados.nome, cliente_tel: c.telefone, servico: c.dados.servico, preferencia: c.dados.preferencia, salao_tel: l.salao_tel, status: l.salao_tel ? 'pendente' : 'sem_contato', token: `tok${leads.length + 1}xxxxxxxx`, repetido: false }
        leads.push(ld); c.lead_id = ld.id
        return { data: ld, error: null }
      }
      case 'guia_whats_lead_resultado': return { data: { status: args.ok_ ? 'enviado' : 'falhou' }, error: null }
      case 'guia_whats_insta_convidar': return { data: null, error: null }
      case 'comercial_publico': return { data: { ligado: false }, error: null }
      case 'guia_whats_salao_respondeu': return { data: null, error: null }
      case 'guia_whats_voto': return { data: { id: 7, salao_nome: 'Espaço Spa Dharma', cliente_nome: 'Ana', cliente_tel: '5513988887777', servico: 'massagem', primeiro: true, resgate_em: null }, error: null }
      case 'guia_whats_cliente_seguiu': return { data: false, error: null }
      case 'guia_whats_alternativas': return { data: ofertadas, error: null }
      case 'guia_whats_oferecer': return { data: 1, error: null }
      default: return { data: null, error: { message: `rpc de mentira não conhece ${nome}` } }
    }
  }
  const deps: Deps = {
    rpc,
    ia: async (p) => {
      iaPedidos.push(p)
      const base: LeituraIa = { resposta: 'Qual serviço você quer?', nome: '', servico: '', preferencia: '', observacao: '', cliente_confirmou_envio: false, cancelar: false, quer_apagar_dados: false, sobre_agenda: false, dona_do_salao: false }
      return { leitura: { ...base, ...(o.ia?.(p) ?? {}) } }
    },
    enviar: async (_i, telefone, texto) => { enviados.push({ tel: telefone, texto }); return { ok: true, providerId: 'p1' } },
    agora: () => new Date('2026-11-20T15:00:00Z'),
  }
  // uma conversa já aberta (a oferta de outros salões, o resumo...)
  const abrir = (c: Partial<Conv> & { telefone: string }) => { const cv: Conv = { id: ++nId, lugar_id: null, estado: 'conversando', dados: {}, mensagens: [], ...c }; convs.push(cv); return cv }
  return { deps, convs, leads, saidas, chamadas, enviados, iaPedidos, abrir }
}
const CLIENTE = '+5513988887777'
const fala = (b: ReturnType<typeof banco>, texto: string, tel = CLIENTE, extra: Record<string, unknown> = {}) => atenderGuia(b.deps, { telefone: tel, texto, nomePerfil: 'Ana', ...extra })

console.log('a Mel do guia (4.6)')

// ---- as funções de texto ---------------------------------------------------------------------------------------------
await caso('resposta automática do WhatsApp Business é reconhecida (textos reais)', () => {
  assert.ok(ehRespostaAutomatica('Olá! 😊\nNeste momento estou fora do horário de atendimento.\nAssim que eu retornar, responderei com carinho.\nObrigada pela compreensão! 💛'))
  assert.ok(ehRespostaAutomatica('Olá! Aqui é a Dra Bruna!\n\nSeja bem-vinda 🌸\n\n📧 *Sobre a compra de produtos online:* Mande mensagem pro nosso suporte'))
  assert.ok(ehRespostaAutomatica('Oi! Estou fora do meu horário, em breve estarei com você 💕'))
  assert.ok(ehRespostaAutomatica('Esta é uma mensagem automática. Retornaremos o mais breve possível.'))
  assert.ok(ehRespostaAutomatica('Digite o número da opção desejada: 1 agendamento 2 valores'))
})
await caso('resposta de gente não é tomada por automática', () => {
  for (const t of ['Oi! Pode sim, qual horário fica bom?', 'No momento estou atendendo, já te chamo', 'Obrigada pelo contato! Qual o melhor horário?', 'No momento não consigo atender, agenda cheia', 'Bom dia! Tenho horário amanhã às 14h'])
    assert.equal(ehRespostaAutomatica(t), false, t)
})
await caso('"parar" e companhia; "para sexta" não', () => {
  for (const t of ['Parar', 'parar', 'Pare', 'Encerrar', 'Para de manda mensagem', 'para de me mandar mensagem', 'Não me mande mais mensagens', 'me tira dessa lista', 'Sair', 'STOP', 'encerrar conversa'])
    assert.ok(pedidoDeParar(t), t)
  for (const t of ['para quando tem horário?', 'quero marcar para sexta', 'Para mim pode ser de manhã', 'não quero esperar', 'cancelar o pedido'])
    assert.equal(pedidoDeParar(t), false, t)
})
await caso('vários números na oferta: só quando a frase é a lista', () => {
  assert.deepEqual(escolhasDe('1 e 3', ofertadas).map((o) => o.id), ['b', 'd'])
  assert.deepEqual(escolhasDe('o 2 ou o 3', ofertadas).map((o) => o.id), ['c', 'd'])
  assert.deepEqual(escolhasDe('pode ser às 3', ofertadas), [])
  assert.deepEqual(escolhasDe('2', ofertadas), [])
})
await caso('lembrete conforme a etapa', () => {
  assert.equal(textoOcioso('Oi! Vi que a gente parou por aqui 💗 Quer que eu envie seu pedido ao salão agora?', { estado: 'confirmando', salao: 'Studio X', nome: 'Ana Paula' }), 'Oi! Vi que a gente parou por aqui 💗 Quer que eu envie seu pedido ao salão agora?')
  assert.equal(textoOcioso(null, { estado: 'conversando', salao: 'Studio X', nome: 'Ana Paula' }), 'Oi, Ana! Ficou faltando só o serviço que você quer para eu passar o seu pedido para o Studio X 💗 Se preferir continuar depois, tudo bem: é só me chamar.')
  assert.equal(textoOcioso(null, { estado: 'conversando', salao: 'Studio X' }), 'Oi! Ficou faltando só o seu nome e o serviço que você quer para eu passar o seu pedido para o Studio X 💗 Se preferir continuar depois, tudo bem: é só me chamar.')
  assert.match(textoOcioso(null, { estado: 'conversando', salao: 'Studio X', nome: 'Ana', servico: 'unha' }, true), /o dia e o horário de preferência/)
})

// ---- a conversa ------------------------------------------------------------------------------------------------------
await caso('sem salão: pede duas vezes (a segunda com o caminho do botão) e depois fica quieta', async () => {
  const b = banco()
  const r1 = await fala(b, 'como funciona')
  assert.equal(r1.responder, MSG_SEM_SALAO)
  const r2 = await fala(b, 'Sou de Santos')
  assert.equal(r2.responder, MSG_SEM_SALAO_DICA)
  const r3 = await fala(b, 'Nail designer')
  assert.equal(r3.responder, null)
  assert.equal(r3.acao, 'sem_salao_quieta')
  assert.equal(b.convs.length, 1)
  assert.equal(b.convs[0].mensagens.filter((m) => m.q === 'cliente').length, 3) // o que ela escreveu fica guardado
})
await caso('"parar" encerra, sai da lista, responde uma vez; escrever de novo volta', async () => {
  const b = banco()
  await fala(b, 'oi quero marcar')
  const r = await fala(b, 'Parar')
  assert.equal(r.responder, MSG_PAROU)
  assert.equal(b.convs.at(-1)!.estado, 'encerrada')
  assert.equal(b.saidas.get(CLIENTE.replace('+', '')), 'cliente')
  const r2 = await fala(b, 'parar')
  assert.equal(r2.responder, null)
  assert.equal(r2.acao, 'parou_de_novo')
  const r3 = await fala(b, 'oi, quero marcar unha')
  assert.equal(r3.responder, MSG_SEM_SALAO)
  assert.equal(b.saidas.has(CLIENTE.replace('+', '')), false)
})
await caso('resposta automática de um WhatsApp Business que cai como cliente: silêncio, nada gravado', async () => {
  const b = banco({ busca: { 'Olá! Aqui é a Dra Bruna! Seja bem-vinda 🌸': ['a', 'b'] } })
  const r = await fala(b, 'Olá! Aqui é a Dra Bruna! Seja bem-vinda 🌸')
  assert.equal(r.responder, null)
  assert.equal(r.acao, 'resposta_automatica')
  assert.equal(b.convs.length, 0)
})
await caso('resposta automática do salão: guardada como automática, sem voto e sem resposta', async () => {
  const b = banco({ leadSalao: { id: 7, salao_nome: 'Espaço Spa Dharma', status: 'enviado', ja_respondeu: false, voto: null } })
  const r = await fala(b, 'Olá! 😊 Neste momento estou fora do horário de atendimento. Assim que eu retornar, responderei com carinho.', '+5513911110002')
  assert.equal(r.responder, null)
  assert.equal(r.acao, 'salao_automatica')
  const c = b.chamadas.find((x) => x.nome === 'guia_whats_salao_respondeu')!
  assert.equal(c.args.auto_, true)
  assert.equal(b.chamadas.some((x) => x.nome === 'guia_whats_voto'), false)
})
await caso('o "não consigo" de gente continua sendo o voto do salão', async () => {
  const b = banco({ leadSalao: { id: 7, salao_nome: 'Espaço Spa Dharma', status: 'enviado', ja_respondeu: false, voto: null } })
  await fala(b, 'No momento não consigo atender, agenda cheia', '+5513911110002')
  assert.ok(b.chamadas.some((x) => x.nome === 'guia_whats_voto' && x.args.voto_ === 'nao'))
})
await caso('nome achado: a Mel confirma antes (vários = lista numerada; o número escolhe)', async () => {
  const b = banco({ busca: { 'quero marcar no dharma': ['a', 'b'] } })
  const r = await fala(b, 'quero marcar no dharma')
  assert.equal(r.acao, 'confirmar_salao')
  assert.match(r.responder!, /1\) Studio Dharma · Centro, São Vicente\n2\) Espaço Spa Dharma · Aparecida, Santos/)
  assert.equal(b.iaPedidos.length, 0)
  const r2 = await fala(b, '2')
  assert.equal(r2.acao, 'conversa')
  assert.equal(b.iaPedidos.length, 1)
  assert.match(b.iaPedidos[0].sistema, /Nome: Espaço Spa Dharma/)
  assert.equal(b.convs.at(-1)!.lugar_id, 'b')
  assert.equal('candidatos' in b.convs.at(-1)!.dados, false)
})
await caso('nome achado (um só): "sim" segue; "não" pede o nome de novo', async () => {
  const b = banco({ busca: { 'lash tatiane paes': ['c'] } })
  const r = await fala(b, 'lash tatiane paes')
  assert.equal(r.responder, 'Oi! Aqui é a Mel, da MIMO 💗, o guia de salões. É o *Lash Tatiane Paes* (Centro, São José dos Campos)? Me responde *sim* que eu sigo com o seu pedido.')
  const r2 = await fala(b, 'sim')
  assert.equal(r2.acao, 'conversa')
  assert.equal(b.convs.at(-1)!.lugar_id, 'c')
  const b2 = banco({ busca: { 'lash tatiane paes': ['c'] } })
  await fala(b2, 'lash tatiane paes')
  const r3 = await fala(b2, 'não')
  assert.equal(r3.acao, 'nao_era')
  assert.equal(b2.convs.at(-1)!.lugar_id, null)
})
await caso('lista de salões: "sim" pede o número; um só: "é esse" confirma e frase solta pergunta de novo', async () => {
  const b = banco({ busca: { 'quero marcar no dharma': ['a', 'b'] } })
  await fala(b, 'quero marcar no dharma')
  const r = await fala(b, 'sim')
  assert.match(r.responder!, /Me responde o número do salão \(de 1 a 2\)/)
  assert.equal(b.convs.at(-1)!.lugar_id, null)
  const b2 = banco({ busca: { 'lash tatiane paes': ['c'] } })
  await fala(b2, 'lash tatiane paes')
  const r2 = await fala(b2, 'quero fazer cílios')
  assert.match(r2.responder!, /É o \*Lash Tatiane Paes\*.*Me responde \*sim\* ou \*não\*/)
  const r3 = await fala(b2, 'É esse!')
  assert.equal(r3.acao, 'conversa')
  assert.equal(b2.convs.at(-1)!.lugar_id, 'c')
})
const comOferta = (b: ReturnType<typeof banco>, motivo = 'demora') => b.abrir({ telefone: CLIENTE.replace('+', ''), dados: { nome: 'Ana Clara', servico: 'massagem', opcoes: ofertadas, salao_anterior: 'Studio Dharma', resgate_de: 7, oferta_motivo: motivo } })
await caso('oferta: o número já envia o pedido (sem pedir "sim" de novo)', async () => {
  const b = banco()
  comOferta(b)
  const r = await fala(b, '2')
  assert.equal(r.acao, 'escolheu')
  assert.equal(r.responder, 'Pronto, Ana! 💗 Enviei seu pedido para o Lash Tatiane Paes. Eles vão te chamar aqui no WhatsApp para combinar o horário.')
  assert.equal(b.leads.length, 1)
  assert.equal(b.enviados[0].tel, '5512911110003')
  assert.equal(b.convs.at(-1)!.estado, 'enviado')
})
await caso('oferta: "1 e 3" vai para o 1, um por vez, e a Mel explica', async () => {
  const b = banco()
  comOferta(b)
  const r = await fala(b, '1 e 3')
  assert.match(r.responder!, /Enviei seu pedido para o Espaço Spa Dharma/)
  assert.match(r.responder!, /Passo para um salão por vez: comecei pelo Espaço Spa Dharma/)
  assert.equal(b.leads.length, 1)
})
await caso('oferta: "manda pros 3" pergunta qual primeiro', async () => {
  const b = banco()
  comOferta(b)
  const r = await fala(b, 'manda pros 3')
  assert.match(r.responder!, /um salão por vez/)
  assert.equal(b.leads.length, 0)
})
await caso('oferta: "Desisto, obrigada" encerra; "não, obrigada" na demora é esperar', async () => {
  const b = banco()
  comOferta(b)
  const r = await fala(b, 'Desisto, obrigada')
  assert.equal(r.acao, 'desistiu')
  assert.equal(b.convs.at(-1)!.estado, 'encerrada')
  const b2 = banco()
  comOferta(b2)
  const r2 = await fala(b2, 'Não, obrigada')
  assert.equal(r2.acao, 'vai_esperar')
  assert.match(r2.responder!, /Vou deixar o seu pedido com o Studio Dharma/)
})
await caso('oferta: "já marquei com o 2" encerra em vez de mandar pedido para o 2', async () => {
  const b = banco()
  comOferta(b)
  const r = await fala(b, 'Já marquei com o 2, obrigada')
  assert.equal(r.acao, 'desistiu')
  assert.equal(b.leads.length, 0)
})
await caso('resumo: "sim, obrigada" envia', async () => {
  const b = banco()
  b.abrir({ telefone: CLIENTE.replace('+', ''), lugar_id: 'd', estado: 'confirmando', dados: { nome: 'Ana', servico: 'unha' } })
  const r = await fala(b, 'Sim, obrigada!')
  assert.equal(r.acao, 'enviado')
  assert.equal(b.iaPedidos.length, 0)
})
await caso('emoji sozinho fica sem resposta; "?" vai para a IA', async () => {
  const b = banco()
  b.abrir({ telefone: CLIENTE.replace('+', ''), lugar_id: 'd', estado: 'enviado', dados: { nome: 'Ana', servico: 'unha' } })
  const r = await fala(b, '😉')
  assert.equal(r.responder, null)
  assert.equal(r.acao, 'so_emoji')
  await fala(b, '?')
  assert.equal(b.iaPedidos.length, 1)
})
await caso('voto "não" do salão: quem pediu para parar não recebe aviso nem oferta', async () => {
  const b = banco({ leadSalao: { id: 7, salao_nome: 'Espaço Spa Dharma', status: 'enviado', ja_respondeu: false, voto: null }, saidas: { '5513988887777': 'cliente' } })
  const r = await atenderGuia(b.deps, { telefone: '+5513911110002', texto: '2', enquete: 'enq1' })
  assert.equal(r.acao, 'salao_nao_atende')
  assert.equal(b.enviados.some((x) => x.tel === '5513988887777'), false)
  assert.equal(b.chamadas.some((x) => x.nome === 'guia_whats_oferecer'), false)
})

console.log(`\n${ok} casos ok`)
