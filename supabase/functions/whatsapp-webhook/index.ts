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

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

type Recebida = { telefone: string; texto: string; id: string | null }
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
        if (m.type !== 'text') continue
        mensagens.push({
          telefone: m.from,
          texto: m.text?.body ?? '',
          id: m.id ?? null,
        })
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
        const texto =
          d?.message?.conversation ??
          d?.message?.extendedTextMessage?.text ??
          ''
        if (texto) {
          mensagens.push({
            telefone: jid.split('@')[0],
            texto,
            id: d?.key?.id ?? null,
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
    const { data } = await db.rpc('receber_resposta_whatsapp', {
      tel: m.telefone,
      texto: m.texto,
      id_provedor: m.id,
    })

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
