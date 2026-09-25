// A força da senha, pra barrinha do cadastro. Cinco sinais: 8+ letras,
// maiúscula e minúscula, número, símbolo, 12+ letras. Forte é o que a
// MIMO exige pra criar conta: pelo menos 8 letras e 3 dos outros sinais.
export function forcaDaSenha(senha) {
  const s = String(senha ?? '')
  if (!s) return { nivel: 0, rotulo: '', ok: false, dicas: [] }
  const sinais = { tamanho: s.length >= 8, caixas: /[a-z]/.test(s) && /[A-Z]/.test(s), numero: /\d/.test(s), simbolo: /[^A-Za-z0-9]/.test(s), longa: s.length >= 12 }
  const pontos = Object.values(sinais).filter(Boolean).length
  const repetida = /^(.)\1+$/.test(s) || /^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|senha|password)/i.test(s)
  const nivel = repetida ? 1 : Math.min(4, Math.max(1, sinais.tamanho ? pontos : 1))
  const dicas = []
  if (!sinais.tamanho) dicas.push('pelo menos 8 letras')
  if (!sinais.caixas) dicas.push('maiúscula e minúscula')
  if (!sinais.numero) dicas.push('um número')
  if (!sinais.simbolo) dicas.push('um símbolo (!, @, #…)')
  const ok = sinais.tamanho && pontos >= 4 && !repetida
  return { nivel, rotulo: ['', 'fraca', 'razoável', 'boa', 'forte'][nivel], ok, dicas }
}
