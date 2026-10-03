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
let guardado = null   // { salao, em, dados }: só na memória, para atualizar a página trazer outra fala

export async function pedirMel(salaoId, { forcar = false } = {}) {
  if (!salaoId) return null
  if (isDemo) return demoMel()
  const tela = window.location.pathname
  if (!forcar && guardado && guardado.salao === salaoId && guardado.tela === tela && Date.now() - guardado.em < VALIDADE) return guardado.dados
  if (emVoo) return emVoo
  emVoo = (async () => {
    try {
      let tourFeito = false
      try { tourFeito = localStorage.getItem('mimo-tour-painel-concluido') === '1' } catch { /* nada */ }
      const dados = await chamar('mel', { salao: salaoId, tour_feito: tourFeito, tela })
      guardado = { salao: salaoId, tela, em: Date.now(), dados }
      try { localStorage.removeItem(CHAVE + '-erro') } catch { /* nada */ }
      if (!dados?.bubble) console.info('[mel] motor respondeu sem fala: nenhuma frase serviu para os momentos de agora', dados)
      return dados
    } catch (e) {
      // o erro fica visível no console e em localStorage (mimo-mel-v1-erro) para diagnosticar:
      // 404 = função não publicada (bat 9); "mel_contexto" na mensagem = migração 140 faltando (bat B)
      console.warn('[mel] motor indisponível:', e?.message || e)
      try { localStorage.setItem(CHAVE + '-erro', JSON.stringify({ em: Date.now(), erro: String(e?.message || e) })) } catch { /* nada */ }
      return null
    } finally { emVoo = null }
  })()
  return emVoo
}

// A fala direta (2.91): um momento que o app já sabe que está acontecendo
// (os passos do cadastro de serviço, cardapio_*). Não disputa prioridade
// com o motor; a função escolhe a frase na biblioteca e registra a exibição.
// Sem frase cadastrada vem null e a Mel não aparece naquele passo.
export async function falaDaMel(salaoId, momento, dados = {}) {
  if (!salaoId || !momento) return null
  try {
    if (isDemo) { const { data } = await supabase.rpc('mel_fala_direta', { momento, dados }); return data ?? null }
    const r = await chamar('mel', { salao: salaoId, momento, dados })
    return r?.bubble ?? null
  } catch (e) { console.info('[mel] fala direta indisponível:', e?.message || e); return null }
}

export function esquecerMel() {
  guardado = null
  try { localStorage.removeItem(CHAVE) } catch { /* nada */ }
}

// clicada | dispensada | concluida
export async function marcarMel(exibicao, evento, por = null) {
  if (!exibicao || isDemo) return
  try { await supabase.rpc('mel_marcar', { exibicao, evento, por }) } catch { /* telemetria não trava nada */ }
}

// ---- as ações semânticas → o que o app faz ----
// o mini guia do que falta (2.90): a chave que o motor devolve → rótulo e tela
export const PENDENCIAS = {
  servicos: { rotulo: 'Serviços', rota: '/admin/servicos' },
  equipe: { rotulo: 'Profissionais', rota: '/admin/equipe' },
  acesso_equipe: { rotulo: 'Acesso da equipe', rota: '/admin/equipe' },
  horarios: { rotulo: 'Horários', rota: '/admin/horarios' },
  agendamento: { rotulo: 'Agendamento de teste', rota: '/admin/agenda?encaixe=1' },
  avisos: { rotulo: 'Avisos no celular', rota: '/admin/ajustes' },
}

// o passo a passo de cada tela da configuração (2.90.1): instrução de
// interface, por isso vive aqui e não na biblioteca de frases
export const COMO_FAZER = {
  '/admin/servicos': { titulo: 'Como cadastrar um serviço', passos: ['Toque no + no canto da tela.', 'Dê um nome (ex.: Corte feminino) e escolha a categoria.', 'Informe a duração em minutos e o preço.', 'Salve. Repita para cada serviço; depois vem a equipe.'] },
  '/admin/equipe': { titulo: 'Como cadastrar uma profissional', passos: ['Toque em Adicionar profissional.', 'Nome completo e o WhatsApp dela: é por ele que ela ativa o acesso.', 'Marque os serviços que ela faz e os horários.', 'Salve e envie o acesso por e-mail ou WhatsApp.'] },
  '/admin/horarios': { titulo: 'Como definir os horários', passos: ['Ligue a chave de cada dia em que o salão abre.', 'Ajuste a hora de abrir e a de fechar.', 'Toque em Salvar horários.'] },
  '/admin/agenda': { titulo: 'Como fazer um agendamento de teste', passos: ['Toque no + da agenda.', 'Escolha a profissional, o serviço e um horário.', 'Use o seu nome como cliente: é só um teste.', 'Pronto: assim vai ficar o seu dia a dia.'] },
  '/admin/ajustes': { titulo: 'Como ligar os avisos no celular', passos: ['Procure "Avisos no celular" nesta tela.', 'Ligue a chave e aceite a permissão do navegador.', 'No iPhone, antes instale a MIMO na tela inicial.'] },
}

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
    guia_servicos: { texto: 'Você está em Serviços: cadastra o que faz, com nome, duração e preço. Ainda falta: serviços e profissionais.', tom: 'atenta', nivel: 'importante', categoria: 'configuracao', acao: null },
    configurar_servicos: { texto: 'Sem serviço cadastrado a agenda não abre. Vamos nessa?', tom: 'atenta', nivel: 'importante', categoria: 'configuracao', acao: { type: 'IR_CONFIGURAR', payload: { passo: 'servicos' } } },
    tour_pendente: { texto: 'Quer que eu te mostre o painel? Leva 1 minuto.', tom: 'feliz', nivel: 'dispensavel', categoria: 'configuracao', acao: { type: 'FAZER_TOUR', payload: {} } },
    configuracao_concluida: { texto: 'Salão montado! Agora é só deixar a agenda rodar.', tom: 'comemorando', nivel: 'dispensavel', categoria: 'configuracao', acao: null },
  }
  // no demo, na tela de serviços o guia da tela assume
  if (window.location.pathname === '/admin/servicos' && chave.startsWith('configurar')) chave = 'guia_servicos'
  const m = todos[chave] ?? todos.proxima_cliente_em_breve
  const pend = m.categoria === 'configuracao' && chave !== 'configuracao_concluida' ? ['servicos', 'equipe', 'agendamento'] : undefined
  return { bubble: { exibicao: 'demo', chave, ...m, pendencias: pend, avatar_key: `${clima}_${m.tom}` }, card: { exibicao: 'demo', chave: 'contexto_comum', texto: 'Céu cinza, mas a sua cliente vai sair daqui colorida.' }, clima: null }
}
