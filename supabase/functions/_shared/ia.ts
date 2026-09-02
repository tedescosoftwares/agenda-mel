// Classificador de intenção: traduz português bagunçado para uma das
// palavras que o banco já sabe executar.
//
// Não decide nada. Só traduz. A decisão continua em
// receber_resposta_whatsapp(), e uma intenção que não esteja na lista
// vira 'nada' lá dentro — então mesmo que o modelo invente, ninguém age.

export type Intencao =
  | 'agendar' | 'remarcar' | 'cancelar' | 'confirmar'
  | 'preco' | 'horarios' | 'outro'

export type Leitura = {
  intencao: Intencao
  servico: string | null
  dia: string | null
  hora: string | null
  modelo: string
  ms: number
  erro?: string
}

// O mesmo prompt da bancada. Se mudar aqui, mude lá — é ele que o
// placar de 10/10 mediu, e prompt não medido é chute.
const SISTEMA = `Você lê a mensagem de uma cliente de um salão de beleza no WhatsApp e devolve só o JSON.

intencao, escolha uma:
  agendar    quer marcar horário, INCLUSIVE quando propõe um dia ou hora ("da pra sexta 15h?")
  remarcar   quer mudar um horário que já tem
  cancelar   quer desmarcar, ou avisa que não vai poder ir
  confirmar  está confirmando que vem
  preco      pergunta quanto custa
  horarios   pergunta o que está livre SEM propor dia nem hora ("que horários você tem?")
  outro      qualquer outra coisa

servico: manicure, pedicure, sobrancelha, cilios, cabelo, depilacao, ou null
dia: segunda, terca, quarta, quinta, sexta, sabado, domingo, hoje, amanha, ou null
hora: HH:MM em 24h, ou null

REGRA MAIS IMPORTANTE: nunca invente. Se a mensagem não disser o serviço,
servico é null. Se não disser o dia, dia é null. Se não disser a hora, hora
é null. "de tarde" não é hora, é null. Nome de pessoa não é serviço.
Errar para null é barato; inventar marca a cliente no serviço errado.`

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intencao: { type: 'string',
      enum: ['agendar','remarcar','cancelar','confirmar','preco','horarios','outro'] },
    servico: { type: ['string','null'],
      enum: ['manicure','pedicure','sobrancelha','cilios','cabelo','depilacao', null] },
    dia: { type: ['string','null'],
      enum: ['segunda','terca','quarta','quinta','sexta','sabado','domingo','hoje','amanha', null] },
    hora: { type: ['string','null'] },
  },
  required: ['intencao','servico','dia','hora'],
}

const PADRAO = 'openai/gpt-oss-20b'

export async function classificar(texto: string, modelo = PADRAO): Promise<Leitura> {
  const chave = Deno.env.get('GROQ_API_KEY')
  const t0 = Date.now()

  if (!chave) {
    return { intencao: 'outro', servico: null, dia: null, hora: null,
             modelo, ms: 0, erro: 'GROQ_API_KEY não configurada' }
  }

  const corpo: Record<string, unknown> = {
    model: modelo,
    temperature: 0,
    // max_tokens é RESERVA, não teto: o Groq desconta o número inteiro da
    // cota por minuto mesmo que o modelo escreva 30 tokens. 320 dá espaço
    // para o raciocínio curto do gpt-oss sem torrar a cota do salão.
    max_tokens: 320,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'intencao', strict: true, schema: ESQUEMA },
    },
    messages: [
      { role: 'system', content: SISTEMA },
      { role: 'user', content: texto },
    ],
  }
  // reasoning_effort só existe nos gpt-oss; outro modelo recusa o parâmetro
  if (modelo.includes('gpt-oss')) corpo.reasoning_effort = 'low'

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
      // a cliente está esperando: melhor desistir e responder o genérico
      // do que deixá-la olhando para "digitando..." por meio minuto
      signal: AbortSignal.timeout(12_000),
    })

    const json = await r.json()
    const ms = Date.now() - t0

    if (json?.error) {
      return { intencao: 'outro', servico: null, dia: null, hora: null,
               modelo, ms, erro: String(json.error.message ?? 'erro da API') }
    }

    const cru = json?.choices?.[0]?.message?.content
    const lido = JSON.parse(cru)
    return {
      intencao: lido.intencao ?? 'outro',
      servico: lido.servico ?? null,
      dia: lido.dia ?? null,
      hora: lido.hora ?? null,
      modelo, ms,
    }
  } catch (e) {
    // Qualquer falha vira 'outro', e 'outro' não faz nada. O caminho de
    // erro do modelo tem que ser inofensivo, não silencioso: o erro é
    // devolvido e registrado, mas a agenda não se mexe.
    return { intencao: 'outro', servico: null, dia: null, hora: null,
             modelo, ms: Date.now() - t0, erro: String(e) }
  }
}
