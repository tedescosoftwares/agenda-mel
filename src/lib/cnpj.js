// CNPJ: máscara, conferência dos dígitos e a busca na Receita (pela
// BrasilAPI, pública e sem chave). O cadastro do salão usa pra preencher
// razão social e endereço sozinho quando a pessoa digita o CNPJ.

export function formatarCnpj(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function cnpjValido(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (base) => {
    let peso = base.length - 7, soma = 0
    for (const c of base) { soma += Number(c) * peso; peso = peso === 2 ? 9 : peso - 1 }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13])
}

// "PAIS LEME" → "Pais Leme"; siglas e preposições no lugar
const MIUDAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
export function nomeProprio(t) {
  return String(t ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((p, i) => (MIUDAS.has(p) && i > 0 ? p : /^(ltda|me|epp|eireli|s\/a|sa)\.?$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

function normalizarRespostaCnpj(j) {
  const rua = [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).map(nomeProprio).join(' ')
  const address = [rua, j.numero ? String(j.numero).replace(/^S\/N$/i, 's/n') : '', j.complemento ? nomeProprio(j.complemento) : ''].filter(Boolean).join(', ')
  const tel = String(j.ddd_telefone_1 ?? '').replace(/\D/g, '')
  return {
    razao_social: nomeProprio(j.razao_social),
    nome_fantasia: j.nome_fantasia ? nomeProprio(j.nome_fantasia) : '',
    address, bairro: nomeProprio(j.bairro), city: nomeProprio(j.municipio), uf: String(j.uf ?? '').toUpperCase(), cep: String(j.cep ?? '').replace(/\D/g, ''),
    telefone: tel.length >= 10 ? tel : '', email: j.email ? String(j.email).toLowerCase() : '',
    situacao: j.descricao_situacao_cadastral ?? '',
    socios: (Array.isArray(j.qsa) ? j.qsa : []).map((q) => nomeProprio(q.nome_socio)).filter(Boolean),
  }
}

async function consultarCnpjEm(url, timeout = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (r.status === 404) return { encontrado: false }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return { encontrado: true, dados: await r.json() }
  } finally {
    clearTimeout(t)
  }
}

// devolve { razao_social, nome_fantasia, address, bairro, city, uf, cep, telefone, email, situacao, socios } ou lança.
// A BrasilAPI é a primeira fonte, mas pode aplicar mitigação/rate-limit. Se ela
// falhar, a MIMO tenta diretamente o Minha Receita, que usa o mesmo formato-base
// dos dados públicos de CNPJ. Assim uma indisponibilidade externa não quebra o cadastro.
export async function buscarCnpj(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  if (!cnpjValido(d)) throw new Error('Confere o CNPJ: os dígitos não batem.')

  let naoEncontrado = false

  try {
    const primeira = await consultarCnpjEm(`https://brasilapi.com.br/api/cnpj/v1/${d}`)
    if (primeira.encontrado) return normalizarRespostaCnpj(primeira.dados)
    naoEncontrado = true
  } catch {
    // tenta a fonte abaixo
  }

  try {
    const segunda = await consultarCnpjEm(`https://minhareceita.org/${d}`)
    if (segunda.encontrado) return normalizarRespostaCnpj(segunda.dados)
    naoEncontrado = true
  } catch {
    // as duas fontes externas falharam
  }

  if (naoEncontrado) throw new Error('CNPJ não encontrado na base pública da Receita.')
  throw new Error('Não deu para consultar o CNPJ agora. Você pode tentar de novo ou preencher os dados à mão.')
}

// ---- CPF, para quem ainda não tem CNPJ ----
export function formatarCpf(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}
export function cpfValido(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')
