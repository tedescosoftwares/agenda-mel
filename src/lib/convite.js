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

// 3.79: para onde ela ia quando o cadastro foi pedido (a página pública do salão: "marcar Escova" → entrar →
// a página do serviço). Viaja na URL (?depois=/cliente/servico/…), porque o endereço do salão é outro domínio,
// e fica guardado aqui até a Home da cliente usar. Só caminhos da cliente; vale 2 horas.
const CHAVE_DEPOIS = 'mimo-depois'
const DEPOIS_OK = /^\/cliente\/[a-z0-9][a-z0-9/_\-?=&:%.]{0,280}$/i
export function depoisValido(caminho) {
  const c = String(caminho ?? '')
  return DEPOIS_OK.test(c) && !c.includes('//') ? c : null
}
export function guardarDepois(caminho) {
  const c = depoisValido(caminho)
  if (!c) return
  try { localStorage.setItem(CHAVE_DEPOIS, JSON.stringify({ c, em: Date.now() })) } catch { /* sem storage: ela cai na Home */ }
}
// lê e apaga (uma vez só)
export function tomarDepois() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_DEPOIS) || 'null')
    localStorage.removeItem(CHAVE_DEPOIS)
    if (!v || Date.now() - Number(v.em) > 2 * 3600e3) return null
    return depoisValido(v.c)
  } catch { return null }
}
