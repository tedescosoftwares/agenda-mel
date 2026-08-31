// Adaptadores de canal.
//
// Cada um recebe a mesma coisa (para quem, o quê, qual conta) e devolve
// a mesma coisa (deu certo? qual o id da mensagem lá do outro lado?).
// Trocar de canal é trocar uma linha na tabela whatsapp_channels.

export type Envio = {
  telefone: string // 5513998710002
  corpo: string
  identificador: string | null // instância (evolution) ou phone_number_id (cloud)
}

export type Resultado =
  | { ok: true; providerId: string | null }
  | { ok: false; erro: string; permanente?: boolean }

// ---------------------------------------------------------------
// Evolution API — o caminho de graça, num chip próprio.
// Sobe em Docker, escaneia o QR code, e o número continua no
// aplicativo. Fora dos termos do WhatsApp: use chip dedicado.
// ---------------------------------------------------------------
export async function enviarPelaEvolution(e: Envio): Promise<Resultado> {
  const base = Deno.env.get('EVOLUTION_URL')
  const chave = Deno.env.get('EVOLUTION_API_KEY')
  const instancia = e.identificador ?? Deno.env.get('EVOLUTION_INSTANCIA')

  if (!base || !chave || !instancia) {
    return { ok: false, erro: 'Evolution não configurada', permanente: true }
  }

  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/message/sendText/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify({
        number: e.telefone,
        text: e.corpo,
        // um respiro entre mensagens ajuda a não parecer robô
        delay: 1200,
      }),
    })

    const corpo = await r.text()
    if (!r.ok) {
      // 4xx é problema da mensagem; 5xx é a instância fora do ar
      return { ok: false, erro: `${r.status} ${corpo}`.slice(0, 400), permanente: r.status < 500 }
    }

    let id: string | null = null
    try {
      id = JSON.parse(corpo)?.key?.id ?? null
    } catch {
      id = null
    }
    return { ok: true, providerId: id }
  } catch (err) {
    return { ok: false, erro: String(err).slice(0, 400) }
  }
}

// ---------------------------------------------------------------
// Cloud API oficial da Meta.
//
// Fora de uma janela de 24h aberta só passa template aprovado. Aqui
// mandamos texto livre, que funciona quando a cliente respondeu há
// pouco. Para o lembrete de véspera (que inicia a conversa) troque
// por template — a estrutura fica igual, muda o corpo do JSON.
// ---------------------------------------------------------------
export async function enviarPelaCloud(e: Envio): Promise<Resultado> {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const versao = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v21.0'
  const numeroId = e.identificador ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

  if (!token || !numeroId) {
    return { ok: false, erro: 'Cloud API não configurada', permanente: true }
  }

  try {
    const r = await fetch(`https://graph.facebook.com/${versao}/${numeroId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: e.telefone,
        type: 'text',
        text: { preview_url: false, body: e.corpo },
      }),
    })

    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = dados?.error?.message ?? `HTTP ${r.status}`
      // 131047 = fora da janela de 24h; insistir não resolve
      const codigo = dados?.error?.code
      const permanente = r.status === 400 || codigo === 131047 || codigo === 131026
      return { ok: false, erro: String(msg).slice(0, 400), permanente }
    }

    return { ok: true, providerId: dados?.messages?.[0]?.id ?? null }
  } catch (err) {
    return { ok: false, erro: String(err).slice(0, 400) }
  }
}

export function enviarPor(canal: string, e: Envio): Promise<Resultado> {
  if (canal === 'evolution') return enviarPelaEvolution(e)
  if (canal === 'cloud') return enviarPelaCloud(e)
  return Promise.resolve({
    ok: false,
    erro: `canal desconhecido: ${canal}`,
    permanente: true,
  })
}
