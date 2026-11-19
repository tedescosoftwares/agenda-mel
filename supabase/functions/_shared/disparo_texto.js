// O texto do disparo (4.4), pessoa por pessoa. JavaScript puro de propósito: o mesmo arquivo monta a mensagem na função
// disparo (Deno, na hora de mandar) e na prévia da Plataforma (o navegador importa daqui), então o que a equipe vê é o
// que sai. Testado em disparo_texto.teste.mjs.

export const RAIZ_LINK = 'https://mimo.com.vc/c/'
export const linkDoEnvio = (token) => RAIZ_LINK + token
export const VARIAVEIS = ['{nome}', '{cidade}', '{salao}', '{link}']
export const MAX_MENSAGEM = 2000

// o primeiro nome, com a primeira letra maiúscula; vazio quando não parece nome (só emoji, número, uma letra)
export function primeiroNome(n) {
  const p = String(n ?? '').trim().split(/\s+/)[0] ?? ''
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(p)) return ''
  return p[0].toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR')
}

// a mensagem de uma pessoa. Sem nome: "Oi, {nome}!" vira "Oi!" e "{nome}, tudo bem?" vira "Tudo bem?"; sem cidade, "sua
// cidade"; sem salão, "o salão". Sem {link} no texto, o link vai no fim; sem link (disparo sem destino), o {link} some.
/**
 * @param {string | null | undefined} modelo
 * @param {{ nome?: string | null, nome_whats?: string | null, cidade?: string | null, salao?: string | null }} [pessoa]
 * @param {string | null} [link]
 * @returns {string}
 */
export function montarMensagem(modelo, pessoa = {}, link = null) {
  let t = String(modelo ?? '')
  const nome = primeiroNome(pessoa.nome) || primeiroNome(pessoa.nome_whats)
  if (nome) t = t.replaceAll('{nome}', nome)
  else {
    t = t.replace(/(^|[\n.!?]\s*)\{nome\}\s*[,!]?\s*(\p{Ll})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase('pt-BR'))
    t = t.replace(/[ \t]*,?[ \t]*\{nome\}/g, '')
  }
  t = t.replaceAll('{cidade}', String(pessoa.cidade ?? '').trim() || 'sua cidade')
  t = t.replaceAll('{salao}', String(pessoa.salao ?? '').trim() || 'o salão')
  if (link) t = t.includes('{link}') ? t.replaceAll('{link}', link) : `${t.trimEnd()}\n\n${link}`
  else t = t.replace(/[ \t]*(👉|->|→)?[ \t]*\{link\}/g, '')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim()
}

// o que a Evolution respondeu, em português; voltar: o número caiu (a pessoa volta para a fila e o disparo pausa)
/**
 * @param {number} status
 * @param {string | null | undefined} corpo
 * @returns {{ erro: string, voltar: boolean }}
 */
export function lerErroDoEnvio(status, corpo) {
  const t = String(corpo ?? '')
  if (/"exists"\s*:\s*false/.test(t)) return { erro: 'número sem WhatsApp', voltar: false }
  if (!status || status >= 500 || status === 404 || /connection closed|not connected|disconnected|does not exist|not found|instance/i.test(t)) {
    return { erro: status ? `o número não respondeu (${status})` : 'o número não respondeu', voltar: true }
  }
  return { erro: t.replace(/\s+/g, ' ').slice(0, 200) || `a Evolution recusou (${status})`, voltar: false }
}

// quanto esperar até a próxima, no navegador: o ritmo dividido pelos números que alternam, com variação (25 s a 1 min
// para um ritmo de 40 s e um número); `sorte` é para o teste
export function proximaEspera(ritmo_s, numeros = 1, sorte = Math.random()) {
  const base = Math.max(15, Number(ritmo_s) || 40) / Math.max(1, Number(numeros) || 1)
  return Math.max(8, Math.round(base * (0.65 + sorte * 0.85)))
}
