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

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

type Recebida = { telefone: string; texto: string; id: string | null;
                  enquete?: string | null; instancia?: string | null }
type Status = { id: string; status: string; detalhe: string | null }

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
        mensagens.push({ telefone: m.from, texto, id: m.id ?? null })
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

function lerEvolution(corpo: any): { mensagens: Recebida[]; status: Status[] } {
  const mensagens: Recebida[] = []
  const status: Status[] = []
  const evento = corpo?.event ?? ''
  const d = corpo?.data ?? {}

  if (evento === 'messages.upsert') {
    // fromMe: é a própria profissional escrevendo, não a cliente
    if (!d?.key?.fromMe) {
      const jid: string = d?.key?.remoteJid ?? ''
      // grupo não interessa
      if (jid && !jid.includes('@g.us')) {
        const ehVoto = d?.messageType === 'pollUpdateMessage'
        const texto = ehVoto ? votoDaEnquete(d) : textoDaMensagem(d?.message)
        if (texto) {
          mensagens.push({
            telefone: jid.split('@')[0],
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

  return { mensagens, status }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

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

  const { mensagens, status } = daEvolution ? lerEvolution(corpo) : lerCloud(corpo)

  for (const s of status) {
    await db.rpc('atualizar_status_envio', {
      id_provedor: s.id,
      novo_status: s.status,
      detalhe: s.detalhe,
    })
  }

  const respostas: string[] = []
  for (const m of mensagens) {
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

    if (p?.permitido) {
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
      const { data: canalAviso } = await db.rpc('canal_do_telefone', { tel: avisar.telefone })
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

    const responder = (data as any)?.responder
    if (!responder) continue
    respostas.push(`${m.telefone}: ${responder}`)

    // Ela acabou de escrever, então a janela de 24h está aberta: a
    // confirmação sai na hora, sem template e sem custo. E sem passar
    // pela fila — resposta que chega meia hora depois não é resposta.
    const { data: canal } = await db.rpc('canal_do_telefone', { tel: m.telefone })
    const c = Array.isArray(canal) ? canal[0] : canal
    if (!c?.canal || c.canal === 'manual') continue

    await enviarPor(c.canal, {
      telefone: m.telefone,
      corpo: responder,
      identificador: c.identificador ?? null,
    })
  }

  // O WhatsApp reenvia o evento se a gente demorar ou devolver erro:
  // responde 200 sempre que o evento foi processado, mesmo que a ação
  // tenha sido "não entendi".
  return json({ mensagens: mensagens.length, status: status.length, respostas })
})
