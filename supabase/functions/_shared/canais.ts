// Adaptadores de canal.
//
// Cada um recebe a mesma coisa (para quem, o quê, qual conta) e devolve
// a mesma coisa (deu certo? qual o id da mensagem lá do outro lado?).
// Trocar de canal é trocar uma linha na tabela whatsapp_channels.

export type Botao = { type: 'reply'; displayText: string; id: string }

export type Envio = {
  telefone: string // 5513998710002
  titulo?: string | null
  corpo: string
  botoes?: Botao[] | null
  identificador: string | null // instância (evolution) ou phone_number_id (cloud)
}

// título e corpo viram um bloco só quando o canal não tem botão
export function textoInteiro(e: Envio): string {
  const t = (e.titulo ?? '').trim()
  return t ? `${t}\n\n${e.corpo}` : e.corpo
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

  const raiz = base.replace(/\/$/, '')

  async function bater(rota: string, corpo: unknown): Promise<Response> {
    return await fetch(`${raiz}/message/${rota}/${instancia}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave! },
      body: JSON.stringify(corpo),
    })
  }

  function lerId(texto: string): string | null {
    try {
      return JSON.parse(texto)?.key?.id ?? null
    } catch {
      return null
    }
  }

  try {
    // Botão só existe de verdade na API oficial. Pela Evolution o
    // WhatsApp às vezes aceita, às vezes entrega como texto puro, às
    // vezes recusa. Tenta, e se recusar manda o texto de sempre — a
    // cliente digitando 1 chega no mesmo lugar que tocando no botão.
    if (e.botoes && e.botoes.length > 0) {
      const r = await bater('sendButtons', {
        number: e.telefone,
        title: (e.titulo ?? '').slice(0, 60) || 'Agenda',
        description: e.corpo,
        buttons: e.botoes.slice(0, 3),
        delay: 1200,
      })

      if (r.ok) {
        return { ok: true, providerId: lerId(await r.text()) }
      }
      // caiu para o texto: registra o motivo mas não falha o envio
      console.warn('sendButtons recusado, indo de texto:', r.status, (await r.text()).slice(0, 200))
    }

    const r = await bater('sendText', {
      number: e.telefone,
      text: textoInteiro(e),
      // um respiro entre mensagens ajuda a não parecer robô
      delay: 1200,
    })

    const corpo = await r.text()
    if (!r.ok) {
      // 4xx é problema da mensagem; 5xx é a instância fora do ar
      return { ok: false, erro: `${r.status} ${corpo}`.slice(0, 400), permanente: r.status < 500 }
    }

    return { ok: true, providerId: lerId(corpo) }
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
      body: JSON.stringify(
        e.botoes && e.botoes.length > 0
          ? {
              // na API oficial o botão é de primeira classe e sempre
              // renderiza — dentro da janela de 24h, sem template
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: e.telefone,
              type: 'interactive',
              interactive: {
                type: 'button',
                body: { text: textoInteiro(e).slice(0, 1024) },
                action: {
                  buttons: e.botoes.slice(0, 3).map((b) => ({
                    type: 'reply',
                    reply: { id: b.id, title: b.displayText.slice(0, 20) },
                  })),
                },
              },
            }
          : {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: e.telefone,
              type: 'text',
              text: { preview_url: false, body: textoInteiro(e) },
            },
      ),
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
