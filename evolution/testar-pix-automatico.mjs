#!/usr/bin/env node
// Sondagem do Pix Automático na Asaas (Sandbox por padrão). Só chama a API
// e mostra as respostas cruas: não grava nada no MIMO.
//
//   ASAAS_API_KEY=... node evolution/testar-pix-automatico.mjs
//   ASAAS_AMBIENTE=producao só muda a URL; a habilitação no Sandbox não
//   quer dizer habilitação em Produção.
//
// Passos: 1) lista as autorizações (diz se o recurso existe pra conta);
//         2) acha ou cria um cliente de teste; 3) tenta criar uma
//         autorização com paymentCreationMode MANUAL (a MIMO calcula o
//         valor de cada mês e cria cada cobrança).
const KEY = globalThis.process.env.ASAAS_API_KEY
if (!KEY) { console.error('Falta ASAAS_API_KEY no ambiente (não cole a chave em lugar nenhum: exporte a variável).'); globalThis.process.exit(2) }
const BASE = (globalThis.process.env.ASAAS_AMBIENTE ?? 'sandbox').toLowerCase() === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
const H = { 'access_token': KEY, 'Content-Type': 'application/json', 'User-Agent': 'mimo-sondagem' }

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined })
  const texto = await r.text()
  let json; try { json = JSON.parse(texto) } catch { json = texto }
  console.log(`\n${metodo} ${caminho} → ${r.status}`)
  console.log(typeof json === 'string' ? json.slice(0, 600) : JSON.stringify(json, null, 2).slice(0, 2500))
  return { status: r.status, json }
}

const hoje = new Date(); const d = (n) => new Date(hoje.getTime() + n * 86400000).toISOString().slice(0, 10)

// 1. o recurso existe pra esta conta?
const lista = await chamar('GET', '/pix/automatic/authorizations?limit=5')
if (lista.status === 404 || lista.status === 403) { console.log('\n>> Pix Automático não disponível pra esta conta/ambiente.'); globalThis.process.exit(1) }

// 2. um cliente de teste
let cliente = null
const cs = await chamar('GET', '/customers?limit=1&name=' + encodeURIComponent('Sondagem MIMO'))
if (cs.json?.data?.length) cliente = cs.json.data[0]
else {
  const novo = await chamar('POST', '/customers', { name: 'Sondagem MIMO', cpfCnpj: '24971563792', email: 'sondagem@mimo.com.vc', mobilePhone: '11999999999', externalReference: 'sondagem-pix-automatico' })
  cliente = novo.json?.id ? novo.json : null
}
if (!cliente) { console.log('\n>> Não consegui um cliente de teste; veja a resposta acima.'); globalThis.process.exit(1) }
console.log('\ncliente:', cliente.id)

// 3. a autorização, em modo MANUAL. Se a Asaas reclamar de campo, ela
//    lista os que faltam: é isso que a gente quer descobrir.
const contractId = 'MIMOSONDAGEM' + Date.now().toString(36).toUpperCase()   // idContrato: até 35 caracteres
// o formato documentado (docs.asaas.com › Criar uma autorização): o QR já é o primeiro pagamento
const tentativas = [
  { customerId: cliente.id, contractId, frequency: 'MONTHLY', startDate: d(0), description: 'MIMO Pro mensalidade', paymentCreationMode: 'MANUAL', retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS',
    immediateQrCode: { originalValue: 44.90, expirationSeconds: 259200, description: 'MIMO Pro 1o mes' } },
]
for (const corpo of tentativas) {
  const r = await chamar('POST', '/pix/automatic/authorizations', corpo)
  if (r.status >= 200 && r.status < 300) { console.log('\n>> Autorização criada. Campos devolvidos acima (QR, status, id) são o que a tela vai usar.'); globalThis.process.exit(0) }
}
console.log('\n>> Nenhuma tentativa passou. As mensagens de erro acima dizem os campos esperados.')
