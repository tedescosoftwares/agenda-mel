import { supabase } from './supabase'

// Chama uma Edge Function com o token da pessoa logada (como na web,
// src/lib/pagamento.js). A função responde com { erro } quando algo falha:
// vira uma exceção com o texto para a tela mostrar.
export async function chamar<T = unknown>(nome: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo })
  if (error) {
    let detalhe = error.message
    try {
      const j = (await (error as { context?: { json?: () => Promise<{ erro?: string }> } }).context?.json?.()) ?? null
      if (j?.erro) detalhe = j.erro
    } catch {
      // sem corpo
    }
    throw new Error(detalhe)
  }
  if ((data as { erro?: string } | null)?.erro) throw new Error((data as { erro: string }).erro)
  return data as T
}
