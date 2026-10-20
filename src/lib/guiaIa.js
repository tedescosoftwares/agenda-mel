// Qual IA escreve o guia (3.27): Gemini ou Groq, lado a lado; 3.31: o Claude (Anthropic) também. A escolha é feita na
// Plataforma, vai em cada pedido à função guia-gerar ("provedor") e fica lembrada no aparelho. O modelo que escreveu
// fica gravado no texto (_meta.modelo e _meta.provedor).
export const IAS = [['gemini', 'Gemini'], ['groq', 'Groq'], ['claude', 'Claude']]
// 3.34: os modelos de cada IA que dá para escolher (a mesma lista da função, MODELOS em conteudo.ts); vazio é o padrão
// do segredo (GUIA_IA_MODELO, GUIA_IA_MODELO_GEMINI, GUIA_IA_MODELO_CLAUDE)
export const MODELOS = {
  gemini: [
    { id: 'gemini-3-flash-preview', nome: 'Gemini 3 Flash', nota: 'grátis, rápido' },
    { id: 'gemini-flash-latest', nome: 'Gemini Flash (último)', nota: 'pensa antes, mais lento' },
    { id: 'gemini-flash-lite-latest', nome: 'Gemini Flash Lite', nota: 'o mais leve' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', nome: 'GPT-OSS 120B', nota: 'grátis, o maior do Groq' },
    { id: 'openai/gpt-oss-20b', nome: 'GPT-OSS 20B', nota: 'grátis, mais rápido' },
    { id: 'llama-3.3-70b-versatile', nome: 'Llama 3.3 70B', nota: 'grátis' },
  ],
  claude: [
    { id: 'claude-haiku-5-5', nome: 'Haiku 5.5', nota: 'o mais barato (US$ 0,10 e 0,50 por milhão de tokens)' },
    { id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5', nota: 'meio-termo (US$ 2 e 10)' },
    { id: 'claude-opus-5-5', nome: 'Opus 5.5', nota: 'o melhor e o mais caro (US$ 4 e 20)' },
  ],
}
const CHAVE = 'mimo-guia-ia'
const CHAVE_MODELO = 'mimo-guia-modelo:'
export function modeloLembrado(ia) {
  try { const v = localStorage.getItem(CHAVE_MODELO + ia) ?? ''; return (MODELOS[ia] ?? []).some((m) => m.id === v) ? v : '' } catch { return '' }
}
export function lembrarModelo(ia, v) {
  try { if (v) localStorage.setItem(CHAVE_MODELO + ia, v); else localStorage.removeItem(CHAVE_MODELO + ia) } catch { /* sem storage */ }
}
export function iaLembrada() {
  try { const v = localStorage.getItem(CHAVE); return IAS.some(([id]) => id === v) ? v : 'gemini' } catch { return 'gemini' }
}
export function lembrarIa(v) {
  try { localStorage.setItem(CHAVE, v) } catch { /* sem storage */ }
}
