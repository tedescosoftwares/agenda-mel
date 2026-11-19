// node supabase/functions/_shared/disparo_texto.teste.mjs
import assert from 'node:assert/strict'
import { montarMensagem, primeiroNome, lerErroDoEnvio, proximaEspera, linkDoEnvio } from './disparo_texto.js'

let n = 0
const caso = (nome, f) => { f(); n++; console.log('  ✓', nome) }
const MODELO = 'Oi, {nome}! Aqui é a Mel, da MIMO 💗 Lembra que você procurou salão em {cidade}?\n\nO Instagram da MIMO acabou de nascer. Leva 2 segundos 👉 {link}'

caso('com tudo: nome, cidade e link', () => {
  assert.equal(montarMensagem(MODELO, { nome: 'ana paula souza', cidade: 'Santos' }, linkDoEnvio('0123456789')),
    'Oi, Ana! Aqui é a Mel, da MIMO 💗 Lembra que você procurou salão em Santos?\n\nO Instagram da MIMO acabou de nascer. Leva 2 segundos 👉 https://mimo.com.vc/c/0123456789')
})
caso('sem nome: "Oi, {nome}!" vira "Oi!"; sem cidade, "sua cidade"', () => {
  assert.equal(montarMensagem(MODELO, {}, 'https://x'), 'Oi! Aqui é a Mel, da MIMO 💗 Lembra que você procurou salão em sua cidade?\n\nO Instagram da MIMO acabou de nascer. Leva 2 segundos 👉 https://x')
})
caso('sem nome no começo da frase: "{nome}, tudo bem?" vira "Tudo bem?"', () => {
  assert.equal(montarMensagem('{nome}, tudo bem? Passando para te contar.', {}), 'Tudo bem? Passando para te contar.')
  assert.equal(montarMensagem('Oi! {nome}, tudo bem?', {}), 'Oi! Tudo bem?')
})
caso('o nome do perfil do WhatsApp quando ela não disse o nome', () => {
  assert.equal(montarMensagem('Oi, {nome}!', { nome_whats: 'Ju 💅' }), 'Oi, Ju!')
  assert.equal(montarMensagem('Oi, {nome}!', { nome_whats: '💅💅' }), 'Oi!')
})
caso('salão: o nome ou "o salão"', () => {
  assert.equal(montarMensagem('Gostou do {salao}?', { salao: 'Studio Lírio' }), 'Gostou do Studio Lírio?')
  assert.equal(montarMensagem('Gostou d{salao}?', {}), 'Gostou do salão?')
})
caso('sem {link} no texto: o link vai no fim; sem link, o {link} some', () => {
  assert.equal(montarMensagem('Oi, {nome}!', { nome: 'Bia' }, 'https://mimo.com.vc/c/aaaaaaaaaa'), 'Oi, Bia!\n\nhttps://mimo.com.vc/c/aaaaaaaaaa')
  assert.equal(montarMensagem('Siga a MIMO 👉 {link}\nObrigada!', { nome: 'Bia' }, null), 'Siga a MIMO\nObrigada!')
})
caso('primeiro nome: só o que parece nome', () => {
  assert.equal(primeiroNome('MARIA DAS GRAÇAS'), 'Maria')
  assert.equal(primeiroNome("d'ávila"), "D'ávila")
  for (const ruim of ['', '123', 'a', '💅', null, '@ana']) assert.equal(primeiroNome(ruim), '', String(ruim))
})
caso('erros da Evolution em português; número caído volta para a fila', () => {
  assert.deepEqual(lerErroDoEnvio(400, '{"status":400,"response":{"message":[{"exists":false,"number":"5513"}]}}'), { erro: 'número sem WhatsApp', voltar: false })
  assert.equal(lerErroDoEnvio(500, 'Connection Closed').voltar, true)
  assert.equal(lerErroDoEnvio(0, '').voltar, true)
  assert.equal(lerErroDoEnvio(404, 'The "mimo-disparo" instance does not exist').voltar, true)
  assert.deepEqual(lerErroDoEnvio(400, 'Text is required'), { erro: 'Text is required', voltar: false })
})
caso('a espera: o ritmo dividido pelos números, com variação', () => {
  assert.equal(proximaEspera(40, 1, 0), 26)
  assert.equal(proximaEspera(40, 1, 1), 60)
  assert.equal(proximaEspera(40, 2, 0.5), 22)
  assert.equal(proximaEspera(5, 1, 0), 10) // nunca abaixo de 15 s de ritmo
})
console.log(`${n} casos`)
