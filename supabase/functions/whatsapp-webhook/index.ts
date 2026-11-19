// Recebe do WhatsApp: a resposta da cliente e o status de entrega.
//
// Atende os dois formatos, porque o corpo do evento é diferente em
// cada um:
//
//   • Cloud API (Meta) — faz um GET de verificação uma vez, depois POSTs
//     assinados com X-Hub-Signature-256
//   • Evolution API — POST simples; protegemos com um segredo na URL
//     (?token=...) porque ela não assina nada
//
// A decisão sobre o que fazer com a resposta NÃO mora aqui: mora no
// banco, em receber_resposta_whatsapp(). Aqui é só tradução de formato.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'
import { classificar } from '../_shared/ia.ts'
import { conversar, registroDaConversa } from '../_shared/agente.ts'
import { atenderGuia, iaDe, avisoDemora, cutucadaSalao, resgatarCliente, VOTO_ILEGIVEL, type Deps as DepsGuia, type Pedido } from '../_shared/guia_whats.ts'
import { atenderOnboarding, iaOnbDe, consultarCnpjDe, consultarCepDe, consultarRuaDe, type Deps as DepsOnb } from '../_shared/guia_onboarding.ts'
import { atenderComercial, iaComercialDe, textoCadencia, type Deps as DepsCom } from '../_shared/comercial.ts'

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

type Recebida = { telefone: string; texto: string; id: string | null;
                  enquete?: string | null; instancia?: string | null; nome?: string | null; citado?: string | null }
type Status = { id: string; status: string; detalhe: string | null }
// 3.74: o que saiu do NOSSO número (fromMe): no comercial, diz se alguém da equipe escreveu pelo celular do chip
// 3.95: no número próprio do salão também (o id separa o eco do que a gente mandou da equipe pelo celular)
type Propria = { telefone: string; texto: string; instancia: string | null; id?: string | null }

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 3.98.4 (migração 246): uma conversa por vez por número. Quem escreve em rajada ("Não entendi" / "Remarcou meu
// atendimento") mandava duas respostas que se contradiziam, cada uma sem ver o que a outra fez. Agora: espera um
// instante; se chegou mensagem mais nova desse número, é ela quem responde as duas ('pulou'); se outra resposta está
// saindo, espera ela terminar. Banco sem a 246: segue como antes.
async function naVez<T>(salao: string, telefone: string, msgId: string | null, fazer: () => Promise<T>, rajada = true): Promise<T | 'pulou'> {
  if (rajada) await espera(2500)
  const ate = Date.now() + 45_000
  let pegou = false
  for (;;) {
    const { data, error } = await db.rpc('assistente_pegar_vez', { salao, tel: telefone, msg: msgId })
    if (error) break
    if (data === 'nova') return 'pulou'
    if (data === 'sua') { pegou = true; break }
    if (Date.now() > ate) break
    await espera(1500)
  }
  try {
    return await fazer()
  } finally {
    if (pegou) await db.rpc('assistente_soltar_vez', { salao, tel: telefone, msg: msgId }).then(() => {}, () => {})
  }
}

// Responde a cliente. Por qual canal é O NÚMERO QUE RECEBEU a mensagem (m.instancia); antes isto vinha do histórico de
// envios, e quem escrevia pela primeira vez não recebia resposta nenhuma. Sem canal automático, a resposta espera na
// fila para alguém mandar na mão. Falha de envio vira linha na fila: resposta atrasada é ruim; resposta que nunca
// existiu é pior. 3.95: o que saiu fica anotado (whatsapp_saiu), para o eco no número próprio não parecer a equipe, e a
// espera pela equipe daquela cliente (se houver) cai.
async function responderCliente(o: { salao: string | null; telefone: string; instancia: string | null; corpo: string; doAgente: boolean }): Promise<boolean> {
  const { data: canal } = await db.rpc('canal_para_responder', { tel: o.telefone, instancia: o.instancia, salao: o.salao })
  const c = Array.isArray(canal) ? canal[0] : canal
  if (!c?.canal || c.canal === 'manual') {
    await db.rpc('resposta_nao_saiu', {
      tel: o.telefone, corpo: o.corpo, salao: o.salao,
      motivo: c?.canal === 'manual' ? 'canal manual' : 'nenhum canal para este número',
    })
    return false
  }
  try {
    const env = await enviarPor(c.canal, { telefone: o.telefone, corpo: o.corpo, identificador: c.identificador ?? null })
    if (env.ok) {
      try { await db.rpc('whatsapp_saiu', { id_provedor_: env.providerId ?? null, tel: o.telefone, texto_: o.corpo, salao: o.salao }) } catch { /* banco sem a 235 */ }
      if (o.doAgente && o.salao) {
        await db.rpc('bot_registrar_resposta', { salao: o.salao, tel: o.telefone, corpo: o.corpo, id_provedor: env.providerId ?? null, canal_: c.canal }).then(() => {}, () => {})
      }
      return true
    }
    console.error('resposta não saiu; vai para a fila:', env.erro)
    await db.rpc('resposta_nao_saiu', { tel: o.telefone, corpo: o.corpo, salao: o.salao, motivo: env.erro ?? 'envio falhou' })
  } catch (e) {
    console.error('resposta não saiu; vai para a fila', e)
    await db.rpc('resposta_nao_saiu', { tel: o.telefone, corpo: o.corpo, salao: o.salao, motivo: String(e).slice(0, 200) })
  }
  return false
}

// A Meta assina cada POST. Sem conferir, qualquer um posta na sua URL
// fingindo ser o WhatsApp.
async function assinaturaConfere(cru: string, cabecalho: string | null) {
  const segredo = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!segredo) return true // Cloud API não configurada: não é esse o caminho
  if (!cabecalho?.startsWith('sha256=')) return false

  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinado = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(cru))
  const esperado = Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const recebido = cabecalho.slice(7)
  if (recebido.length !== esperado.length) return false

  // comparação de tempo constante
  let diferenca = 0
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i)
  }
  return diferenca === 0
}

function lerCloud(corpo: any): { mensagens: Recebida[]; status: Status[] } {
  const mensagens: Recebida[] = []
  const status: Status[] = []

  for (const entrada of corpo?.entry ?? []) {
    for (const mudanca of entrada?.changes ?? []) {
      const v = mudanca?.value ?? {}

      for (const m of v.messages ?? []) {
        let texto = ''
        if (m.type === 'text') {
          texto = m.text?.body ?? ''
        } else if (m.type === 'interactive') {
          // o toque no botão devolve o id que mandamos ("1"/"2")
          texto =
            m.interactive?.button_reply?.id ??
            m.interactive?.list_reply?.id ??
            ''
        } else if (m.type === 'button') {
          texto = m.button?.payload ?? m.button?.text ?? ''
        }
        if (!texto) continue
        // mesma razão do lado da Evolution: o "from" da Cloud vem com o
        // país mas sem o sinal, e é o sinal que impede um número de 11
        // dígitos de ser confundido com celular brasileiro sem DDI
        mensagens.push({ telefone: '+' + m.from, texto, id: m.id ?? null })
      }

      for (const s of v.statuses ?? []) {
        const mapa: Record<string, string> = {
          sent: 'enviado',
          delivered: 'entregue',
          read: 'lido',
          failed: 'falhou',
        }
        const nosso = mapa[s.status]
        if (!nosso) continue
        status.push({
          id: s.id,
          status: nosso,
          detalhe: s.errors?.[0]?.title ?? null,
        })
      }
    }
  }

  return { mensagens, status }
}

// Tocar no botão não gera texto: gera uma resposta estruturada, e o
// Baileys entrega em três formatos diferentes conforme a versão do
// WhatsApp de quem tocou. Todos carregam o id que definimos ("1"/"2"),
// que é exatamente o que a cliente teria digitado.
// 3.49.7: quando o salão responde CITANDO a nossa mensagem, o texto citado vem no contextInfo. A gente passa esse
// texto adiante (ele tem o link mimo.com.vc/r/<token>) para amarrar a resposta ao pedido certo.
function citadoDaMensagem(m: any): string {
  const q = m?.extendedTextMessage?.contextInfo?.quotedMessage
    ?? m?.imageMessage?.contextInfo?.quotedMessage
    ?? m?.contextInfo?.quotedMessage
  if (!q) return ''
  return String(q.conversation ?? q.extendedTextMessage?.text ?? q.imageMessage?.caption ?? '').slice(0, 1500)
}

function textoDaMensagem(m: any): string {
  if (!m) return ''

  const direto = m.conversation ?? m.extendedTextMessage?.text
  if (direto) return String(direto)

  // botão clássico
  const classico = m.buttonsResponseMessage?.selectedButtonId
  if (classico) return String(classico)

  // botão de template
  const template = m.templateButtonReplyMessage?.selectedId
  if (template) return String(template)

  // lista
  const lista = m.listResponseMessage?.singleSelectReply?.selectedRowId
  if (lista) return String(lista)

  // botão novo (nativeFlow): o id vem dentro de um JSON em string
  const params =
    m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ??
    m.viewOnceMessage?.message?.interactiveResponseMessage
      ?.nativeFlowResponseMessage?.paramsJson
  if (params) {
    try {
      const p = JSON.parse(params)
      const id = p?.id ?? p?.selectedId ?? p?.selectedRowId
      if (id) return String(id)
    } catch {
      // json torto: ignora e trata como sem texto
    }
  }

  return ''
}

// O voto na enquete chega como pollUpdateMessage. A Evolution já
// descriptografou e pôs os NOMES das opções escolhidas em
// vote.selectedOptions, e a lista completa em pollUpdates (na ordem em
// que a enquete foi criada). Traduzimos para "1"/"2" pela POSIÇÃO da
// opção, para o resto do sistema não depender do texto do botão.
function votoDaEnquete(d: any): string {
  const escolhidas: string[] = d?.message?.pollUpdateMessage?.vote?.selectedOptions ?? []
  if (!escolhidas.length) return ''

  const opcoes: Array<{ name?: string }> = d?.pollUpdates ?? []
  if (opcoes.length) {
    const idx = opcoes.findIndex((o) => o?.name && escolhidas.includes(o.name))
    if (idx >= 0) return String(idx + 1)
  }
  // sem a lista ordenada, manda o texto da opção — o banco entende
  // "confirmar" e "preciso remarcar" também
  return String(escolhidas[0])
}

function lerEvolution(corpo: any): { mensagens: Recebida[]; status: Status[]; proprias: Propria[] } {
  const mensagens: Recebida[] = []
  const status: Status[] = []
  const proprias: Propria[] = []
  const evento = corpo?.event ?? ''
  const d = corpo?.data ?? {}

  if (evento === 'messages.upsert') {
    // fromMe: é a própria profissional escrevendo, não a cliente (3.74: no comercial, isso interessa — a equipe pelo celular)
    if (d?.key?.fromMe) {
      const jid: string = d?.key?.remoteJid ?? ''
      const texto = d?.messageType === 'pollUpdateMessage' ? '' : textoDaMensagem(d?.message)
      if (jid && !jid.includes('@g.us') && texto) proprias.push({ telefone: '+' + jid.split('@')[0], texto, instancia: corpo?.instance ?? null, id: d?.key?.id ?? null })
    }
    if (!d?.key?.fromMe) {
      const jid: string = d?.key?.remoteJid ?? ''
      // grupo não interessa
      if (jid && !jid.includes('@g.us')) {
        const ehVoto = d?.messageType === 'pollUpdateMessage'
        // 3.77: o voto que a Evolution não conseguiu decifrar (ela não tinha a enquete guardada) vira VOTO_ILEGIVEL, para a
        // Mel pedir por texto; fora do número da Mel, ele é descartado como antes
        const texto = ehVoto ? (votoDaEnquete(d) || VOTO_ILEGIVEL) : textoDaMensagem(d?.message)
        if (texto) {
          mensagens.push({
            // com o "+" na frente: o JID sempre traz o país, e sem o
            // sinal um número de 11 dígitos dos EUA seria lido como
            // celular brasileiro sem DDI
            telefone: '+' + jid.split('@')[0],
            texto,
            id: d?.key?.id ?? null,
            // qual número NOSSO recebeu: é isso que diz de que salão é a
            // conversa quando quem escreve nunca falou com a gente antes
            instancia: corpo?.instance ?? null,
            // a chave da enquete original: é ela que amarra os votos
            // seguintes ao primeiro, para "trocar o voto" não agir
            enquete: ehVoto
              ? (d?.message?.pollUpdateMessage?.pollCreationMessageKey?.id ?? null)
              : null,
            // o nome do perfil de quem escreveu (3.48: a Mel do guia confirma antes de usar)
            nome: typeof d?.pushName === 'string' ? d.pushName.slice(0, 60) : null,
            // a mensagem citada (3.49.7): amarra a resposta do salão ao pedido certo
            citado: ehVoto ? null : citadoDaMensagem(d?.message),
          })
        }
      }
    }
  }

  if (evento === 'messages.update' || evento === 'message.status') {
    const mapa: Record<string, string> = {
      SERVER_ACK: 'enviado',
      DELIVERY_ACK: 'entregue',
      READ: 'lido',
      PLAYED: 'lido',
      ERROR: 'falhou',
    }
    const nosso = mapa[d?.status ?? '']
    if (nosso && d?.keyId) {
      status.push({ id: d.keyId, status: nosso, detalhe: null })
    }
  }

  return { mensagens, status, proprias }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // 3.52: o relógio do ocioso da Mel. Um cron na VPS chama ?tarefa=ociosas&token=<EVOLUTION_WEBHOOK_TOKEN>: a função
  // varre as conversas paradas e manda, pela Evolution, a pergunta "posso encerrar?" (perguntar) ou o encerramento
  // (encerrar) e fecha. Não processa evento de WhatsApp nenhum; a cada mensagem da cliente a marca (cutucada_em) zera.
  if (url.searchParams.get('tarefa') === 'ociosas') {
    const esperado = Deno.env.get('EVOLUTION_WEBHOOK_TOKEN')
    if (!esperado || url.searchParams.get('token') !== esperado) return new Response('não autorizado', { status: 403 })
    try {
      // 3.77: o relógio passou (a aba WhatsApp mostra "há X min"); num banco sem a 222, nada
      try { await db.rpc('guia_whats_relogio_bateu') } catch { /* melhor-esforço */ }
      const { data, error } = await db.rpc('guia_whats_ociosas')
      if (error) return json({ erro: error.message }, 500)
      const o = (data ?? {}) as { ativo?: boolean; instancia?: string; texto_perguntar?: string; texto_encerrar?: string; perguntar?: Array<{ id: number; telefone: string }>; encerrar?: Array<{ id: number; telefone: string }> }
      let perguntou = 0, encerrou = 0
      if (o.ativo) {
        const instancia = o.instancia ?? ''
        // encerra primeiro (quem já foi perguntado e segue parado), depois pergunta (quem acabou de parar)
        for (const c of o.encerrar ?? []) {
          const env = await enviarPor('evolution', { telefone: c.telefone, corpo: o.texto_encerrar ?? '', identificador: instancia })
          if (env.ok) { await db.rpc('guia_whats_ociosa_feita', { id_: c.id, tipo_: 'encerrar', texto_: o.texto_encerrar }); encerrou++ }
          else console.error('ocioso encerrar: não saiu', env.erro)
        }
        for (const c of o.perguntar ?? []) {
          const env = await enviarPor('evolution', { telefone: c.telefone, corpo: o.texto_perguntar ?? '', identificador: instancia })
          if (env.ok) { await db.rpc('guia_whats_ociosa_feita', { id_: c.id, tipo_: 'perguntar', texto_: o.texto_perguntar }); perguntou++ }
          else console.error('ocioso perguntar: não saiu', env.erro)
        }
      }
      // 3.57: o mesmo relógio varre os PEDIDOS parados (migração 205): enviado há X minutos sem o salão abrir o link,
      // votar ou responder → avisa a equipe (uma vez) e/ou cutuca o salão (uma vez). Num banco sem a 205, só o ocioso.
      let avisouDemora = 0, cutucou = 0, resgatou = 0, pedidosAtivo = false
      try {
        const { data: pd, error: ep } = await db.rpc('guia_whats_pendentes')
        if (ep) throw new Error(ep.message)
        const pp = (pd ?? {}) as { ativo?: boolean; instancia?: string; numero_avisos?: string | null; texto_demora?: string; texto_cutucar?: string; texto_resgate?: string | null; resgate_opcoes?: number | null; demora?: Array<Pedido & { minutos?: number }>; cutucar?: Array<Pedido & { minutos?: number }>; resgate?: Array<Pedido & { status?: string }> }
        pedidosAtivo = !!pp.ativo
        if (pp.ativo) {
          const instancia = pp.instancia ?? ''
          for (const x of pp.demora ?? []) {
            if (!pp.numero_avisos) break
            const env = await enviarPor('evolution', { telefone: pp.numero_avisos, corpo: avisoDemora(pp.texto_demora, x), identificador: instancia })
            if (env.ok) { await db.rpc('guia_whats_pendente_feita', { id_: x.id, tipo_: 'demora' }); avisouDemora++ }
            else console.error('aviso de demora: não saiu', env.erro)
          }
          for (const x of pp.cutucar ?? []) {
            if (!x.salao_tel) continue
            const env = await enviarPor('evolution', { telefone: x.salao_tel, corpo: cutucadaSalao(pp.texto_cutucar, x), identificador: instancia })
            if (env.ok) { await db.rpc('guia_whats_pendente_feita', { id_: x.id, tipo_: 'cutucar' }); cutucou++ }
            else console.error('cutucar o salão: não saiu', env.erro)
          }
          // 3.77: o resgate (migração 222): a cliente cujo pedido ficou sem sinal recebe os salões sugeridos
          const depsResgate = {
            rpc: (nome: string, args: Record<string, unknown>) => db.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
            enviar: (inst: string, telefone: string, texto: string) => enviarPor('evolution', { telefone, corpo: texto, identificador: inst }),
          }
          for (const x of pp.resgate ?? []) {
            try {
              const r = await resgatarCliente(depsResgate, { instancia, modelo: pp.texto_resgate, n: pp.resgate_opcoes }, x)
              if (r.ok) resgatou++
              else console.error('resgate: não saiu', r.erro)
            } catch (e) { console.error('resgate: não deu', e) }
          }
        }
      } catch (e) {
        console.error('pedidos parados: não deu para varrer (a migração 205 está aplicada?)', e)
      }
      // 3.74: a cadência da assistente comercial (migração 218): quem parou de responder recebe a cutucada da etapa;
      // depois da terceira, vira "perdido". Num banco sem a 218, nada.
      let cadencia = 0, comercialAtivo = false
      try {
        const { data: cd, error: ecd } = await db.rpc('comercial_cadencia')
        if (ecd) throw new Error(ecd.message)
        const cc = (cd ?? {}) as { ativo?: boolean; instancia?: string; textos?: string[]; enviar?: Array<{ id: number; telefone: string; etapa: number; nome?: string | null }> }
        comercialAtivo = !!cc.ativo
        if (cc.ativo) {
          for (const x of cc.enviar ?? []) {
            const texto = textoCadencia(cc.textos ?? [], x.etapa, x.nome)
            if (!texto) continue
            const env = await enviarPor('evolution', { telefone: x.telefone, corpo: texto, identificador: cc.instancia ?? '' })
            if (env.ok) { await db.rpc('comercial_cadencia_feita', { id_: x.id, etapa_: x.etapa, texto_: texto }); cadencia++ }
            else console.error('cadência comercial: não saiu', env.erro)
          }
        }
      } catch (e) {
        console.error('cadência comercial: não deu para varrer (a migração 218 está aplicada?)', e)
      }
      // 3.95: a espera pela equipe (número próprio, "se ninguém responder em X min", migração 235): venceu sem a equipe
      // responder pelo celular, a assistente responde agora. Num banco sem a 235, nada.
      let esperas = 0
      try {
        const { data: ev, error: eev } = await db.rpc('assistente_esperas_vencidas', { quantas: 20 })
        if (eev) throw new Error(eev.message)
        for (const e of (ev ?? []) as Array<{ salon_id: string; telefone: string; instancia: string | null; texto: string }>) {
          await naVez(e.salon_id, e.telefone, null, async () => {
            const ag = await conversar(db, e.salon_id, e.telefone, e.texto, { instancia: e.instancia, semEspera: true })
            if (ag.provedor || ag.erro) await db.rpc('registrar_chamada_ia', registroDaConversa(e.salon_id, e.telefone, ag)).then(() => {}, () => {})
            if (ag.erro) console.error('assistente (espera):', ag.erro)
            if (ag.resposta && await responderCliente({ salao: e.salon_id, telefone: e.telefone, instancia: e.instancia, corpo: ag.resposta, doAgente: true })) {
              esperas++
              // 3.98: o que vai depois da resposta (o link de criar a senha de quem acabou de se cadastrar)
              for (const d of ag.depois ?? []) await responderCliente({ salao: e.salon_id, telefone: e.telefone, instancia: e.instancia, corpo: d, doAgente: true })
            }
          }, false)
        }
      } catch (e) {
        console.error('esperas da assistente: não deu para varrer (a migração 235 está aplicada?)', e)
      }
      return json({ ok: true, ativo: !!o.ativo, perguntou, encerrou, pedidos: pedidosAtivo, avisou_demora: avisouDemora, cutucou, resgatou, comercial: comercialAtivo, cadencia, esperas })
    } catch (e) {
      return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 500)
    }
  }

  // 1. A Meta verifica a URL uma vez, com GET
  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const desafio = url.searchParams.get('hub.challenge')
    if (modo === 'subscribe' && token === Deno.env.get('WHATSAPP_VERIFY_TOKEN')) {
      return new Response(desafio ?? '', { status: 200 })
    }
    return new Response('não autorizado', { status: 403 })
  }

  if (req.method !== 'POST') {
    return new Response('método não suportado', { status: 405 })
  }

  const cru = await req.text()
  let corpo: any
  try {
    corpo = JSON.parse(cru)
  } catch {
    return json({ erro: 'corpo inválido' }, 400)
  }

  const daEvolution = typeof corpo?.event === 'string'

  if (daEvolution) {
    // Evolution não assina: o segredo vai na URL do webhook
    const esperado = Deno.env.get('EVOLUTION_WEBHOOK_TOKEN')
    if (!esperado || url.searchParams.get('token') !== esperado) {
      return new Response('não autorizado', { status: 403 })
    }
  } else {
    if (!(await assinaturaConfere(cru, req.headers.get('x-hub-signature-256')))) {
      return new Response('assinatura inválida', { status: 403 })
    }
  }

  const lido = daEvolution ? lerEvolution(corpo) : { ...lerCloud(corpo), proprias: [] as Propria[] }
  const { mensagens, status, proprias } = lido

  for (const s of status) {
    await db.rpc('atualizar_status_envio', {
      id_provedor: s.id,
      novo_status: s.status,
      detalhe: s.detalhe,
    })
  }

  // 4.4 (migração 254): o disparo. Na Mel do guia e nos chips de disparo: o que o WhatsApp avisa (entregue, lida) e
  // quem respondeu a um disparo (só marca: na Mel a conversa segue para ela, como sempre). Um chip de disparo não tem
  // atendente: o evento dele para aqui e não passa para a Mel nem para a assistente dos salões. Para os outros números,
  // o banco responde vazio na hora. Sem a 254, o erro é ignorado e tudo segue como antes.
  if (daEvolution && corpo?.instance && (status.length || mensagens.length || proprias.length)) {
    const { data: dd, error: ed } = await db.rpc('disparo_evento', {
      instancia_: corpo.instance,
      status_: status.map((s) => ({ id: s.id, status: s.status })),
      recebidas_: mensagens.map((m) => ({ telefone: m.telefone, nome: m.nome ?? null })),
    })
    if (!ed && (dd as { extra?: boolean } | null)?.extra) return json({ ok: true, disparo: true })
  }

  const respostas: string[] = []
  const { data: config } = await db.rpc('config_publica')

  // 3.48: o número do guia (a Mel, migração 195) é outra instância da mesma Evolution. O que chega por ela não é de
  // salão nenhum da MIMO: vai para o bot do guia e volta pela mesma instância, sem passar pela cascata abaixo.
  let guia: { instancia: string; ligado: boolean } | null = null
  if (daEvolution && mensagens.length) {
    const { data: g } = await db.from('guia_whats_config').select('instancia, ligado').eq('id', 1).maybeSingle()
    guia = (g as { instancia: string; ligado: boolean } | null) ?? null
  }
  // 3.74: o WhatsApp comercial (migração 218) é outra instância; a assistente de vendas atende. Num banco sem a 218, nada.
  let comercial: { instancia: string; ligado: boolean } | null = null
  if (daEvolution && (mensagens.length || proprias.length)) {
    try {
      const { data: c } = await db.from('comercial_config').select('instancia, ligado').eq('id', 1).maybeSingle()
      comercial = (c as { instancia: string; ligado: boolean } | null) ?? null
    } catch { comercial = null }
  }
  const depsCom = (): DepsCom => ({
    rpc: (nome, args) => db.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaComercialDe(Deno.env, fetch as unknown as Parameters<typeof iaComercialDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
  })
  // o que saiu do número comercial: eco do que a assistente/painel mandou, ou alguém da equipe pelo celular (a assistente cala)
  for (const pr of proprias) {
    if (!pr.instancia) continue
    if (comercial && pr.instancia === comercial.instancia) {
      try {
        const { data: f } = await db.rpc('comercial_fromme', { tel_: pr.telefone, texto_: pr.texto })
        if ((f as { intervencao?: boolean } | null)?.intervencao) respostas.push(`comercial[intervencao]`)
      } catch (e) { console.error('comercial fromMe:', e) }
      continue
    }
    // 3.95: no número próprio do salão, a equipe respondendo pelo celular cala a assistente com essa cliente por 2 h.
    // O eco do que a gente mesma mandou pode chegar antes de a saída estar anotada: confere, espera 3 s e só então registra.
    try {
      const args = { instancia_: pr.instancia, tel: pr.telefone, texto_: pr.texto, id_provedor_: pr.id ?? null }
      const { data: f1 } = await db.rpc('assistente_fromme', { ...args, registrar: false })
      const r1 = (f1 ?? {}) as { proprio?: boolean; eco?: boolean }
      if (r1.proprio && !r1.eco) {
        await espera(3000)
        const { data: f2 } = await db.rpc('assistente_fromme', { ...args, registrar: true })
        if ((f2 as { intervencao?: boolean } | null)?.intervencao) respostas.push('assistente[a equipe respondeu]')
      }
    } catch (e) { console.error('assistente fromMe:', e) }
  }
  const depsGuia = (): DepsGuia => ({
    rpc: (nome, args) => db.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaDe(Deno.env, fetch as unknown as Parameters<typeof iaDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
    // 3.57: a enquete "vai atender?" (sendPoll): as opções viram "1"/"2" no voto, pela posição
    enviarEnquete: (instancia, telefone, pergunta, opcoes) => enviarPor('evolution', { telefone, corpo: pergunta, estilo: 'enquete', identificador: instancia, botoes: opcoes.map((o, i) => ({ type: 'reply' as const, displayText: o, id: String(i + 1) })) }),
  })
  // 3.55: o agente de onboarding (migração 203) — mesmo número, outro agente; a consulta do CNPJ é a BrasilAPI
  const depsOnb = (): DepsOnb => ({
    rpc: (nome, args) => db.rpc(nome, args) as unknown as Promise<{ data: unknown; error: { message?: string } | null }>,
    ia: iaOnbDe(Deno.env, fetch as unknown as Parameters<typeof iaOnbDe>[1]),
    enviar: (instancia, telefone, texto) => enviarPor('evolution', { telefone, corpo: texto, identificador: instancia }),
    consultarCnpj: consultarCnpjDe(fetch as unknown as Parameters<typeof consultarCnpjDe>[0]),
    consultarCep: consultarCepDe(fetch as unknown as Parameters<typeof consultarCepDe>[0]),
    // 3.61: a rua pelo nome (ViaCEP), para quem não sabe o CEP
    consultarRua: consultarRuaDe(fetch as unknown as Parameters<typeof consultarRuaDe>[0]),
  })

  for (const m of mensagens) {
    if (m.texto === VOTO_ILEGIVEL && !(guia && m.instancia && m.instancia === guia.instancia)) continue
    // 3.74: a instância comercial: a assistente de vendas, em bolhas com a pausa da Plataforma; nada passa para a Mel
    if (comercial && m.instancia && m.instancia === comercial.instancia) {
      try {
        const r = await atenderComercial(depsCom(), { telefone: m.telefone, texto: m.texto, nomePerfil: m.nome ?? null })
        respostas.push(`comercial[${r.acao}]`)
        if (r.erro) console.error('comercial:', r.erro)
        const bolhas = r.bolhas?.length ? r.bolhas : r.responder ? [r.responder] : []
        const atraso = Math.round(Math.max(0, Math.min(30, Number(r.pausa ?? 2) || 0)) * 1000)
        for (const b of bolhas) {
          const env = await enviarPor('evolution', { telefone: m.telefone, corpo: b, identificador: m.instancia, atraso })
          if (!env.ok) { console.error('comercial: a resposta não saiu:', env.erro); break }
        }
      } catch (e) {
        console.error('comercial: não deu para atender', e)
      }
      continue
    }
    if (guia && m.instancia && m.instancia === guia.instancia) {
      // 3.57: um voto na enquete não é conversa de onboarding: vai direto à Mel, que amarra ao pedido do salão
      // 3.55: o agente de onboarding olha primeiro. Se a mensagem é dele (conversa de onboarding aberta deste número, ou um
      // gatilho), ele atende e a Mel-cliente nem vê; se não é ("passa"), segue para a Mel como sempre. Qualquer erro aqui
      // (a migração 203 ainda não aplicada, por exemplo) também passa: o agente novo nunca derruba o atendimento da cliente.
      // 3.76: com o comercial ligado, o gatilho do onboarding volta 'comercial' e a Mel responde com o link da assistente
      let sobreAgenda = false
      if (!m.enquete) try {
        const o = await atenderOnboarding(depsOnb(), { telefone: m.telefone, texto: m.texto, nomePerfil: m.nome ?? null })
        if (o.acao === 'comercial') { sobreAgenda = true; respostas.push('onboarding[comercial]') }
        else if (o.acao !== 'passa') {
          respostas.push(`onboarding[${o.acao}]`)
          if (o.erro) console.error('onboarding:', o.erro)
          // 3.56: em bolhas (um parágrafo por mensagem), cada uma com a pausa da Plataforma como "digitando…". 3.61: uma
          // bolha pode pedir uma espera maior (o "um minutinho, criando…" antes do link): o que passa da pausa é silêncio.
          const bolhas = o.bolhas?.length ? o.bolhas : o.responder ? [o.responder] : []
          const pausaSeg = Math.max(0, Math.min(30, Number(o.pausa ?? 2) || 0))
          const atraso = Math.round(pausaSeg * 1000)
          for (let i = 0; i < bolhas.length; i++) {
            const espera = Math.max(0, Math.min(90, Number(o.pausas?.[i] ?? pausaSeg) || 0))
            if (espera > pausaSeg) await new Promise((r) => setTimeout(r, Math.round((espera - pausaSeg) * 1000)))
            const env = await enviarPor('evolution', { telefone: m.telefone, corpo: bolhas[i], identificador: m.instancia, atraso })
            if (!env.ok) { console.error('onboarding: a resposta não saiu:', env.erro); break }
          }
          continue
        }
      } catch (e) {
        console.error('onboarding: não deu para atender (a Mel segue)', e)
      }
      try {
        const r = await atenderGuia(depsGuia(), { telefone: m.telefone, texto: m.texto, nomePerfil: m.nome ?? null, citado: m.citado ?? null, enquete: m.enquete ?? null }, { sobreAgenda })
        respostas.push(`guia[${r.acao}]`)
        if (r.erro) console.error('guia:', r.erro)
        if (r.responder) {
          const env = await enviarPor('evolution', { telefone: m.telefone, corpo: r.responder, identificador: m.instancia })
          if (!env.ok) console.error('guia: a resposta não saiu:', env.erro)
          // 4.2 (migração 252): o convite do Instagram, numa mensagem só dele, uns segundos depois (só se a resposta saiu)
          if (env.ok && r.depois) {
            await new Promise((ok) => setTimeout(ok, 4000))
            const env2 = await enviarPor('evolution', { telefone: m.telefone, corpo: r.depois, identificador: m.instancia })
            if (!env2.ok) console.error('guia: o convite do Instagram não saiu:', env2.erro)
          }
        }
      } catch (e) {
        console.error('guia: não deu para atender', e)
      }
      continue
    }
    // A CASCATA -------------------------------------------------------
    // O porteiro (migração 030) diz se vale gastar uma chamada de modelo.
    // Ele resolve sozinho os casos baratos: "1", "sim", "cancelar" voltam
    // com motivo 'resposta_simples', e aí nem se toca no modelo. Só o que
    // ele libera — texto solto, de salão com IA ligada, dentro dos tetos —
    // chega ao Groq.
    let intencao: string | null = null
    let salao: string | null = null

    const { data: porteiro } = await db.rpc('ia_permitida', {
      tel: m.telefone,
      texto: m.texto,
      instancia: m.instancia ?? null,
    })
    const p = porteiro as any
    salao = p?.salon_id ?? null

    // com o agente ligado (069) o classificador antigo fica de lado: é o
    // agente que lê texto solto, uma chamada só
    const agenteLigado = (config?.ia_agente ?? 'ligado') === 'ligado'
    if (p?.permitido && !agenteLigado) {
      const leitura = await classificar(m.texto)
      // registrar SEMPRE, inclusive o erro: é o que conta contra o teto,
      // é o que mostra na tela do admin, e é o que responde depois
      // "quanto isso está me custando"
      await db.rpc('registrar_chamada_ia', {
        salao,
        tel: m.telefone,
        modelo_usado: leitura.modelo,
        duracao_ms: leitura.ms,
        deu_erro: leitura.erro ?? null,
      })
      if (!leitura.erro) intencao = leitura.intencao
    }

    // receber_mensagem é a porta única: ela decide entre o bot (conversa
    // em andamento, ou intenção de marcar com o bot ligado) e o caminho
    // de sempre. A ordem importa — no meio de um menu, "2" é a segunda
    // opção, nunca "cancele meu horário".
    const { data } = await db.rpc('receber_mensagem', {
      tel: m.telefone,
      texto: m.texto,
      id_provedor: m.id,
      id_enquete: m.enquete ?? null,
      intencao_do_modelo: intencao,
      salao,
    })

    // Aviso com prazo correndo não pode esperar a fila. Quando o bot abre
    // um pedido de horário, a profissional tem um cronômetro — e a fila
    // só é escoada quando alguém a empurra. Então esse aviso sai aqui,
    // na mesma requisição, e a linha da fila é marcada como enviada.
    // Se falhar, ela continua 'na_fila' e o escoamento normal pega depois.
    const avisar = (data as any)?.avisar
    if (avisar?.telefone && avisar?.corpo) {
      // pelo canal do salão, não pelo histórico de quem vai receber: a
      // profissional pode nunca ter recebido nada por aqui
      const { data: canalAviso } = await db.rpc('canal_para_responder', {
        tel: avisar.telefone,
        instancia: m.instancia ?? null,
        salao,
      })
      const ca = Array.isArray(canalAviso) ? canalAviso[0] : canalAviso
      if (ca?.canal && ca.canal !== 'manual') {
        try {
          const env = await enviarPor(ca.canal, {
            telefone: avisar.telefone,
            corpo: avisar.corpo,
            identificador: ca.identificador ?? null,
          })
          // marcar como enviada SÓ quando saiu mesmo. Marcar no erro
          // apagaria a mensagem da fila sem ela ter chegado a ninguém —
          // e o pedido morreria em silêncio, que é o pior desfecho.
          if (env.ok) {
            await db.rpc('avisei_na_hora', {
              fila_id: avisar.fila_id,
              id_provedor: env.providerId ?? null,
            })
          } else {
            console.error('aviso não saiu; fica na fila:', env.erro)
          }
        } catch (e) {
          console.error('não consegui avisar na hora; fica para a fila', e)
        }
      }
    }

    const responder: string | null = (data as any)?.responder ?? null
    const acao = String((data as any)?.acao ?? '')
    // 3.98.4: com a assistente ligada, a resposta pronta antiga ("Recebi! Pra marcar ou mudar um horário, é só abrir o
    // app") não tira a vez dela: o "sim" ao resumo que ela mesma fez é resposta para ela. A pronta só vale se a
    // assistente não responder (desligada, em pausa, no teto do dia).
    if (salao && ['nada', 'sem_cadastro', 'fora_de_contexto', 'sem_horario'].includes(acao)) {
      const feito = await naVez(salao, m.telefone, m.id ?? null, async () => {
        const ag = await conversar(db, salao!, m.telefone, m.texto, { instancia: m.instancia ?? null })
        // 3.99 (248): número que ela não responde (a equipe, a lista do salão): nada sai, nem a resposta pronta
        if (ag.motivo === 'nao_responder') { respostas.push('assistente[não responde este número]'); return 'calada' as const }
        // 3.95: no número próprio, no horário do salão, a dona pode querer que a equipe responda primeiro: a mensagem
        // espera; o relógio responde se ninguém responder pelo celular até lá
        if (ag.motivo === 'esperar') {
          await db.rpc('assistente_esperar', { salao, tel: m.telefone, instancia_: m.instancia ?? null, texto_: m.texto, ate: ag.responderEm ?? null }).then(() => {}, (e) => console.error('assistente: não deu para esperar', e))
          respostas.push('assistente[esperando a equipe]')
          return 'esperou' as const
        }
        // só conta (teto e custo) o que chegou a falar com um modelo
        if (ag.provedor || ag.erro) await db.rpc('registrar_chamada_ia', registroDaConversa(salao!, m.telefone, ag)).then(() => {}, () => {})
        if (ag.erro) console.error('agente:', ag.erro)
        if (ag.falhas.length && ag.resposta) console.error('agente: a reserva respondeu depois de', ag.falhas.join(' | '))
        if (!ag.resposta) return 'sem_resposta' as const
        respostas.push(`agente[${ag.provedor}:${ag.ferramentas.join(',')}]`)
        respostas.push(`${m.telefone}: ${ag.resposta}`)
        // dentro da vez: a próxima mensagem desse número já encontra esta resposta no histórico
        const saiu = await responderCliente({ salao, telefone: m.telefone, instancia: m.instancia ?? null, corpo: ag.resposta, doAgente: true })
        if (saiu) for (const d of ag.depois ?? []) await responderCliente({ salao, telefone: m.telefone, instancia: m.instancia ?? null, corpo: d, doAgente: true })
        return 'respondeu' as const
      })
      if (feito === 'pulou') { respostas.push('assistente[juntou com a mensagem seguinte]'); continue }
      if (feito === 'esperou' || feito === 'respondeu' || feito === 'calada') continue
    }
    if (!responder) continue
    respostas.push(`${m.telefone}: ${responder}`)

    // Ela acabou de escrever, então a janela de 24h está aberta: a
    // confirmação sai na hora, sem template e sem custo. E sem passar
    // pela fila — resposta que chega meia hora depois não é resposta.
    await responderCliente({ salao, telefone: m.telefone, instancia: m.instancia ?? null, corpo: responder, doAgente: false })
  }

  // O WhatsApp reenvia o evento se a gente demorar ou devolver erro:
  // responde 200 sempre que o evento foi processado, mesmo que a ação
  // tenha sido "não entendi".
  return json({ mensagens: mensagens.length, status: status.length, respostas })
})
