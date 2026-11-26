// node --experimental-strip-types supabase/functions/_shared/instancia.teste.ts
import assert from 'node:assert/strict'
import { fichaDaInstancia, situacaoDoCanal, webhookDa } from './instancia.ts'

let n = 0
const t = (nome: string, f: () => void) => { f(); n++; console.log('ok', nome) }

t('ficha da Evolution 2', () => {
  const f = fichaDaInstancia({ name: 'salao-abc', connectionStatus: 'open', ownerJid: '5513998710002@s.whatsapp.net', profileName: 'Studio Mel', token: 'SEGREDO', createdAt: '2026-11-01T10:00:00Z', _count: { Message: 120, Chat: 9, Contact: 30 } })
  assert.equal(f.nome, 'salao-abc'); assert.equal(f.estado, 'open'); assert.equal(f.numero, '+55 (13) 99871-0002')
  assert.equal(f.mensagens, 120); assert.ok(!JSON.stringify(f).includes('SEGREDO'))
})
t('ficha da Evolution 1', () => {
  const f = fichaDaInstancia({ instance: { instanceName: 'salao-x', status: 'close', owner: '551332221000@s.whatsapp.net' } })
  assert.equal(f.nome, 'salao-x'); assert.equal(f.estado, 'close'); assert.equal(f.numero, '+55 (13) 3222-1000')
})
t('ficha vazia não quebra', () => { const f = fichaDaInstancia(null); assert.equal(f.nome, null); assert.equal(f.estado, 'desconhecido') })

const proprio = { canal: 'evolution', ativo: true, numero_proprio: true }
const casa = { canal: 'evolution', ativo: true, numero_proprio: false }
t('situações', () => {
  assert.equal(situacaoDoCanal(null, null, null, true), 'sem_canal')
  assert.equal(situacaoDoCanal({ ...proprio, ativo: false }, 'open', null, true), 'desligado')
  assert.equal(situacaoDoCanal(proprio, 'open', null, true), 'proprio_ok')
  assert.equal(situacaoDoCanal(proprio, 'close', 'open', true), 'proprio_caido')
  assert.equal(situacaoDoCanal(proprio, null, 'open', true), 'proprio_caido')   // a instância sumiu
  assert.equal(situacaoDoCanal(proprio, null, null, false), 'sem_resposta')     // a Evolution não respondeu: não acusa queda
  assert.equal(situacaoDoCanal(casa, 'connecting', 'open', true), 'conectando')
  assert.equal(situacaoDoCanal(casa, null, 'open', true), 'casa')
  assert.equal(situacaoDoCanal(casa, null, 'close', true), 'casa_caida')
  assert.equal(situacaoDoCanal({ canal: 'manual', ativo: true, numero_proprio: false }, null, null, true), 'manual')
})
t('webhook', () => {
  const base = 'https://x.supabase.co'
  const bom = webhookDa({ enabled: true, url: `${base}/functions/v1/whatsapp-webhook?token=abc`, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] }, base)
  assert.deepEqual([bom.existe, bom.ligado, bom.certo, bom.falta_mensagens], [true, true, true, false])
  assert.ok(!JSON.stringify(bom).includes('abc'))
  const outro = webhookDa({ webhook: { enabled: true, url: 'https://outro.com/hook', events: [] } }, base)
  assert.deepEqual([outro.existe, outro.certo, outro.falta_mensagens], [true, false, true])
  assert.equal(webhookDa(null, base).existe, false)
})
console.log(n, 'casos')
