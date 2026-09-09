// O código de entrada numa agenda (ANA7K2) viaja de três jeitos: dentro
// do QR, num link (/v/ANA7K2) ou digitado. Aqui fica o que é comum:
// reconhecer o código em qualquer um deles e guardá-lo enquanto a pessoa
// ainda não tem conta.
//
// Guardar aqui é só conforto para quem já tem conta e vai logar: o
// caminho que NÃO pode falhar (cadastro novo) manda o código nos
// metadados da conta, e o servidor cria o vínculo. Ver 053.

const CHAVE = 'mimo-convite'

export const CODIGO_RE = /^[A-Z2-9]{6}$/

// aceita "ANA7K2", "ana7k2", "https://mimo.com.vc/v/ANA7K2", "/v/ANA7K2"
export function extrairCodigo(texto) {
  if (!texto) return null
  const t = String(texto).trim()
  const m = t.match(/\/v\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  const bruto = (m ? m[1] : t).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODIGO_RE.test(bruto) ? bruto : null
}

export function guardarConvite(codigo) {
  try { localStorage.setItem(CHAVE, codigo) } catch { /* sem storage: segue */ }
}
export function lerConvite() {
  try { return localStorage.getItem(CHAVE) } catch { return null }
}
export function limparConvite() {
  try { localStorage.removeItem(CHAVE) } catch { /* nada */ }
}

export function linkDoCodigo(codigo) {
  return `${window.location.origin}/v/${codigo}`
}
