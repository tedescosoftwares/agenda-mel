// Qual IA escreve o guia (3.27): Gemini ou Groq, lado a lado. A escolha é feita na Plataforma, vai em cada
// pedido à função guia-gerar ("provedor") e fica lembrada no aparelho. O modelo que escreveu fica gravado no
// texto (_meta.modelo e _meta.provedor).
export const IAS = [['gemini', 'Gemini'], ['groq', 'Groq']]
const CHAVE = 'mimo-guia-ia'
export function iaLembrada() {
  try { const v = localStorage.getItem(CHAVE); return IAS.some(([id]) => id === v) ? v : 'gemini' } catch { return 'gemini' }
}
export function lembrarIa(v) {
  try { localStorage.setItem(CHAVE, v) } catch { /* sem storage */ }
}
