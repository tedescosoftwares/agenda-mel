// Testes das peças do acesso (3.98), sem rede:
//
//   node --experimental-strip-types supabase/functions/_shared/acesso.teste.ts
import assert from 'node:assert/strict'
import { nomeDeVerdade, numeroCompleto, telefoneBonito, telefoneEscondido, emailDoWhatsapp, ehEmailDoWhatsapp, tokenNovo, tokenValido,
  hashDoToken, urlDoLink, textoDoLink, senhaValida, emailValido } from './acesso.ts'

let ok = 0
async function caso(nome: string, f: () => Promise<void> | void) {
  try { await f(); ok++; console.log('  ✓', nome) } catch (e) { console.error('  ✗', nome); throw e }
}

await caso('nome de verdade: arruma e aceita nome e sobrenome', () => {
  assert.equal(nomeDeVerdade('ana souza'), 'Ana Souza')
  assert.equal(nomeDeVerdade('  MARIA   DA silva '), 'Maria da Silva')
  assert.equal(nomeDeVerdade('Ana-Clara D\'Ávila'), 'Ana-Clara D\'ávila')
  assert.equal(nomeDeVerdade('Júlia Gonçalves'), 'Júlia Gonçalves')
})
await caso('nome de verdade: recusa o que não é nome', () => {
  for (const t of ['kkkk', 'Ana', 'ana 123', 'teste teste', 'oi oi', 'Fulano de Tal', 'aaaa bbbb', 'xyz qwrt', '😀 Ana Souza', 'ana@x.com souza', '', null, 'a b'])
    assert.equal(nomeDeVerdade(t), null, String(t))
})
await caso('telefone: com o país, bonito e escondido', () => {
  assert.equal(numeroCompleto('(13) 99999-1234'), '5513999991234')
  assert.equal(numeroCompleto('+55 13 99999-1234'), '5513999991234')
  assert.equal(numeroCompleto('1234'), null)
  assert.equal(telefoneBonito('5513999991234'), '(13) 99999-1234')
  assert.equal(telefoneBonito('551332221234'), '(13) 3222-1234')
  assert.equal(telefoneEscondido('5513999991234'), '(13) •••••-1234')
})
await caso('o endereço de entrada de quem veio pelo WhatsApp', () => {
  assert.equal(emailDoWhatsapp('+55 (13) 99999-1234'), '5513999991234@whatsapp.mimo.com.vc')
  assert.ok(ehEmailDoWhatsapp('5513999991234@WhatsApp.mimo.com.vc'))
  assert.ok(!emailValido('5513999991234@whatsapp.mimo.com.vc'))
  assert.ok(emailValido('ana@exemplo.com'))
  assert.ok(!emailValido('ana@'))
})
await caso('o token: aleatório, válido e com hash fixo', async () => {
  const a = tokenNovo(), b = tokenNovo()
  assert.equal(a.length, 16); assert.notEqual(a, b); assert.ok(tokenValido(a))
  assert.ok(!tokenValido('abc')); assert.ok(!tokenValido('abc-def-ghi-jkl'))
  assert.equal(await hashDoToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(urlDoLink('Tk12', 'https://mimo.com.vc/'), 'https://mimo.com.vc/s/Tk12')
})
await caso('a mensagem do link e a senha', () => {
  assert.match(textoDoLink('https://mimo.com.vc/s/x', 'Ana Souza'), /^Ana, quer acompanhar seus horários pelo app\?/)
  assert.match(textoDoLink('https://mimo.com.vc/s/x'), /vale uma vez, por 7 dias\.$/)
  assert.equal(senhaValida('1234567'), 'A senha precisa de pelo menos 8 caracteres.')
  assert.equal(senhaValida('12345678'), null)
})

console.log(`\n${ok} casos ok`)
