// Dois ambientes, um código (2.11):
//   cliente   mimo.com.vc        quem marca horário
//   pro       pro.mimo.com.vc    quem atende: profissional autônoma e salão
// O ambiente vem do endereço. No PC de desenvolvimento (localhost) não
// há subdomínio: ?ambiente=pro fica guardado no aparelho.
//
// E o endereço próprio do salão (2.80): studiomel.mimo.com.vc é o
// ambiente cliente "dentro de um salão". Só a página da casa e a da
// profissional (/<slug>) vivem lá; o resto volta para a raiz. No
// localhost, ?endereco=studiomel faz as vezes do subdomínio (só na
// aba, não fica guardado).
const CHAVE = 'mimo-ambiente'
const RAIZ_CONHECIDA = 'mimo.com.vc'

function ehLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || !host.includes('.')
}

// o domínio principal (mimo.com.vc) a partir de qualquer host nosso
function raizDe(host) {
  if (host === RAIZ_CONHECIDA || host.endsWith('.' + RAIZ_CONHECIDA)) return RAIZ_CONHECIDA
  const sem = host.replace(/^(pro|www)\./, '')
  if (sem !== host) return sem
  const partes = host.split('.')
  return partes.length > 3 ? partes.slice(1).join('.') : host
}

// o pedaço antes da raiz, se for o endereço de um salão (não pro/www)
function subdominioDe(host) {
  const raiz = raizDe(host)
  if (host === raiz) return null
  const frente = host.slice(0, -(raiz.length + 1))
  if (!frente || frente.includes('.') || frente === 'pro' || frente === 'www') return null
  return frente
}

function descobrir() {
  if (typeof window === 'undefined') return { ambiente: 'cliente', raiz: RAIZ_CONHECIDA, subdominio: null }
  const host = window.location.hostname
  const busca = new URLSearchParams(window.location.search)
  const q = busca.get('ambiente')
  if (ehLocal(host)) {
    const sub = (busca.get('endereco') || '').toLowerCase() || null
    if (q === 'pro' || q === 'cliente') {
      try { localStorage.setItem(CHAVE, q) } catch { /* sem storage */ }
      return { ambiente: q, raiz: host, subdominio: sub }
    }
    let amb = 'cliente'
    try { amb = localStorage.getItem(CHAVE) === 'pro' ? 'pro' : 'cliente' } catch { /* sem storage */ }
    return { ambiente: sub ? 'cliente' : amb, raiz: host, subdominio: sub }
  }
  if (q === 'pro' || q === 'cliente') {
    try { localStorage.setItem(CHAVE, q) } catch { /* sem storage */ }
    return { ambiente: q, raiz: raizDe(host), subdominio: null }
  }
  const sub = subdominioDe(host)
  if (sub) return { ambiente: 'cliente', raiz: raizDe(host), subdominio: sub }
  return { ambiente: host.startsWith('pro.') ? 'pro' : 'cliente', raiz: raizDe(host), subdominio: null }
}

const DESCOBERTO = descobrir()
export const AMBIENTE = DESCOBERTO.ambiente
export const ehPro = AMBIENTE === 'pro'
// o domínio principal (mimo.com.vc); no PC, localhost
export const DOMINIO_RAIZ = DESCOBERTO.raiz
// o endereço próprio do salão em que a página está, ou null
export const SUBDOMINIO = DESCOBERTO.subdominio

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
  const host = qual === 'pro' ? `pro.${DOMINIO_RAIZ}` : DOMINIO_RAIZ
  return `${protocol}//${host}${port ? ':' + port : ''}${caminho}`
}

// endereço completo do endereço próprio de um salão (studiomel.mimo.com.vc)
export function urlDoEndereco(subdominio, caminho = '/') {
  const { protocol, hostname, port } = window.location
  if (ehLocal(hostname)) {
    const sep = caminho.includes('?') ? '&' : '?'
    return `${protocol}//${hostname}${port ? ':' + port : ''}${caminho}${sep}endereco=${subdominio}`
  }
  return `${protocol}//${subdominio}.${DOMINIO_RAIZ}${port ? ':' + port : ''}${caminho}`
}

export function irParaAmbiente(qual, caminho = '/') {
  const alvo = urlDoAmbiente(qual, caminho)
  if (ehLocal(window.location.hostname)) {
    try { localStorage.setItem(CHAVE, qual) } catch { /* sem storage */ }
  }
  window.location.replace(alvo)
}
