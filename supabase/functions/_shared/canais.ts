// Adaptadores de canal.
//
// Cada um recebe a mesma coisa (para quem, o quê, qual conta) e devolve
// a mesma coisa (deu certo? qual o id da mensagem lá do outro lado?).
// Trocar de canal é trocar uma linha na tabela whatsapp_channels.

export type Botao = { type: 'reply'; displayText: string; id: string }

export type EstiloBotao = 'texto' | 'enquete' | 'lista' | 'nativo'

export type Envio = {
  telefone: string // 5513998710002
  titulo?: string | null
  corpo: string
  botoes?: Botao[] | null
  // como as opções tocáveis são desenhadas pela Evolution:
  //   enquete — poll do WhatsApp, recurso de consumidor, renderiza sempre
  //   lista   — listMessage, instável fora da API oficial
  //   nativo  — nativeFlow buttons, só renderiza na Cloud API
  estilo?: EstiloBotao | null
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
    const opcoes = (e.botoes ?? []).slice(0, 3)

    // O banco só entrega opções quando elas vão virar algo tocável de
    // verdade (cloud) ou quando o salão pediu enquete de propósito.
    // 'texto' e 'nativo' na Evolution caem no sendText logo abaixo,
    // com o "Responda 1 ou 2" que o banco já colou no corpo.
    if (opcoes.length > 0 && e.estilo !== 'texto') {
      const estilo = e.estilo ?? 'enquete'
      let r: Response | null = null

      if (estilo === 'enquete') {
        // Enquete é recurso de consumidor do WhatsApp: renderiza em
        // qualquer aparelho, sem nativeFlow, sem viewOnce. O voto volta
        // descriptografado pela própria Evolution (pollUpdateMessage
        // com vote.selectedOptions = nomes das opções).
        // Limite do WhatsApp: pergunta até 255 caracteres.
        r = await bater('sendPoll', {
          number: e.telefone,
          name: textoInteiro(e).slice(0, 255),
          selectableCount: 1,
          values: opcoes.map((b) => b.displayText.slice(0, 100)),
          delay: 1200,
        })
      } else if (estilo === 'lista') {
        // Na 2.3.7 a própria Evolution recusa com 400 ("this.isZero is
        // not a function", bug de protobuf). Fica aqui para versões que
        // consertem; hoje cai para o texto logo abaixo.
        r = await bater('sendList', {
          number: e.telefone,
          title: (e.titulo ?? '').slice(0, 60) || 'Agenda',
          description: e.corpo,
          buttonText: 'Responder',
          sections: [
            {
              title: 'Escolha uma opção',
              rows: opcoes.map((b) => ({ title: b.displayText, rowId: b.id, description: '' })),
            },
          ],
          delay: 1200,
        })
      } else {
        // nativo: a Evolution aceita e devolve 200, mas em cliente
        // não-oficial o aparelho mostra "Não foi possível carregar a
        // mensagem". Fica disponível para quem quiser experimentar.
        r = await bater('sendButtons', {
          number: e.telefone,
          title: (e.titulo ?? '').slice(0, 60) || 'Agenda',
          description: e.corpo,
          buttons: opcoes,
          delay: 1200,
        })
      }

      if (r.ok) {
        return { ok: true, providerId: lerId(await r.text()) }
      }
      // a Evolution recusou o formato: cai para o texto, sem perder a mensagem
      console.warn(`estilo ${estilo} recusado, indo de texto:`, r.status, (await r.text()).slice(0, 200))
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
  // O "+" é o nosso desempate de país e não faz parte do que os
  // provedores esperam: tanto a Evolution quanto a Cloud querem só
  // dígitos. Tirar aqui, num lugar só, evita ter que lembrar disso em
  // cada chamada.
  e = { ...e, telefone: e.telefone.replace(/\D/g, '') }

  if (canal === 'evolution') return enviarPelaEvolution(e)
  if (canal === 'cloud') return enviarPelaCloud(e)
  return Promise.resolve({
    ok: false,
    erro: `canal desconhecido: ${canal}`,
    permanente: true,
  })
}
