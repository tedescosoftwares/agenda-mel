// Dois ambientes, um código (2.11):
//   cliente   mimo.com.vc        quem marca horário
//   pro       pro.mimo.com.vc    quem atende: profissional autônoma e salão
// O ambiente vem do endereço. No PC de desenvolvimento (localhost) não
// há subdomínio: ?ambiente=pro fica guardado no aparelho.
const CHAVE = 'mimo-ambiente'

function descobrir() {
  if (typeof window === 'undefined') return 'cliente'
  const host = window.location.hostname
  const q = new URLSearchParams(window.location.search).get('ambiente')
  if (q === 'pro' || q === 'cliente') {
    try { localStorage.setItem(CHAVE, q) } catch { /* sem storage */ }
    return q
  }
  if (host.startsWith('pro.')) return 'pro'
  if (ehLocal(host)) {
    try { return localStorage.getItem(CHAVE) === 'pro' ? 'pro' : 'cliente' } catch { return 'cliente' }
  }
  return 'cliente'
}

function ehLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || !host.includes('.')
}

export const AMBIENTE = descobrir()
export const ehPro = AMBIENTE === 'pro'

// o papel pertence a qual ambiente? (plataforma é painel de PC: qualquer um)
export function ambienteDoPapel(role) {
  if (role === 'profissional' || role === 'admin') return 'pro'
  if (role === 'cliente') return 'cliente'
  return null
}

// endereço completo de um caminho no outro ambiente
export function urlDoAmbiente(qual, caminho = '/') {
  const { protocol, hostname, port } = window.location
  if (ehLocal(hostname)) {
    const sep = caminho.includes('?') ? '&' : '?'
    return `${caminho}${sep}ambiente=${qual}`
  }
  const base = hostname.replace(/^pro\./, '')
  const host = qual === 'pro' ? `pro.${base}` : base
  return `${protocol}//${host}${port ? ':' + port : ''}${caminho}`
}

export function irParaAmbiente(qual, caminho = '/') {
  const alvo = urlDoAmbiente(qual, caminho)
  if (ehLocal(window.location.hostname)) {
    try { localStorage.setItem(CHAVE, qual) } catch { /* sem storage */ }
  }
  window.location.replace(alvo)
}
