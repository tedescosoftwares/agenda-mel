// O código de entrada numa agenda (ANA7K2) viaja de três jeitos: dentro
// do QR, num link (/v/ANA7K2) ou digitado. Aqui fica o que é comum:
// reconhecer o código em qualquer um deles e guardá-lo enquanto a pessoa
// ainda não tem conta.
//
// Guardar aqui é só conforto para quem já tem conta e vai logar: o
// caminho que NÃO pode falhar (cadastro novo) manda o código nos
// metadados da conta, e o servidor cria o vínculo. Ver 053.

const CHAVE = 'mimo-convite'

// reconhecer o código vive em packages/core (o app usa igual)
export { CODIGO_RE, extrairCodigo } from '../../packages/core/convite.js'

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
