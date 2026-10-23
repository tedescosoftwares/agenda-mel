// A IA que responde num esquema JSON — Groq (compatível com a OpenAI) ou Claude (API de Messages) — com os contornos que
// a Mel do guia aprendeu (3.48→3.49): pede primeiro com o esquema estrito (json_schema); no Groq o esquema estrito às
// vezes recusa o que o modelo escreveu (json_validate_failed: JSON fora do esquema, ou nada, quando o raciocínio comeu o
// espaço) — aí lê o que veio em failed_generation se der; senão pede de novo no modo JSON simples (json_object), com os
// campos pedidos no prompt. Também junta mensagens seguidas do mesmo lado e começa pela cliente (o Claude exige).
//
// Genérico (3.55): cada agente passa o SEU esquema, a SUA frase de campos e o SEU leitor. A Mel-cliente (guia_whats.ts) e
// o agente de onboarding (guia_onboarding.ts) usam a mesma função; os testes passam um fetch de mentira.

export type Ambiente = { get(nome: string): string | undefined | null }
export type Fetch = (url: string, init: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string> }>
export type Mensagem = { role: 'user' | 'assistant'; content: string }
export type PedidoJson = { provedor: string; modelo: string; sistema: string; mensagens: Mensagem[] }
export type RespostaJson<T> = { leitura: T | null; erro?: string; modelo?: string }
export type OpcoesJson<T> = {
  esquema: Record<string, unknown>                      // o JSON Schema (estrito: additionalProperties false, tudo required)
  campos: string                                        // a frase "Responda só com um objeto JSON com exatamente estes campos..."
  montar: (lido: Record<string, unknown>) => T | null   // valida o objeto lido e monta a leitura tipada (null = inútil)
  maxTokens?: { claude: number; groq: number }
}

// lê um JSON mesmo com texto antes ou depois do objeto, ou dentro de ```json
export function lerJson(texto: string): Record<string, unknown> | null {
  const t = String(texto ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (!t) return null
  try { return JSON.parse(t) } catch { /* talvez venha texto antes ou depois do objeto */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { return null } }
  return null
}

export function iaJsonDe<T>(env: Ambiente, fetcher: Fetch, o: OpcoesJson<T>): (p: PedidoJson) => Promise<RespostaJson<T>> {
  return async (p) => {
    const claude = p.provedor === 'claude'
    const chave = String(env.get(claude ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY') ?? '').trim()
    if (!chave) return { leitura: null, erro: `${claude ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY'} não configurada`, modelo: p.modelo }
    // o Claude quer começar com a cliente e alternar os papéis: junta as seguidas do mesmo lado
    const msgs: Mensagem[] = []
    for (const m of p.mensagens) {
      if (!m.content) continue
      const ultima = msgs[msgs.length - 1]
      if (ultima && ultima.role === m.role) ultima.content += `\n${m.content}`
      else msgs.push({ ...m })
    }
    while (msgs.length && msgs[0].role !== 'user') msgs.shift()
    const sistema = `${p.sistema}\n\n${o.campos}`
    const max = o.maxTokens ?? { claude: 1500, groq: 2500 }

    const pedir = async (formato: 'json_schema' | 'json_object') => {
      let url: string, headers: Record<string, string>, corpo: Record<string, unknown>
      if (claude) {
        url = 'https://api.anthropic.com/v1/messages'
        const workspace = String(env.get('ANTHROPIC_WORKSPACE_ID') ?? '').trim()
        headers = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', ...(workspace ? { 'anthropic-workspace-id': workspace } : {}) }
        corpo = { model: p.modelo, max_tokens: max.claude, system: sistema, messages: msgs, ...(formato === 'json_schema' ? { output_config: { format: { type: 'json_schema', schema: o.esquema } } } : {}) }
      } else {
        url = 'https://api.groq.com/openai/v1/chat/completions'
        headers = { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }
        corpo = { model: p.modelo, temperature: 0.4, max_tokens: max.groq, messages: [{ role: 'system', content: sistema }, ...msgs],
          response_format: formato === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'resposta', strict: true, schema: o.esquema } } : { type: 'json_object' },
          ...(p.modelo.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}) }
      }
      const r = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(25_000) })
      const cru = await r.text()
      let j: Record<string, unknown> | null = null
      try { j = JSON.parse(cru) } catch { j = null }
      const err = (j?.error ?? null) as { code?: string; message?: string; failed_generation?: string } | null
      const texto = claude
        ? ((j?.content ?? []) as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
        : String(((j?.choices ?? []) as Array<{ message?: { content?: string } }>)[0]?.message?.content ?? '')
      return { status: r.status, cru, err, texto }
    }

    try {
      let r = await pedir('json_schema')
      if (r.status >= 200 && r.status < 300 && !r.err) {
        const leitura = o.montar(lerJson(r.texto) ?? {})
        if (leitura) return { leitura, modelo: p.modelo }
        // veio vazio ou fora do esquema (o Groq às vezes aceita e devolve ""): de novo, no modo simples
        r = await pedir('json_object')
      } else if (r.status === 400 && (r.err?.code === 'json_validate_failed' || /response_format|json_schema|structured|strict|schema/i.test(r.err?.message ?? ''))) {
        // o que o modelo escreveu, se der para ler; senão de novo sem o esquema estrito
        const salvo = typeof r.err?.failed_generation === 'string' ? o.montar(lerJson(r.err.failed_generation) ?? {}) : null
        if (salvo) return { leitura: salvo, modelo: p.modelo }
        r = await pedir('json_object')
      }
      if (r.status < 200 || r.status >= 300 || r.err) return { leitura: null, erro: `IA respondeu ${r.status}: ${String(r.err?.message ?? r.cru).slice(0, 200)}`, modelo: p.modelo }
      const leitura = o.montar(lerJson(r.texto) ?? {})
      if (!leitura) return { leitura: null, erro: 'a IA não devolveu a resposta', modelo: p.modelo }
      return { leitura, modelo: p.modelo }
    } catch (e) {
      return { leitura: null, erro: String((e as Error)?.message ?? e).slice(0, 200), modelo: p.modelo }
    }
  }
}
