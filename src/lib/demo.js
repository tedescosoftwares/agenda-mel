// Modo demonstração: o app inteiro rodando com dados fictícios, sem
// Supabase. Liga com VITE_DEMO=1 no build (ou ?demo=cliente na URL em
// dev). Serve para duas coisas: tirar print de qualquer tela sem banco,
// e mostrar o produto para alguém antes de existir conta.
//
// É uma IMITAÇÃO do cliente do Supabase: .from().select().eq()… e
// .rpc(). Cada tabela e cada função devolvem uma lista fixa. Escrita
// (insert/update) devolve sucesso e não guarda nada.
//
// Nunca entra num build de produção: o supabase.js só importa isto
// quando a variável está ligada, e o Vite descarta o resto.

const hoje = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
// dias espalhados pelo mês corrente (do dia 1 até hoje) e pelo anterior
const diaDoMes = (i) => {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const ate = hoje.getDate()
  const passo = Math.max(1, Math.floor(ate / 8))
  d.setDate(1 + ((i * passo) % Math.max(1, ate)))
  if (i >= 8) d.setMonth(d.getMonth() - 1)
  return iso(d)
}
const mais = (dias) => { const d = new Date(hoje); d.setDate(d.getDate() + dias); return iso(d) }

export const PAPEL = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('demo')
    if (q) localStorage.setItem('mimo-demo-papel', q)
    return localStorage.getItem('mimo-demo-papel') || 'cliente'
  } catch { return 'cliente' }
})()

const UID = { cliente: 'c1', profissional: 'p1', admin: 'a1' }[PAPEL] || 'c1'
const SALAO = 's1'

// foto fictícia: um retrato abstrato em SVG, para não depender de rede
const FOTO = (n) => {
  const tons = [['#ff7bb5', '#aa4cff'], ['#ffb27a', '#ff2d7a'], ['#b8a7f7', '#ff7baa'], ['#ffd27a', '#ff7bb5']]
  const [a, b] = tons[n % tons.length]
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs>
    <rect width='200' height='200' fill='url(#g)'/>
    <circle cx='100' cy='78' r='34' fill='rgba(255,255,255,.85)'/>
    <path d='M40 190c6-46 30-66 60-66s54 20 60 66z' fill='rgba(255,255,255,.85)'/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

const profissionais = [
  { id: 'pr1', user_id: 'p1', name: 'Ana Oliveira', slug: 'ana-oliveira', bio: 'Especialista em unhas decoradas e cuidados completos. Atendo com hora marcada, num cantinho tranquilo no Gonzaga — café, música baixa e capricho em cada detalhe.', especialidade: 'Nail designer · gel e decoradas', instagram: 'ana.oliveira.nails', whatsapp_publico: '5513998710002', photo_url: FOTO(47), active: true, salon_id: SALAO, aceite_manual: true, minutos_para_aceitar: 120, ao_expirar: 'confirma', buffer_minutes: 0, reminder_hours_before: 24, followup_active: true, winback_after_days: 45, winback_cooldown_days: 45, no_show_tolerance_minutes: 15, phone: '(13) 99871-0002' },
  { id: 'pr2', user_id: 'p2', name: 'Camila Rocha', slug: 'camila-rocha', bio: 'Cabeleireira e colorista.', photo_url: FOTO(32), active: true, salon_id: SALAO, aceite_manual: true, minutos_para_aceitar: 120, ao_expirar: 'confirma' },
  { id: 'pr3', user_id: 'p3', name: 'Fernanda Lima', slug: 'fernanda-lima', bio: 'Esteticista facial e corporal.', photo_url: FOTO(44), active: true, salon_id: SALAO, aceite_manual: false },
  { id: 'pr4', user_id: 'p4', name: 'Roberta Souza', slug: 'roberta-souza', bio: 'Maquiagem e sobrancelhas.', photo_url: FOTO(20), active: true, salon_id: SALAO, aceite_manual: true },
]

const servicos = [
  { id: 'sv1', name: 'Manicure', description: 'Cutilagem, lixamento e esmaltação.', duration_minutes: 45, price: 35, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 15 },
  { id: 'sv2', name: 'Manicure + Pedicure', description: 'O combo completo.', duration_minutes: 90, price: 85, active: true, images: [], salon_id: SALAO, is_combo: true, combo_service_ids: ['sv1', 'sv3'], return_days: 15 },
  { id: 'sv3', name: 'Pedicure', description: '', duration_minutes: 45, price: 40, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 20 },
  { id: 'sv4', name: 'Spa dos pés', description: 'Hidratação profunda e massagem.', duration_minutes: 60, price: 65, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 30 },
  { id: 'sv5', name: 'Esmaltação em gel', description: 'Dura até 3 semanas.', duration_minutes: 60, price: 75, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 21 },
  { id: 'sv6', name: 'Corte feminino', description: '', duration_minutes: 60, price: 80, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 45 },
  { id: 'sv7', name: 'Escova', description: '', duration_minutes: 45, price: 60, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 10 },
  { id: 'sv8', name: 'Design de sobrancelhas', description: '', duration_minutes: 30, price: 45, active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 20 },
]

const vinculos = [
  ['pr1', 'sv1'], ['pr1', 'sv2'], ['pr1', 'sv3'], ['pr1', 'sv4'], ['pr1', 'sv5'],
  ['pr2', 'sv6'], ['pr2', 'sv7'], ['pr3', 'sv4'], ['pr4', 'sv8'],
].map(([professional_id, service_id]) => ({ professional_id, service_id }))

const clientes = [
  { id: 'c1', full_name: 'Juliana Silva', phone: '(11) 98790-0115', role: 'cliente', accepts_reminders: true, referral_code: 'JULIANA10', created_at: '2025-01-10' },
  { id: 'c2', full_name: 'Carla Mendes', phone: '(13) 99999-0002', role: 'cliente', accepts_reminders: true, created_at: '2025-02-01' },
  { id: 'c3', full_name: 'Mariana Souza', phone: '(13) 99999-0003', role: 'cliente', accepts_reminders: false, created_at: '2025-03-05' },
  { id: 'c4', full_name: 'Beatriz Costa', phone: '(13) 99999-0004', role: 'cliente', accepts_reminders: true, created_at: '2025-03-20' },
  { id: 'p1', full_name: 'Ana Oliveira', phone: '(13) 99871-0002', role: 'profissional', accepts_reminders: true, created_at: '2024-12-01' },
  { id: 'a1', full_name: 'Mel Tedesco', phone: '(13) 99120-3410', role: 'admin', accepts_reminders: true, created_at: '2024-11-01' },
]

const jn = (a, todos) => ({ ...a, services: servicos.find((s) => s.id === a.service_id), professionals: profissionais.find((p) => p.id === a.professional_id), profiles: clientes.find((c) => c.id === a.client_id), appointment_offers: [], origem: a.remarca_de ? (todos.find((o) => o.id === a.remarca_de) ?? null) : null })

const agendamentos = [
  { id: 'ap1', client_id: 'c1', professional_id: 'pr1', service_id: 'sv2', salon_id: SALAO, date: mais(2), start_time: '14:00:00', end_time: '15:30:00', status: 'pendente', price_cents: 8500, created_at: mais(0) },
  { id: 'ap2', client_id: 'c1', professional_id: 'pr2', service_id: 'sv7', salon_id: SALAO, date: mais(9), start_time: '10:30:00', end_time: '11:15:00', status: 'confirmado', price_cents: 6000, created_at: mais(-1) },
  { id: 'ap3', client_id: 'c1', professional_id: 'pr1', service_id: 'sv1', salon_id: SALAO, date: mais(-12), start_time: '09:00:00', end_time: '09:45:00', status: 'concluido', price_cents: 3500, created_at: mais(-14) },
  { id: 'ap4', client_id: 'c1', professional_id: 'pr3', service_id: 'sv4', salon_id: SALAO, date: mais(-30), start_time: '16:00:00', end_time: '17:00:00', status: 'concluido', price_cents: 6500, created_at: mais(-33) },
  { id: 'ap5', client_id: 'c2', professional_id: 'pr1', service_id: 'sv1', salon_id: SALAO, date: mais(0), start_time: '09:00:00', end_time: '09:45:00', status: 'confirmado', price_cents: 3500, created_at: mais(-2) },
  { id: 'ap6', client_id: 'c3', professional_id: 'pr1', service_id: 'sv5', salon_id: SALAO, date: mais(0), start_time: '10:30:00', end_time: '11:30:00', status: 'confirmado', price_cents: 7500, created_at: mais(-2) },
  { id: 'ap7', client_id: 'c4', professional_id: 'pr1', service_id: 'sv2', salon_id: SALAO, date: mais(0), start_time: '14:00:00', end_time: '15:30:00', status: 'pendente', price_cents: 8500, created_at: mais(0) },
  { id: 'ap8', client_id: 'c2', professional_id: 'pr1', service_id: 'sv4', salon_id: SALAO, date: mais(0), start_time: '16:30:00', end_time: '17:30:00', status: 'confirmado', price_cents: 6500, created_at: mais(-1) },
  // pedido de troca aberto: a cliente quer mudar o ap2 para outro dia
  { id: 'ap9', client_id: 'c1', professional_id: 'pr2', service_id: 'sv7', salon_id: SALAO, date: mais(11), start_time: '15:00:00', end_time: '15:45:00', status: 'pendente', price_cents: 6000, created_at: mais(0), remarca_de: 'ap2' },
].concat(
  Array.from({ length: 16 }, (_, i) => ({
    id: 'h' + i, client_id: ['c2', 'c3', 'c4', 'c1'][i % 4], professional_id: 'pr1', service_id: ['sv1', 'sv2', 'sv5', 'sv4'][i % 4],
    salon_id: SALAO, date: diaDoMes(i), start_time: ['09:00:00', '10:30:00', '14:00:00', '16:00:00'][i % 4],
    end_time: '11:00:00', status: i === 5 ? 'faltou' : 'concluido', price_cents: [3500, 8500, 7500, 6500][i % 4], created_at: mais(-(i * 2 + 3)),
  })),
).map((a, _i, todos) => jn(a, todos))

const avisos = [
  { id: 'n1', user_id: UID, kind: 'agendamento_confirmado', title: 'Agendamento confirmado', body: 'Corte feminino · ' + mais(9) + ' às 10:30', created_at: new Date(Date.now() - 3600e3).toISOString(), read_at: null },
  { id: 'n2', user_id: UID, kind: 'lembrete_agendamento', title: 'Lembrete', body: 'Seu horário é amanhã às 14:00.', created_at: new Date(Date.now() - 86400e3).toISOString(), read_at: null },
  { id: 'n3', user_id: UID, kind: 'vaga_disponivel', title: 'Abriu uma vaga', body: 'Ana Oliveira tem horário livre dia ' + mais(1) + ' às 15:00.', created_at: new Date(Date.now() - 2 * 86400e3).toISOString(), read_at: new Date().toISOString() },
  { id: 'n4', user_id: UID, kind: 'indicacao_creditada', title: 'Novidade', body: 'Indique amigas e ganhe créditos.', created_at: new Date(Date.now() - 4 * 86400e3).toISOString(), read_at: new Date().toISOString() },
]

const fila = [
  { id: 'w1', client_id: 'c1', professional_id: 'pr1', service_id: 'sv5', date_from: mais(0), date_to: mais(7), window_start: '15:00:00', window_end: '18:00:00', status: 'aguardando', created_at: mais(-1), services: servicos[4], professionals: profissionais[0] },
]

const avaliacoes = [
  { nota: 5, comentario: 'Atendimento impecável, saí renovada!', quem: 'Carla', quando: mais(-3) },
  { nota: 5, comentario: 'Super atenciosa e caprichosa.', quem: 'Mariana', quando: mais(-9) },
  { nota: 4, comentario: 'Ficou lindo, só atrasou um pouquinho.', quem: 'Beatriz', quando: mais(-20) },
]

const TABELAS = {
  profiles: clientes,
  professionals: profissionais,
  services: servicos,
  professional_services: vinculos.map((v) => ({ ...v, services: servicos.find((s) => s.id === v.service_id) })),
  professional_hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ professional_id: 'pr1', weekday, open: weekday !== 6 || true, start_time: '09:00:00', end_time: weekday === 6 ? '14:00:00' : '18:00:00' })).concat([{ professional_id: 'pr1', weekday: 0, open: false, start_time: '09:00:00', end_time: '18:00:00' }]),
  professional_blocks: [{ id: 'b1', professional_id: 'pr1', kind: 'semanal', weekday: 1, all_day: false, start_time: '13:00:00', end_time: '14:00:00', reason: 'Almoço' }],
  business_hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ salon_id: SALAO, weekday, open: true, start_time: '09:00:00', end_time: '18:00:00' })),
  appointments: agendamentos,
  waitlist_entries: fila,
  waitlist_offers: [],
  notifications: avisos,
  credit_transactions: [
    { id: 't1', client_id: 'c1', amount_cents: 2000, kind: 'indicacao', description: 'Carla agendou pela sua indicação', created_at: mais(-5) },
    { id: 't2', client_id: 'c1', amount_cents: 1000, kind: 'boas_vindas', description: 'Crédito de boas-vindas', created_at: mais(-40) },
  ],
  client_favorites: [{ client_id: 'c1', professional_id: 'pr1' }, { client_id: 'c1', professional_id: 'pr3' }],
  reviews: [],
  salons: [{ id: SALAO, name: 'Studio Mel', slug: 'studio-mel', app_url: 'https://mimo.app', city: 'Santos', address: 'Rua das Flores, 120 · Gonzaga' }],
  salon_members: [{ salon_id: SALAO, user_id: 'a1', papel: 'admin', salons: { id: SALAO, name: 'Studio Mel', slug: 'studio-mel' } }],
  whatsapp_channels: [{ salon_id: SALAO, canal: 'evolution', identificador: '11', ativo: true, usa_ia: true, usa_bot: true, silencio_inicio: '21:00', silencio_fim: '08:00', teto_diario: 300 }],
  affiliate_settings: [{ id: true, ativo: true, platform_fee_bps: 300, affiliate_share_bps: 50 }],
  message_outbox: [],
}

const RPC = {
  saldo_creditos: () => 3000,
  horarios_livres: () => ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '16:00', '17:00'].map((hora) => ({ hora })),
  dias_com_vaga: () => [mais(1), mais(2), mais(3)].map((dia) => ({ dia, vagas: 6 })),
  avaliacao_da_profissional: () => [{ media: 4.9, quantas: 128 }],
  avaliacoes_da_profissional: () => avaliacoes,
  posicao_na_fila: () => [{ posicao: 3, na_frente: 2, previsao: 'entre 15:00 e 18:00, até ' + mais(7).slice(8, 10) + '/' + mais(7).slice(5, 7) }],
  meu_resumo_indicacoes: () => [{ codigo: 'JULIANA10', premio_indicou_cents: 2000, premio_indicada_cents: 1000, indicadas: 3, creditado_cents: 3000 }],
  meu_resumo_afiliada: () => [],
  minhas_profissionais_indicadas: () => [],
  meus_pedidos: () => agendamentos.filter((a) => a.status === 'pendente' && a.professional_id === 'pr1').map((a) => ({ appointment_id: a.id, cliente: a.profiles?.full_name, servico: a.services?.name, quando: 'Qui, 16/05 às ' + a.start_time.slice(0, 5), faltam_min: 87, remarcacao: false, antes: null }))
    .concat([{ appointment_id: 'ap9', cliente: 'Juliana Prado', servico: 'Esmaltação em gel', quando: 'Sáb, 25/05 às 15:00', faltam_min: 41, remarcacao: true, antes: 'Qui, 23/05 às 10:30' }]),
  pedir_remarcacao: () => ({ ok: true, appointment_id: 'ap9', pendente: true, minutos: 120 }),
  vitrine_da_profissional: ({ link }) => {
    const p = profissionais.find((x) => x.slug === link)
    if (!p) return null
    return {
      profissional: { id: p.id, name: p.name, slug: p.slug, bio: p.bio, photo_url: p.photo_url, especialidade: p.especialidade ?? null, instagram: p.instagram ?? null, whatsapp: p.whatsapp_publico ?? null, aceite_manual: p.aceite_manual },
      salao: { name: 'Studio Mel', city: 'Santos', address: 'Rua das Flores, 120 · Gonzaga', app_url: 'https://mimo.app' },
      nota: { media: 4.9, quantas: 128 },
      avaliacoes: avaliacoes.concat(avaliacoes),
      galeria: [FOTO(3), FOTO(11), FOTO(25), FOTO(38), FOTO(52)],
      horarios: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: weekday !== 0, inicio: '09:00', fim: weekday === 6 ? '14:00' : '18:00' })),
      atendimentos: 412,
      proxima_vaga: { dia: mais(1), hora: '14:00' },
    }
  },
  quantas_para_enviar: () => 0,
  config_agenda_profissional: () => [{ no_show_tolerance_minutes: 15 }],
  resumo_do_mes: () => [{ atendimentos: 128, faturamento_cents: 984000, faturamento_mes_anterior_cents: 871000, clientes: 64, ticket_medio_cents: 7687, ocupacao_bps: 8200, minutos_ocupados: 7680, minutos_disponiveis: 9360, faltas: 3, taxa_falta_bps: 230, clientes_novas: 12, descontos_cents: 9000 }],
  faturamento_por_servico: () => [{ servico: 'Manicure + Pedicure', faturamento_cents: 425000, quantos: 50 }, { servico: 'Esmaltação em gel', faturamento_cents: 300000, quantos: 40 }, { servico: 'Spa dos pés', faturamento_cents: 259000, quantos: 38 }],
  melhores_clientes: () => [{ cliente: 'Carla Mendes', quantos: 9, total_cents: 61000 }, { cliente: 'Mariana Souza', quantos: 7, total_cents: 48000 }],
  clientes_para_retorno: () => [{ client_id: 'c2', nome: 'Juliana Silva', dias_sem_vir: 52, ultimo_servico: 'Manicure', ja_chamada: false }, { client_id: 'c3', nome: 'Carla Mendes', dias_sem_vir: 61, ultimo_servico: 'Escova', ja_chamada: false }, { client_id: 'c4', nome: 'Mariana Souza', dias_sem_vir: 48, ultimo_servico: 'Spa dos pés', ja_chamada: true }],
  config_retorno: () => [{ winback_after_days: 45, winback_cooldown_days: 45, followup_active: true, reminder_hours_before: 24 }],
  resumo_do_salao: () => profissionais.map((p, i) => ({ professional_id: p.id, nome: p.name, atendimentos: [48, 36, 28, 16][i], faturamento_cents: [384000, 288000, 196000, 116000][i], faltas: [1, 2, 0, 0][i], ocupacao_bps: [8200, 7100, 6400, 4300][i] })),
  diagnostico_whatsapp: () => [{ item: 'Canal', situacao: 'ok', detalhe: 'Evolution, instância 11' }, { item: 'Número', situacao: 'ok', detalhe: '+55 13 99171-9086' }, { item: 'IA', situacao: 'ok', detalhe: 'ligada · 12 chamadas hoje' }],
  fila_do_salao: () => [],
  leituras_recentes: () => [{ telefone: '5511987900115', texto: 'quero marcar um horário', via: 'ia', intencao_ia: 'agendar', acao: 'bot:perguntou', recebido_em: new Date().toISOString() }],
  fila_para_enviar: () => [],
  marcar_avisos_lidos: () => null,
  avancar_ofertas_expiradas: () => 0,
  enviar_lembretes: () => 0,
  resumo_da_ia: () => [{ hoje: 12, teto: 200 }],
}

function consulta(linhas) {
  let dados = [...linhas]
  const filtros = []
  let ordem = null
  let limite = null
  let unico = false
  const q = {
    select: (_c, o) => { if (o?.head) q._head = true; if (o?.count) q._count = true; return q },
    eq: (c, v) => { filtros.push((r) => r[c] === v); return q },
    neq: (c, v) => { filtros.push((r) => r[c] !== v); return q },
    gte: (c, v) => { filtros.push((r) => r[c] >= v); return q },
    gt: (c, v) => { filtros.push((r) => r[c] > v); return q },
    lt: (c, v) => { filtros.push((r) => r[c] < v); return q },
    in: (c, v) => { filtros.push((r) => v.includes(r[c])); return q },
    not: () => q,
    or: () => q,
    ilike: (c, v) => { const t = String(v).replace(/%/g, '').toLowerCase(); filtros.push((r) => String(r[c] ?? '').toLowerCase().includes(t)); return q },
    order: (c, o) => { ordem = [c, o?.ascending === false ? -1 : 1]; return q },
    limit: (n) => { limite = n; return q },
    maybeSingle: () => { unico = true; return q },
    single: () => { unico = true; return q },
    insert: () => q,
    update: () => q,
    upsert: () => q,
    delete: () => q,
    then: (ok) => {
      let r = dados.filter((x) => filtros.every((f) => f(x)))
      if (ordem) r.sort((a, b) => (a[ordem[0]] > b[ordem[0]] ? 1 : a[ordem[0]] < b[ordem[0]] ? -1 : 0) * ordem[1])
      if (limite) r = r.slice(0, limite)
      const count = r.length
      if (q._head) return ok({ data: null, error: null, count })
      return ok({ data: unico ? (r[0] ?? null) : r, error: null, count })
    },
  }
  return q
}

const sessao = PAPEL === 'sair' ? null : { user: { id: UID, email: PAPEL + '@mimo.demo' }, access_token: 'demo' }

export const demo = {
  auth: {
    getSession: async () => ({ data: { session: sessao } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => { try { localStorage.removeItem('mimo-demo-papel') } catch {} ; window.location.href = '/login'; return {} },
    resetPasswordForEmail: async () => ({ error: null }),
  },
  from: (t) => consulta(TABELAS[t] ?? []),
  rpc: async (nome, args) => {
    const f = RPC[nome]
    // função que não está na lista é escrita (aceitar, encaixar, chamar…):
    // no demo ela "dá certo" e não guarda nada
    return { data: f ? f(args) : null, error: null }
  },
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: p } }), remove: async () => ({}) }) },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel: () => {},
}
