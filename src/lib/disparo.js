import { supabase } from './supabase'
import { chamar } from './pagamento'

// O disparo do WhatsApp do guia (4.4, migração 254), do lado do navegador: a função disparo (números, IA, teste, envio
// um por um) e as RPCs da Plataforma (a lista, salvar, disparar, pausar, acompanhar). O texto de cada pessoa sai do
// mesmo arquivo que a função usa para mandar (supabase/functions/_shared/disparo_texto.js): a prévia é o que sai.
export { montarMensagem, linkDoEnvio, proximaEspera, primeiroNome, VARIAVEIS, MAX_MENSAGEM } from '../../supabase/functions/_shared/disparo_texto.js'

export const disparo = (acao, corpo = {}) => chamar('disparo', { acao, ...corpo })

const faltaMigracao = (e) => e?.code === 'PGRST202' || /could not find the function|schema cache/i.test(e?.message ?? '')
export async function rpcDisparo(nome, args) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) throw new Error(faltaMigracao(error) ? 'O banco ainda não tem a migração 254: rode o bat B.' : (error.message || 'não deu certo'))
  return data
}

// os números do disparo com o que a tela mostra
export const ESTADO_NUMERO = {
  open: ['Conectado', 'verde'], connecting: ['Pareando…', 'ambar'], close: ['Desconectado', 'carmim'],
  nao_existe: ['Não conectado', 'cinza'], erro: ['A Evolution não respondeu', 'carmim'], desconhecido: ['Estado desconhecido', 'cinza'],
}

// o que aconteceu com cada envio, na ordem: falhou / na fila / enviando / entregue, viu, clicou, respondeu
export function marcasDoEnvio(e) {
  if (e.status === 'falhou') return [{ tipo: 'erro', texto: e.erro || 'não saiu' }]
  if (e.status === 'fila') return [{ tipo: 'fila', texto: 'na fila' }]
  if (e.status === 'enviando') return [{ tipo: 'agora', texto: 'enviando…' }]
  const m = [{ tipo: e.entregue_em || e.lida_em ? 'ent' : 'saiu', texto: e.entregue_em || e.lida_em ? 'entregue' : 'saiu' }]
  if (e.lida_em) m.push({ tipo: 'viu', texto: 'viu' })
  if (e.clicou_em) m.push({ tipo: 'cli', texto: e.cliques > 1 ? `clicou (${e.cliques}x)` : 'clicou' })
  if (e.respondeu_em) m.push({ tipo: 'resp', texto: 'respondeu' })
  return m
}

// os números de um disparo, das linhas (o painel do banco conta igual)
export function contasDoDisparo(envios) {
  const c = { total: envios.length, enviados: 0, falhas: 0, fila: 0, entregues: 0, lidas: 0, clicaram: 0, responderam: 0, porNumero: {} }
  for (const e of envios) {
    if (e.status === 'enviado') { c.enviados++; if (e.instancia) c.porNumero[e.instancia] = (c.porNumero[e.instancia] ?? 0) + 1 }
    if (e.status === 'falhou') c.falhas++
    if (e.status === 'fila' || e.status === 'enviando') c.fila++
    if (e.entregue_em || e.lida_em) c.entregues++
    if (e.lida_em) c.lidas++
    if (e.clicou_em) c.clicaram++
    if (e.respondeu_em) c.responderam++
  }
  return c
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
