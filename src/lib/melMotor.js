// A Mel no app (2.88): pede ao motor (Edge Function `mel`) o que ela fala
// agora, guarda por alguns minutos, registra clique e dispensa, e executa
// as ações semânticas que o motor oferece. O motor não conhece rotas: é
// aqui que DIVULGAR_VAGA vira compartilhar e ABRIR_AGENDA vira navegação.
import { supabase, isDemo } from './supabase'
import { chamar } from './pagamento'
import { linkDoSalao } from './endereco'

const CHAVE = 'mimo-mel-v1'
const VALIDADE = 3 * 60e3
let emVoo = null   // uma chamada por vez: MelDock e ClimaTopo dividem a resposta

export async function pedirMel(salaoId, { forcar = false } = {}) {
  if (!salaoId) return null
  if (isDemo) return demoMel()
  if (!forcar) {
    try {
      const g = JSON.parse(localStorage.getItem(CHAVE) || 'null')
      if (g && g.salao === salaoId && Date.now() - g.em < VALIDADE) return g.dados
    } catch { /* nada */ }
  }
  if (emVoo) return emVoo
  emVoo = (async () => {
    try {
      let tourFeito = false
      try { tourFeito = localStorage.getItem('mimo-tour-painel-concluido') === '1' } catch { /* nada */ }
      const dados = await chamar('mel', { salao: salaoId, tour_feito: tourFeito })
      try { localStorage.setItem(CHAVE, JSON.stringify({ salao: salaoId, em: Date.now(), dados })) } catch { /* nada */ }
      return dados
    } catch { return null } finally { emVoo = null }
  })()
  return emVoo
}

export function esquecerMel() {
  try { localStorage.removeItem(CHAVE) } catch { /* nada */ }
}

// clicada | dispensada | concluida
export async function marcarMel(exibicao, evento, por = null) {
  if (!exibicao || isDemo) return
  try { await supabase.rpc('mel_marcar', { exibicao, evento, por }) } catch { /* telemetria não trava nada */ }
}

// ---- as ações semânticas → o que o app faz ----
export const ROTULO_ACAO = {
  VER_PEDIDOS: 'Ver pedidos', ABRIR_AGENDA: 'Abrir agenda', VER_AMANHA: 'Ver amanhã', DIVULGAR_VAGA: 'Divulgar horário',
  OFERTAR_VAGA_LISTA: 'Oferecer à lista de espera', PEDIR_CONFIRMACAO: 'Confirmar horários', ENCAIXAR: 'Encaixar',
  FECHAR_DIA: 'Fechar o dia', VER_FILA_WHATSAPP: 'Ver mensagens', CRIAR_PROMOCAO: 'Criar promoção', VER_PLANO: 'Ver plano',
  IR_CONFIGURAR: 'Continuar configuração', LIGAR_AVISOS: 'Ligar avisos', FAZER_TOUR: 'Fazer o tour',
}

export function rotaDaAcao(acao) {
  const p = acao?.payload ?? {}
  switch (acao?.type) {
    case 'VER_PEDIDOS': return '/admin/agenda?pendentes=1'
    case 'ABRIR_AGENDA': return p.dia ? `/admin/agenda?dia=${p.dia}` : '/admin/agenda'
    case 'VER_AMANHA': return `/admin/agenda?dia=${p.dia ?? ''}`
    case 'ENCAIXAR': return '/admin/agenda?encaixe=1'
    case 'FECHAR_DIA': return '/admin/fechar-dia'
    case 'VER_FILA_WHATSAPP': return '/admin/whatsapp'
    case 'CRIAR_PROMOCAO': return '/admin/promocoes?nova=1'
    case 'VER_PLANO': return '/admin/assinatura'
    case 'IR_CONFIGURAR': return p.passo === 'servicos' ? '/admin/servicos' : p.passo === 'equipe' ? '/admin/equipe' : '/admin/configurar'
    case 'LIGAR_AVISOS': return '/admin/ajustes'
    default: return null
  }
}

const dataBr = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : '')
const horaBr = (h) => (h ? String(h).slice(0, 5).replace(':00', 'h').replace(':', 'h') : '')

// executa a ação; devolve { navegar, mensagem, concluida }
export async function executarAcao(acao, { exibicao, salao, salaoId }) {
  const p = acao?.payload ?? {}
  await marcarMel(exibicao, 'clicada')
  switch (acao?.type) {
    case 'DIVULGAR_VAGA': {
      const link = linkDoSalao(salao)
      const quando = p.dia ? (p.dia === new Date().toISOString().slice(0, 10) ? 'hoje' : dataBr(p.dia)) : 'hoje'
      const texto = p.hora
        ? `Abriu um horário ${quando} às ${horaBr(p.hora)} no ${salao?.name ?? 'salão'}! Garanta o seu: ${link}`
        : `Tem horário livre ${quando} no ${salao?.name ?? 'salão'}! Agende pelo link: ${link}`
      let feito = false
      if (navigator.share) { try { await navigator.share({ text: texto }); feito = true } catch { feito = false } }
      else { window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener'); feito = true }
      if (feito) await marcarMel(exibicao, 'concluida', 'compartilhou')
      return { concluida: feito, mensagem: feito ? 'Pronto, texto com o link enviado.' : null }
    }
    case 'OFERTAR_VAGA_LISTA': {
      if (isDemo) return { concluida: true, mensagem: 'Oferta enviada para a lista de espera (demo).' }
      const { data, error } = await supabase.rpc('mel_ofertar_vaga', { prof: p.prof, dia: p.dia, inicio: p.inicio, fim: p.fim, exibicao })
      if (error) return { concluida: false, mensagem: error.message }
      return data?.ok ? { concluida: true, mensagem: 'Oferta enviada para quem está na lista de espera.' } : { concluida: false, mensagem: 'Ninguém da lista de espera cabe nessa vaga agora.', navegar: '/admin/agenda' }
    }
    case 'PEDIR_CONFIRMACAO': {
      if (isDemo) return { concluida: true, mensagem: 'Lembretes enviados (demo).' }
      const { data, error } = await supabase.rpc('mel_pedir_confirmacao', { salao: salaoId, dia: p.dia, desde: p.desde ?? null, exibicao })
      if (error) return { concluida: false, mensagem: error.message }
      const n = data?.enviadas ?? 0
      return { concluida: n > 0, mensagem: n > 0 ? `Lembrete pedindo confirmação enviado para ${n} ${n === 1 ? 'cliente' : 'clientes'}.` : 'Todo mundo desse dia já recebeu o lembrete.' }
    }
    case 'FAZER_TOUR': {
      // o tour mora na home; se já está nela, abre na hora
      if (window.location.pathname === '/admin') { window.dispatchEvent(new Event('mimo:abrir-tour-painel')); return { concluida: false } }
      return { concluida: false, navegar: '/admin?tour=1' }
    }
    default:
      return { concluida: false, navegar: rotaDaAcao(acao) }
  }
}

// ---- demo: um momento por vez, escolhido em localStorage mimo-demo-mel ----
function demoMel() {
  let chave = 'proxima_cliente_em_breve'
  try { chave = localStorage.getItem('mimo-demo-mel') || chave } catch { /* nada */ }
  let clima = 'ensolarado'
  try { clima = localStorage.getItem('mimo-demo-clima') || clima } catch { /* nada */ }
  const todos = {
    primeiro_contato: { texto: 'Oi, Mel! Eu sou a Mel. Vou comentar o dia por aqui.', tom: 'feliz', nivel: 'dispensavel', categoria: 'geral', acao: null },
    proxima_cliente_em_breve: { texto: 'Carla chega às 14h30. Dá tempo de um café.', tom: 'atenta', nivel: 'importante', categoria: 'agenda', acao: { type: 'ABRIR_AGENDA', payload: { dia: new Date().toISOString().slice(0, 10) } } },
    pedido_esperando_aceite: { texto: 'Dois pedidos esperando resposta na agenda.', tom: 'alerta', nivel: 'reforco', categoria: 'operacional', acao: { type: 'VER_PEDIDOS', payload: { ids: [] } } },
    vaga_hoje: { texto: 'Liberou 15h30. Quer colocar essa vaga pra jogo?', tom: 'feliz', nivel: 'dispensavel', categoria: 'oportunidade', acao: { type: 'DIVULGAR_VAGA', payload: { dia: new Date().toISOString().slice(0, 10), hora: '15:30' } } },
    chuva_antes_dos_horarios: { texto: 'Chuva chegando às 18h. Eu confirmaria as duas últimas.', tom: 'alerta', nivel: 'importante', categoria: 'clima', acao: { type: 'PEDIR_CONFIRMACAO', payload: { dia: new Date().toISOString().slice(0, 10), desde: '18:00' } } },
    dia_fechado: { texto: 'Sete atendidas hoje. Dia encerrado.', tom: 'comemorando', nivel: 'dispensavel', categoria: 'marco', acao: { type: 'VER_AMANHA', payload: { dia: new Date(Date.now() + 864e5).toISOString().slice(0, 10) } } },
    calor_extremo: { texto: '35 graus e secador ligado. Você é forte.', tom: 'cansada', nivel: 'dispensavel', categoria: 'clima', acao: null },
    contexto_comum: { texto: 'Sexta à tarde e a agenda andando.', tom: 'feliz', nivel: 'dispensavel', categoria: 'clima', acao: null },
    configurar_servicos: { texto: 'Sem serviço cadastrado a agenda não abre. Vamos nessa?', tom: 'atenta', nivel: 'importante', categoria: 'configuracao', acao: { type: 'IR_CONFIGURAR', payload: { passo: 'servicos' } } },
    tour_pendente: { texto: 'Quer que eu te mostre o painel? Leva 1 minuto.', tom: 'feliz', nivel: 'dispensavel', categoria: 'configuracao', acao: { type: 'FAZER_TOUR', payload: {} } },
    configuracao_concluida: { texto: 'Salão montado! Agora é só deixar a agenda rodar.', tom: 'comemorando', nivel: 'dispensavel', categoria: 'configuracao', acao: null },
  }
  const m = todos[chave] ?? todos.proxima_cliente_em_breve
  return { bubble: { exibicao: 'demo', chave, ...m, avatar_key: `${clima}_${m.tom}` }, card: { exibicao: 'demo', chave: 'contexto_comum', texto: 'Céu cinza, mas a sua cliente vai sair daqui colorida.' }, clima: null }
}
