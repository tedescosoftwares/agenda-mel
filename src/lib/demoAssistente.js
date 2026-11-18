// A assistente do WhatsApp no modo demonstração (3.95): a personalidade fica no navegador, o número do salão "conecta"
// uns segundos depois do código, e o teste responde por um roteiro sem IA (no jeito escolhido). 3.95.1: sem o número
// do salão ela não liga, e desconectar desliga.
import { PADRAO, configDe, previa } from './assistente'

const CHAVE = 'mimo-demo-assistente'
const inicial = () => ({ config: { ...PADRAO }, recado: 'Atraso de mais de 15 minutos perde o horário. Aceitamos Pix e cartão.', ligada: false, numero_proprio: false, numero: '+55 (13) 99871-0002', conectado_em: null, pendente: null })
function ler() {
  try { const t = localStorage.getItem(CHAVE); if (t) return { ...inicial(), ...JSON.parse(t) } } catch { /* sem navegador */ }
  return inicial()
}
function gravar(e) { try { localStorage.setItem(CHAVE, JSON.stringify(e)) } catch { /* nada */ } }

const HORARIO = 'seg fechado; ter 09:00–19:00; qua 09:00–19:00; qui 09:00–19:00; sex 09:00–20:00; sáb 08:00–15:00; dom fechado'

export function assistenteDoSalaoDemo() {
  const e = ler()
  return {
    salao: 'Studio Mel', config: configDe(e.config), recado: e.recado, ligada: e.ligada, agente_global: true,
    canal: { tipo: e.numero_proprio ? 'evolution' : 'manual', ativo: true, numero_proprio: e.numero_proprio, numero: e.numero_proprio ? e.numero : null, conectado_em: e.conectado_em, casa: true },
    horario: HORARIO, aberto_agora: true,
    aceite: { modo: 'casa', minutos: 120, no_silencio: 'confirma' },
  }
}
export function assistenteSalvarDemo({ dados } = {}) {
  const e = ler()
  const d = dados ?? {}
  const c = { ...e.config }
  for (const k of Object.keys(PADRAO)) if (k in d) c[k] = d[k]
  if ('nome' in d) c.nome = String(d.nome ?? '').trim().slice(0, 30) || 'Mel'
  if ('recado' in d) e.recado = String(d.recado ?? '').slice(0, 1200)
  if ('ligada' in d && d.ligada && !e.numero_proprio) throw new Error('conecte o WhatsApp do salão antes de ligar a assistente')
  if ('ligada' in d) e.ligada = Boolean(d.ligada)
  e.config = c
  gravar(e)
  return assistenteDoSalaoDemo()
}
export const assistenteNumerosDemo = () => ({ dias: 30, conversas: 48, respostas: 131, marcou: 19, remarcou: 4, cancelou: 3, chamou: 6, encerrou: 2, falhas: 1, custo_usd: 0.41, por_dia: [] })

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export async function demoAssistente(corpo = {}) {
  const e = ler()
  await new Promise((r) => setTimeout(r, corpo.acao === 'testar' ? 700 : 400))
  if (corpo.acao === 'estado') {
    if (e.pendente && Date.now() - e.pendente.desde > 8000) {
      e.numero_proprio = true; e.numero = e.pendente.numero; e.conectado_em = new Date().toISOString(); e.pendente = null; gravar(e)
    }
    return { estado: e.numero_proprio ? 'open' : e.pendente ? 'connecting' : 'nao_existe', numero: e.numero_proprio ? e.numero : null }
  }
  if (corpo.acao === 'conectar') {
    const d = String(corpo.numero ?? '').replace(/\D/g, '')
    if (d.length < 10) throw new Error('confira o número: DDD e celular, só números (ex.: 13 99999-9999)')
    const cheio = d.length <= 11 ? '55' + d : d
    const bonito = `+55 (${cheio.slice(2, 4)}) ${cheio.slice(4, cheio.length - 4)}-${cheio.slice(-4)}`
    e.pendente = { desde: Date.now(), numero: bonito }; gravar(e)
    return { estado: 'connecting', numero: bonito, pairingCode: corpo.novo ? 'NOVO7Q4X' : 'MIMO2K95', qr: null }
  }
  if (corpo.acao === 'desconectar') {
    e.numero_proprio = false; e.conectado_em = null; e.pendente = null; e.ligada = false; gravar(e)
    return { ok: true }
  }
  if (corpo.acao === 'testar') {
    const cfg = configDe({ ...e.config, ...(corpo.rascunho?.assistente ?? {}) })
    const msgs = corpo.mensagens ?? []
    const ultima = semAcento(msgs[msgs.length - 1]?.texto)
    const cliente = corpo.rascunho?.cliente_nome || 'Ana'
    const roteiro = previa(cfg, { salao: 'Studio Mel', proprio: true, cliente })
    let resposta
    let acoes = { marcou: 0, remarcou: 0, cancelou: 0, chamou: 0, encerrou: 0 }
    if (/(idiota|burra|otaria|vagabunda|lixo|inutil|porra|caralho)/.test(ultima)) {
      resposta = 'Vou encerrar nosso atendimento por aqui. Se precisar de horário, é só chamar mais tarde.'; acoes = { ...acoes, encerrou: 1 }
    } else if (/(licao|dever de casa|politica|receita de|piada|futebol)/.test(ultima)) {
      resposta = 'Por aqui eu só consigo ajudar com horários e serviços do Studio Mel. Quer ver os horários livres?'
    } else if (/\b(sim|pode|confirm|isso)\b/.test(ultima) && msgs.length > 2) {
      if (cfg.pode_marcar) { resposta = 'Anotei o seu pedido: escova com a Carla amanhã às 10h. O salão confirma em breve e eu te aviso por aqui.'; acoes = { ...acoes, marcou: 1 } }
      else { resposta = 'Vou chamar alguém da equipe para confirmar com você, tá? Já já te respondem.'; acoes = { ...acoes, chamou: 1 } }
    } else if (/\b(\d{1,2}h|as \d|às \d)/.test(ultima) || /\d{1,2}:\d{2}/.test(ultima)) {
      resposta = roteiro[3].texto
    } else if (/(pessoa|atendente|humano|gente)/.test(ultima)) {
      resposta = 'Claro! Já chamei alguém do salão para falar com você.'; acoes = { ...acoes, chamou: 1 }
    } else if (/(endereco|onde fica|localiza)/.test(ultima)) {
      resposta = 'O Studio Mel fica na Rua das Flores, 120, no Gonzaga, em Santos. Quer marcar um horário?'
    } else if (/(preco|quanto|valor)/.test(ultima)) {
      resposta = { informa: 'A escova sai R$ 60 e o corte, R$ 80. Quer ver os horários?', a_partir: 'A escova é a partir de R$ 60; o valor final o salão confirma na hora. Quer ver os horários?', nao_fala: 'O valor certinho alguém do salão te passa. Quer que eu veja os horários livres?' }[cfg.preco]
    } else {
      resposta = roteiro[1].texto
    }
    return { ok: true, resposta, ferramentas: ['listar_servicos', 'horarios_livres'], acoes, provedor: 'demo', modelo: 'demo', ms: 700 }
  }
  throw new Error('ação desconhecida')
}
