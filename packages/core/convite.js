// O código de entrada numa agenda (ANA7K2) viaja de três jeitos: dentro
// do QR, num link (/v/ANA7K2) ou digitado. Aqui fica o que é comum à web e
// ao app: reconhecer o código em qualquer um deles. Guardar o código
// enquanto a pessoa não tem conta é de cada lado (localStorage na web,
// AsyncStorage no app).

export const CODIGO_RE = /^[A-Z2-9]{6}$/

// aceita "ANA7K2", "ana7k2", "https://mimo.com.vc/v/ANA7K2", "/v/ANA7K2"
export function extrairCodigo(texto) {
  if (!texto) return null
  const t = String(texto).trim()
  const m = t.match(/\/v\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  const bruto = (m ? m[1] : t).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODIGO_RE.test(bruto) ? bruto : null
}

// linkDoCodigo('https://mimo.com.vc', 'ANA7K2') -> 'https://mimo.com.vc/v/ANA7K2'
export function linkDoCodigo(origem, codigo) {
  return `${String(origem ?? '').replace(/\/+$/, '')}/v/${codigo}`
}
