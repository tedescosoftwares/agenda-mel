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

// devolve { razao_social, nome_fantasia, address, bairro, city, uf, cep, telefone, email, situacao, socios } ou lança
export async function buscarCnpj(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  if (!cnpjValido(d)) throw new Error('Confere o CNPJ: os dígitos não batem.')
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000)
  let r
  try {
    r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: ctrl.signal, headers: { accept: 'application/json' } })
  } catch { throw new Error('Não deu para consultar o CNPJ agora. Preencha à mão ou tente de novo.') } finally { clearTimeout(t) }
  if (r.status === 404) throw new Error('CNPJ não encontrado na Receita.')
  if (!r.ok) throw new Error('A consulta do CNPJ falhou. Preencha à mão ou tente de novo.')
  const j = await r.json()
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
