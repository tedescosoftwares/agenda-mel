// Escrever fora (3.32): quem tem o próprio modelo de texto (o GPT, por exemplo) copia o pedido que a função
// guia-gerar montaria para a IA, cola a resposta aqui, e o editor preenche os campos. O pedido vem da
// função ({ lugar|pagina, prompt: true } → { sistema, pedido }), igual ao que a IA receberia.

// o texto que vai para a área de transferência: as duas partes do pedido, com um lembrete do formato
export function pedidoParaTexto({ sistema, pedido }) {
  return `${String(sistema ?? '').trim()}\n\n${String(pedido ?? '').trim()}\n\nResponda só com o objeto JSON pedido acima, sem nada antes ou depois.`
}

// o JSON colado: aceita a resposta com cerca de código (```json … ```) ou com texto em volta; null se não houver objeto
export function extrairJsonColado(texto) {
  const limpo = String(texto ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const tentar = (x) => { try { const o = JSON.parse(x); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null } }
  const ini = limpo.indexOf('{'), fim = limpo.lastIndexOf('}')
  return tentar(limpo) ?? (ini >= 0 && fim > ini ? tentar(limpo.slice(ini, fim + 1)) : null)
}

// copia para a área de transferência; false quando o navegador não deixa (aí a tela mostra o texto para copiar à mão)
export async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true } catch { return false }
}
