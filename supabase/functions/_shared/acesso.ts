// 3.98: as peças do cadastro da cliente pelo WhatsApp e do acesso ao app sem senha até o primeiro acesso. Usadas pela
// assistente (agente.ts: cadastra e manda o link) e pela função acesso (ver o link, criar a senha, pedir o link, entrar
// pelo número). Sem rede: testadas em acesso.teste.ts.

// a conta de quem veio pelo WhatsApp entra por um endereço sem caixa de correio (enfileirar_email não manda nada para ele)
export const DOMINIO_DO_WHATSAPP = 'whatsapp.mimo.com.vc'
export const SITE_PADRAO = 'https://mimo.com.vc'
export const DIAS_DO_LINK = 7

export const digitos = (t: unknown) => String(t ?? '').replace(/\D/g, '')

// o número com o país: 10 ou 11 dígitos ganham o 55 do Brasil; 12 a 15 já vêm com o país
export function numeroCompleto(t: unknown): string | null {
  let d = digitos(t)
  if (d.length === 10 || d.length === 11) d = '55' + d
  return d.length >= 12 && d.length <= 15 ? d : null
}

// 5513999991234 → (13) 99999-1234 (fora do Brasil: +país…)
export function telefoneBonito(t: unknown): string {
  const d = numeroCompleto(t) ?? digitos(t)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const n = d.slice(2)
    return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`
  }
  return d ? `+${d}` : ''
}

// (13) 99999-1234 → (13) •••••-1234
export function telefoneEscondido(t: unknown): string {
  const b = telefoneBonito(t)
  return b.replace(/\d(?=[\d-]*-\d{4}$)/g, '•')
}

export const emailDoWhatsapp = (numero: string) => `${digitos(numero)}@${DOMINIO_DO_WHATSAPP}`
export const ehEmailDoWhatsapp = (email: unknown) => String(email ?? '').toLowerCase().endsWith(`@${DOMINIO_DO_WHATSAPP}`)

// o nome e sobrenome de verdade, arrumado ("ana  souza" → "Ana Souza"); null quando não parece nome de gente
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von'])
const NAO_E_NOME = new Set(['teste', 'testando', 'cliente', 'fulano', 'fulana', 'ciclano', 'beltrano', 'ninguem', 'nenhum', 'eu', 'sim', 'nao',
  'oi', 'ola', 'asdf', 'qwerty', 'kkk', 'haha', 'rsrs', 'nome', 'sobrenome', 'mae', 'pai', 'amiga', 'amigo', 'bot', 'robo'])
export function nomeDeVerdade(t: unknown): string | null {
  const bruto = String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
  if (bruto.length < 5 || bruto.length > 60) return null
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(bruto)) return null            // só letras (com acento), espaço, apóstrofo, hífen, ponto
  const palavras = bruto.split(' ').filter(Boolean)
  const nomes = palavras.filter((p) => !PARTICULAS.has(p.toLowerCase()))
  if (nomes.length < 2) return null                                   // nome e sobrenome
  for (const p of nomes) {
    const limpo = p.replace(/[.'-]/g, '')
    const sem = limpo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    if (limpo.length < 2) return null
    if (NAO_E_NOME.has(sem)) return null
    if (/^(.)\1+$/.test(sem)) return null                             // kkkk, aaaa
    if (/(.)\1\1/.test(sem)) return null                              // três letras iguais seguidas
    if (!/[aeiouy]/.test(sem)) return null                            // sem vogal não é nome
  }
  return palavras.map((p, i) => (i > 0 && PARTICULAS.has(p.toLowerCase()) ? p.toLowerCase()
    : p.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join('-'))).join(' ')
}

// o token do link: 16 letras e números (95 bits); no banco fica só o hash
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
export function tokenNovo(tamanho = 16): string {
  const b = new Uint8Array(tamanho)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join('')
}
export async function hashDoToken(token: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)))
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('')
}
export const tokenValido = (t: unknown) => /^[A-Za-z0-9]{12,40}$/.test(String(t ?? ''))
export const urlDoLink = (token: string, site = SITE_PADRAO) => `${site.replace(/\/$/, '')}/s/${token}`

// a mensagem do link, igual pela assistente e pelo app
export function textoDoLink(url: string, nome?: string | null): string {
  const primeiro = String(nome ?? '').trim().split(' ')[0]
  return `${primeiro ? `${primeiro}, quer` : 'Quer'} acompanhar seus horários pelo app? Toque aqui para criar sua senha:\n${url}\nO link é só seu e vale uma vez, por ${DIAS_DO_LINK} dias.`
}
export function textoDoLinkPedido(url: string, nome?: string | null): string {
  const primeiro = String(nome ?? '').trim().split(' ')[0]
  return `Oi${primeiro ? `, ${primeiro}` : ''}! Para criar sua senha no app da MIMO, toque aqui:\n${url}\nO link é só seu e vale uma vez, por ${DIAS_DO_LINK} dias. Se não foi você que pediu, é só ignorar.`
}

export function senhaValida(s: unknown): string | null {
  const t = String(s ?? '')
  if (t.length < 8) return 'A senha precisa de pelo menos 8 caracteres.'
  if (t.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  return null
}
export const emailValido = (e: unknown) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e ?? '').trim()) && !ehEmailDoWhatsapp(e)
