const CHAVE = 'agenda-mel:indicacao'

// O código chega pela URL do convite (/p/ana?indique=MARIA1234)
// e fica guardado até a cliente terminar o cadastro.
export function guardarCodigoDaURL() {
  try {
    const params = new URLSearchParams(window.location.search)
    const codigo = params.get('indique') || params.get('ref')
    if (codigo) sessionStorage.setItem(CHAVE, codigo.trim().toUpperCase())
  } catch {
    // navegador sem sessionStorage: seguimos sem o código
  }
}

export function lerCodigoGuardado() {
  try {
    return sessionStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function limparCodigoGuardado() {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // nada a fazer
  }
}

export function formatarCents(cents) {
  return (Number(cents ?? 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
