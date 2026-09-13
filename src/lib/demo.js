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

const UID = { cliente: 'c1', profissional: 'p1', admin: 'a1', plataforma: 'pl1' }[PAPEL] || 'c1'
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
  { id: 'pr1', user_id: 'p1', codigo: 'ANA7K2', name: 'Ana Oliveira', slug: 'ana-oliveira', bio: 'Especialista em unhas decoradas e cuidados completos. Atendo com hora marcada, num cantinho tranquilo no Gonzaga — café, música baixa e capricho em cada detalhe.', especialidade: 'Nail designer · gel e decoradas', instagram: 'ana.oliveira.nails', whatsapp_publico: '5513998710002', photo_url: FOTO(47), active: true, salon_id: SALAO, aceite_manual: true, minutos_para_aceitar: 120, ao_expirar: 'confirma', buffer_minutes: 0, reminder_hours_before: 24, followup_active: true, winback_after_days: 45, winback_cooldown_days: 45, no_show_tolerance_minutes: 15, phone: '(13) 99871-0002' },
  { id: 'pr2', user_id: 'p2', codigo: 'CAM3XR', name: 'Camila Rocha', slug: 'camila-rocha', bio: 'Cabeleireira e colorista.', photo_url: FOTO(32), active: true, salon_id: SALAO, aceite_manual: true, minutos_para_aceitar: 120, ao_expirar: 'confirma' },
  { id: 'pr3', user_id: 'p3', name: 'Fernanda Lima', slug: 'fernanda-lima', bio: 'Esteticista facial e corporal.', photo_url: FOTO(44), active: true, salon_id: SALAO, aceite_manual: false },
  { id: 'pr4', user_id: 'p4', name: 'Roberta Souza', slug: 'roberta-souza', bio: 'Maquiagem e sobrancelhas.', photo_url: FOTO(20), active: true, salon_id: SALAO, aceite_manual: true },
]

const CATS = [
  { id: 'ct1', salon_id: null, nome: 'Cabelo', ordem: 10 }, { id: 'ct2', salon_id: null, nome: 'Unhas', ordem: 20 },
  { id: 'ct3', salon_id: null, nome: 'Sobrancelhas e cílios', ordem: 30 }, { id: 'ct4', salon_id: null, nome: 'Rosto', ordem: 40 },
  { id: 'ct5', salon_id: null, nome: 'Corpo', ordem: 50 }, { id: 'ct6', salon_id: null, nome: 'Depilação', ordem: 60 },
  { id: 'ct7', salon_id: null, nome: 'Maquiagem', ordem: 70 }, { id: 'ct8', salon_id: null, nome: 'Massagem e bem-estar', ordem: 80 },
  { id: 'ct9', salon_id: null, nome: 'Barba', ordem: 90 }, { id: 'ct10', salon_id: null, nome: 'Outros', ordem: 999 },
  { id: 'ct11', salon_id: SALAO, nome: 'Noivas', ordem: 500 },
]
const servicos = [
  { id: 'sv1', name: 'Manicure', description: 'Cutilagem, lixamento e esmaltação.', duration_minutes: 45, price: 35, categoria_id: 'ct2', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 15 },
  { id: 'sv2', name: 'Manicure + Pedicure', description: 'O combo completo.', duration_minutes: 90, price: 85, categoria_id: 'ct2', active: true, images: [], salon_id: SALAO, is_combo: true, combo_service_ids: ['sv1', 'sv3'], return_days: 15 },
  { id: 'sv3', name: 'Pedicure', description: '', duration_minutes: 45, price: 40, categoria_id: 'ct2', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 20 },
  { id: 'sv4', name: 'Spa dos pés', description: 'Hidratação profunda e massagem.', duration_minutes: 60, price: 65, categoria_id: 'ct2', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 30 },
  { id: 'sv5', name: 'Esmaltação em gel', description: 'Dura até 3 semanas.', duration_minutes: 60, price: 75, categoria_id: 'ct2', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 21 },
  { id: 'sv6', name: 'Corte feminino', description: '', duration_minutes: 60, price: 80, categoria_id: 'ct1', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 45 },
  { id: 'sv7', name: 'Escova', description: '', duration_minutes: 45, price: 60, categoria_id: 'ct1', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 10 },
  { id: 'sv8', name: 'Design de sobrancelhas', description: '', duration_minutes: 30, price: 45, categoria_id: 'ct3', active: true, images: [], salon_id: SALAO, is_combo: false, return_days: 20 },
]

const vinculos = [
  ['pr1', 'sv1'], ['pr1', 'sv2'], ['pr1', 'sv3'], ['pr1', 'sv4'], ['pr1', 'sv5'],
  ['pr2', 'sv6'], ['pr2', 'sv7'], ['pr3', 'sv4'], ['pr4', 'sv8'],
].map(([professional_id, service_id]) => ({ professional_id, service_id }))

const clientes = [
  { id: 'c1', full_name: 'Juliana Silva', phone: '(11) 98790-0115', role: 'cliente', accepts_reminders: true, referral_code: 'JULIANA10', nascimento: '1994-08-23', created_at: '2025-01-10', primeiro_acesso_em: '2025-01-10', aceitou_termos_em: '2025-01-10', termos_versao: '2026-09-10' },
  { id: 'c2', full_name: 'Carla Mendes', phone: '(13) 99999-0002', role: 'cliente', accepts_reminders: true, created_at: '2025-02-01' },
  { id: 'c3', full_name: 'Mariana Souza', phone: '(13) 99999-0003', role: 'cliente', accepts_reminders: false, created_at: '2025-03-05' },
  { id: 'c4', full_name: 'Beatriz Costa', phone: '(13) 99999-0004', role: 'cliente', accepts_reminders: true, created_at: '2025-03-20' },
  { id: 'p1', full_name: 'Ana Oliveira', phone: '(13) 99871-0002', role: 'profissional', accepts_reminders: true, created_at: '2024-12-01', primeiro_acesso_em: '2024-11-01', aceitou_termos_em: '2024-11-01', termos_versao: '2026-09-10' },
  { id: 'a1', full_name: 'Mel Tedesco', phone: '(13) 99120-3410', role: 'admin', accepts_reminders: true, created_at: '2024-11-01', primeiro_acesso_em: '2024-11-01', aceitou_termos_em: '2024-11-01', termos_versao: '2026-09-10' },
  { id: 'pl1', full_name: 'Bruno Tedesco', phone: '(13) 99871-0000', role: 'plataforma', accepts_reminders: true, created_at: '2024-10-01' },
]

const jn = (a, todos) => ({ ...a, services: servicos.find((s) => s.id === a.service_id), professionals: profissionais.find((p) => p.id === a.professional_id), profiles: clientes.find((c) => c.id === a.client_id), appointment_offers: [], origem: a.remarca_de ? (todos.find((o) => o.id === a.remarca_de) ?? null) : null })

const agendamentos = [
  { id: 'ap1', client_id: 'c1', professional_id: 'pr1', service_id: 'sv2', salon_id: SALAO, date: mais(2), start_time: '14:00:00', end_time: '15:30:00', status: 'pendente', price_cents: 8500, created_at: mais(0) },
  { id: 'ap2', client_id: 'c1', professional_id: 'pr2', service_id: 'sv7', salon_id: SALAO, date: mais(9), start_time: '10:30:00', end_time: '11:15:00', status: 'confirmado', price_cents: 6000, created_at: mais(-1), visita_id: 'v1' },
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

const PROMO_IMG = (a, b, txt) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="600" fill="url(#g)"/><circle cx="980" cy="120" r="160" fill="rgba(255,255,255,0.18)"/><circle cx="200" cy="520" r="220" fill="rgba(255,255,255,0.12)"/><text x="80" y="330" font-family="Poppins, Arial" font-size="96" font-weight="700" fill="white">${txt}</text></svg>`)
const promocoes = [
  { id: 'pm1', salon_id: SALAO, professional_id: 'pr1', service_id: 'sv5', titulo: 'Esmaltação em gel com 20% off', texto: 'Só esta semana, com a Ana', imagem_url: PROMO_IMG('#FF2D7A', '#AA4CFF', '-20%'), inicio: mais(-2), fim: mais(5), ativa: true, vistas: 128, cliques: 23, created_at: mais(-2) },
  { id: 'pm2', salon_id: SALAO, professional_id: null, service_id: 'sv8', titulo: 'Semana da sobrancelha', texto: 'Design por R$ 39 no Studio Mel', imagem_url: PROMO_IMG('#AA4CFF', '#FF7BAA', 'R$ 39'), inicio: mais(-1), fim: null, ativa: true, vistas: 310, cliques: 41, created_at: mais(-1) },
  { id: 'pm3', salon_id: null, professional_id: null, service_id: null, titulo: 'Indique uma amiga e ganhe', texto: 'Crédito na próxima visita', imagem_url: PROMO_IMG('#1F2026', '#FF2D7A', 'MIMO'), inicio: mais(-10), fim: null, ativa: true, vistas: 2040, cliques: 96, created_at: mais(-10) },
  { id: 'pm4', salon_id: SALAO, professional_id: null, service_id: null, titulo: 'Dia das Mães', texto: 'Encerrada', imagem_url: PROMO_IMG('#FF7BAA', '#FFC2D8', '❤'), inicio: mais(-40), fim: mais(-20), ativa: true, vistas: 900, cliques: 120, created_at: mais(-40) },
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
  appointment_services: [],
  categorias_de_servico: CATS,
  promocoes: promocoes.map((p) => ({ ...p, salons: p.salon_id ? { name: 'Studio Mel' } : null, professionals: p.professional_id ? { name: profissionais.find((x) => x.id === p.professional_id)?.name } : null })),
  servicos_juntos: [{ service_id: 'sv1', sugerido_id: 'sv3' }],
  salons: [{ id: SALAO, name: 'Studio Mel', slug: 'studio-mel', app_url: 'https://mimo.app', city: 'Santos', address: 'Rua das Flores, 120 · Gonzaga', codigo: 'MEL2K5', tipo: 'salao' }],
  salon_members: [{ salon_id: SALAO, user_id: 'a1', papel: 'admin', salons: { id: SALAO, name: 'Studio Mel', slug: 'studio-mel', codigo: 'MEL2K5', tipo: 'salao', city: 'Santos' } }],
  whatsapp_channels: [{ salon_id: SALAO, canal: 'evolution', identificador: '11', ativo: true, usa_ia: true, usa_bot: true, silencio_inicio: '21:00', silencio_fim: '08:00', teto_diario: 300 }],
  affiliate_settings: [{ id: true, ativo: true, platform_fee_bps: 300, affiliate_share_bps: 50 }],
  message_outbox: [],
}

const RPC = {
  promocoes_para_mim: () => promocoes.filter((p) => p.ativa && (!p.fim || p.fim >= mais(0))).map((p) => ({ ...p, salao: p.salon_id ? 'Studio Mel' : null, profissional: p.professional_id ? profissionais.find((x) => x.id === p.professional_id)?.name : null, professional_id: p.professional_id ?? (p.service_id ? 'pr1' : null), servico: servicos.find((s) => s.id === p.service_id)?.name ?? null })),
  promocao_vista: () => null,
  promocao_clicada: () => null,
  sugestoes_de_visita: ({ com_espera }) => [
    { service_id: 'sv3', service_name: servicos[2]?.name ?? 'Manicure', price: servicos[2]?.price ?? 60, duration_minutes: servicos[2]?.duration_minutes ?? 45, professional_id: 'pr2', professional_name: profissionais[1]?.name ?? 'Camila', photo_url: null, hora_sugerida: '11:30:00', modo: 'logo_depois' },
    ...(com_espera ? [{ service_id: 'sv4', service_name: servicos[3]?.name ?? 'Sobrancelha', price: servicos[3]?.price ?? 50, duration_minutes: servicos[3]?.duration_minutes ?? 30, professional_id: 'pr2', professional_name: profissionais[1]?.name ?? 'Camila', photo_url: null, hora_sugerida: '14:00:00', modo: 'com_espera' }] : []),
  ],
  marcar_visita: () => ({ ok: true, appointment_id: 'ap2', visita_id: 'v1', partes: ['ap2', 'ap2b'], confirmada: false }),
  partes_da_visita: () => [
    { appointment_id: 'ap2b', servico: servicos[7]?.name ?? 'Design de sobrancelhas', service_id: 'sv8', profissional: profissionais[0]?.name ?? 'Ana', professional_id: 'pr1', photo_url: null, inicio: '11:15:00', fim: '11:45:00', status: 'confirmado', price_cents: 4500 },
    { appointment_id: 'ap2c', servico: servicos[2]?.name ?? 'Pedicure', service_id: 'sv3', profissional: profissionais[2]?.name ?? 'Fernanda', professional_id: 'pr3', photo_url: null, inicio: '11:45:00', fim: '12:30:00', status: 'cancelado', price_cents: 4000 },
  ],
  saldo_creditos: () => 3000,
  horarios_livres: () => ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '16:00', '17:00'].map((hora) => ({ hora })),
  dias_com_vaga: () => [mais(1), mais(2), mais(3)].map((dia) => ({ dia, vagas: 6 })),
  avaliacao_da_profissional: () => [{ media: 4.9, quantas: 128 }],
  avaliacoes_da_profissional: () => avaliacoes,
  posicao_na_fila: () => [{ posicao: 3, na_frente: 2, previsao: 'entre 15:00 e 18:00, até ' + mais(7).slice(8, 10) + '/' + mais(7).slice(5, 7) }],
  meu_resumo_indicacoes: () => [{ codigo: 'JULIANA10', premio_indicou_cents: 2000, premio_indicada_cents: 1000, indicadas: 3, creditado_cents: 3000 }],
  meu_resumo_afiliada: () => [],
  minhas_profissionais_indicadas: () => [],
  meus_pedidos: () => agendamentos.filter((a) => a.status === 'pendente' && a.professional_id === 'pr1').map((a) => ({ appointment_id: a.id, cliente: a.profiles?.full_name, servico: a.services?.name, quando: 'Qui, 16/05 às ' + a.start_time.slice(0, 5), faltam_min: 87, remarcacao: false, antes: null, atendimentos: 6, faltas: 1, cancelamentos: 2, remarcacoes: 1, ficha: { comigo: { concluidos: 6, faltas: 1, cancelamentos: 2, cancelamentos_tardios: 1, remarcacoes: 1 }, outras: { horarios: 8, faltas_pct: 25, cancelamentos_pct: 38, remarcacoes_pct: 13 } }, por_historico: true }))
    .concat([{ appointment_id: 'ap9', cliente: 'Juliana Prado', servico: 'Esmaltação em gel', quando: 'Sáb, 25/05 às 15:00', faltam_min: 41, remarcacao: true, antes: 'Qui, 23/05 às 10:30' }]),
  pedir_remarcacao: () => ({ ok: true, appointment_id: 'ap9', pendente: true, minutos: 120 }),
  vitrine_da_profissional: ({ link }) => {
    const p = profissionais.find((x) => x.slug === link)
    if (!p) return null
    return {
      profissional: { id: p.id, name: p.name, slug: p.slug, bio: p.bio, photo_url: p.photo_url, especialidade: p.especialidade ?? null, instagram: p.instagram ?? null, whatsapp: p.whatsapp_publico ?? null, aceite_manual: p.aceite_manual },
      salao: { id: SALAO, name: 'Studio Mel', codigo: 'MEL2K5', tipo: 'salao', city: 'Santos', address: 'Rua das Flores, 120 · Gonzaga', app_url: 'https://mimo.app' },
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
  minhas_agendas: () => [{ salao: { id: SALAO, nome: 'Studio Mel', tipo: 'salao', cidade: 'Santos', codigo: 'MEL2K5' }, entrou_em: mais(-40), como: 'qr', trazida_por: { id: 'pr1', nome: 'Ana Oliveira', ativa: true }, profissionais: profissionais.map((p) => ({ id: p.id, nome: p.name, foto: p.photo_url, especialidade: p.especialidade ?? null, slug: p.slug })) }],
  resolver_codigo: ({ chave }) => String(chave).toUpperCase() === 'MEL2K5'
    ? { tipo: 'salao', codigo: 'MEL2K5', nome: 'Studio Mel', foto: null, profissional_id: null, salao: { id: SALAO, nome: 'Studio Mel', cidade: 'Santos', tipo: 'salao' } }
    : { tipo: 'profissional', codigo: 'ANA7K2', nome: 'Ana Oliveira', foto: FOTO(47), especialidade: 'Nail designer · gel e decoradas', profissional_id: 'pr1', salao: { id: SALAO, nome: 'Studio Mel', cidade: 'Santos', tipo: 'salao' } },
  vincular: () => ({ ok: true, novo: true, salao: { id: SALAO, nome: 'Studio Mel' }, trazida_por: 'Ana Oliveira', tipo: 'profissional' }),
  clientes_do_salao: () => clientes.filter((c) => c.role === 'cliente').map((c, i) => ({ client_id: c.id, nome: c.full_name, telefone: c.phone, entrou_em: mais(-(10 + i * 7)), como: ['qr', 'link', 'agendamento', 'encaixe'][i % 4], trazida_por: ['Ana Oliveira', 'Camila Rocha', null, 'Ana Oliveira'][i % 4], trazida_por_ativa: true, servico_de_entrada: ['Esmaltação em gel', 'Escova', 'Manicure', 'Spa dos pés'][i % 4], com_quem: ['Ana Oliveira', 'Camila Rocha', 'Ana Oliveira', 'Fernanda Lima'][i % 4], atendimentos: [9, 4, 2, 6][i % 4], ultima_visita: mais(-(2 + i * 3)), faltas: [0, 2, 0, 1][i % 4], cancelamentos: [1, 3, 0, 0][i % 4], cancelamentos_tardios: [0, 2, 0, 0][i % 4], remarcacoes: [2, 1, 0, 0][i % 4] })),
  telefone_disponivel: ({ fone }) => (String(fone).replace(/\D/g, '').endsWith('0115') ? { disponivel: false, motivo: 'Esse WhatsApp já tem conta.', email: 'c*****@mimo.demo' } : { disponivel: true }),
  pedir_troca_whatsapp: ({ novo }) => ({ via: 'whatsapp', para: novo, expira_em: mais(0) }),
  confirmar_troca_whatsapp: () => ({ ok: true }),
  meu_perfil_resumo: () => ({ desde: '2025-01-10T12:00:00Z', atendimentos: 14, proximos: 2, agendas: 1, favoritas: 2, saldo_cents: 3000 }),
  contar_publico: ({ publico }) => ({ minhas_clientes: { pessoas: 38, celulares: 11 }, clientes: { pessoas: 124, celulares: 37 }, equipe: { pessoas: 4, celulares: 3 }, todos: { pessoas: 612, celulares: 158 }, so_clientes: { pessoas: 540, celulares: 131 }, profissionais: { pessoas: 61, celulares: 24 }, donas: { pessoas: 11, celulares: 3 }, salao: { pessoas: 128, celulares: 40 } }[publico] ?? { pessoas: 0, celulares: 0 }),
  enviar_recado: () => ({ id: 'r-novo', destinatarios: 38, celulares: 11 }),
  meus_recados: ({ salao }) => salao
    ? [{ id: 'r1', publico: 'clientes', titulo: 'Sexta com horários extras', corpo: 'Abrimos até as 21h. Corre que a agenda está no app!', url: '/cliente/home', destinatarios: 118, celulares: 34, criado_em: mais(-3), autor_nome: 'Mel Tedesco' }, { id: 'r2', publico: 'equipe', titulo: 'Reunião quinta 9h', corpo: 'Café por conta da casa ☕', url: null, destinatarios: 4, celulares: 3, criado_em: mais(-9), autor_nome: 'Mel Tedesco' }]
    : [{ id: 'r3', publico: 'minhas_clientes', titulo: 'Voltei de férias 💅', corpo: 'Agenda aberta a partir de segunda. Quem marcar essa semana ganha nail art simples.', url: '/cliente/home', destinatarios: 35, celulares: 9, criado_em: mais(-12), autor_nome: 'Ana Oliveira' }],
  minhas_trazidas: () => [{ client_id: 'c1', nome: 'Juliana Prado', entrou_em: mais(-40), como: 'qr', ultima_visita: mais(-2) }, { client_id: 'c3', nome: 'Carla Mendes', entrou_em: mais(-20), como: 'link', ultima_visita: mais(-5) }],
  meus_saloes: () => [],
  novo_codigo: () => 'NOV4B7',
  novo_codigo_do_salao: () => 'SAL9Q2',
  plataforma_kpis: () => ({
    saloes: { valor: 2, anterior: 1, serie: [1, 1, 1, 1, 2, 2, 2, 2] }, autonomas: { valor: 2, anterior: 2, serie: [1, 1, 2, 2, 2, 2, 2, 2] },
    profissionais: { valor: 6, anterior: 5, serie: [4, 4, 5, 5, 5, 6, 6, 6] }, clientes: { valor: 8, anterior: 6, serie: [3, 4, 4, 5, 6, 6, 7, 8] },
    vinculos: { valor: 8, anterior: 7, serie: [2, 3, 4, 5, 6, 7, 7, 8] }, contas_7d: { valor: 10, anterior: 8, serie: [2, 3, 2, 5, 4, 6, 8, 10] },
    atendimentos_mes: { valor: 10, anterior: 9, serie: [6, 7, 9, 8, 10, 9, 11, 10] }, marcados: { valor: 18, anterior: 17, serie: [12, 14, 13, 16, 15, 17, 17, 18] },
    sem_vinculo: { valor: 1, anterior: null, serie: null }, whats_hoje: { enviadas: 0, na_fila: 0, falharam: 0 }, whats_falhas_24h: 0, emails: { enviados: 0, na_fila: 1, falharam: 0 } }),
  plataforma_atividade: () => [
    { tipo: 'salao', titulo: 'Novo salão cadastrado', detalhe: 'Espaço Mel foi adicionado à plataforma', quando: new Date(Date.now() - 2 * 3600e3).toISOString() },
    { tipo: 'profissional', titulo: 'Profissional criada', detalhe: 'Carla Nunes foi cadastrada', quando: new Date(Date.now() - 4 * 3600e3).toISOString() },
    { tipo: 'cliente', titulo: 'Nova conta', detalhe: 'Renata Alves · cliente', quando: new Date(Date.now() - 5 * 3600e3).toISOString() },
    { tipo: 'atendimento', titulo: 'Atendimento concluído', detalhe: 'Escova · Camila Duarte com Ana Oliveira', quando: new Date(Date.now() - 26 * 3600e3).toISOString() },
    { tipo: 'vinculo', titulo: 'Cliente entrou na agenda', detalhe: 'Mariana Silva → Espaço Mel · por qr', quando: new Date(Date.now() - 27 * 3600e3).toISOString() },
  ],
  plataforma_vinculos: () => [
    { id: 'v1', pessoa: 'Mariana Silva', contato: '(11) 9 8765-4321', origem: 'Código da Ana Oliveira', origem_tipo: 'profissional', destino: 'Espaço Mel', destino_tipo: 'salao', canal: 'qr', ativo: true, criado_em: new Date(Date.now() - 3600e3).toISOString() },
    { id: 'v2', pessoa: 'Juliana Souza', contato: 'juliana@email.com', origem: 'Código do salão', origem_tipo: 'salao', destino: 'Espaço Mel', destino_tipo: 'salao', canal: 'link', ativo: true, criado_em: new Date(Date.now() - 4 * 3600e3).toISOString() },
    { id: 'v3', pessoa: 'Carla Mendes', contato: 'carla@email.com', origem: 'Código da Ana Oliveira', origem_tipo: 'profissional', destino: 'Agenda Mel', destino_tipo: 'salao', canal: 'cadastro', ativo: true, criado_em: new Date(Date.now() - 30 * 3600e3).toISOString() },
    { id: 'v4', pessoa: 'Bia Costa', contato: '(11) 9 9988-7766', origem: 'Encaixe pelo telefone', origem_tipo: 'salao', destino: 'Espaço Mel', destino_tipo: 'salao', canal: 'encaixe', ativo: false, criado_em: new Date(Date.now() - 40 * 3600e3).toISOString(), saiu_em: new Date().toISOString() },
    { id: 'v5', pessoa: 'Rafaela Ferreira', contato: 'rafa@email.com', origem: 'Código da Beatriz Lima', origem_tipo: 'profissional', destino: 'Espaço Mel', destino_tipo: 'salao', canal: 'link', ativo: true, criado_em: '2024-05-12T12:00:00Z' },
  ],
  plataforma_funil: () => ({ contas: 42, com_vinculo: 29, sem_vinculo: 8, sairam: 5, canais: [{ canal: 'qr', quantos: 17 }, { canal: 'link', quantos: 12 }, { canal: 'cadastro', quantos: 8 }, { canal: 'agendamento', quantos: 5 }], destinos: [{ nome: 'Espaço Mel', tipo: 'salao', quantos: 26 }, { nome: 'Agenda Mel', tipo: 'salao', quantos: 2 }, { nome: 'Ana Oliveira', tipo: 'autonoma', quantos: 4 }] }),
  plataforma_logs: () => [
    { tipo: 'email', titulo: 'Convite enviado', detalhe: 'E-mail para juliana.silva@email.com', ok: true, quando: new Date(Date.now() - 12 * 60e3).toISOString() },
    { tipo: 'whatsapp', titulo: 'Lembrete disparado', detalhe: 'WhatsApp para +55 11 91234-5678', ok: true, quando: new Date(Date.now() - 28 * 60e3).toISOString() },
    { tipo: 'relogio', titulo: 'Relógio: mimo-fila', detalhe: '', ok: true, quando: new Date(Date.now() - 60e3).toISOString() },
    { tipo: 'whatsapp', titulo: 'WhatsApp falhou', detalhe: 'número não existe · 5511987654321', ok: false, quando: new Date(Date.now() - 2 * 3600e3).toISOString() },
  ],
  plataforma_series: () => Array.from({ length: 12 }, (_, i) => ({ fim: mais(-(7 * (11 - i))), atendimentos: [60, 72, 68, 80, 77, 90, 85, 96, 92, 101, 99, 108][i], faturamento_cents: [60, 72, 68, 80, 77, 90, 85, 96, 92, 101, 99, 108][i] * 7800, contas: [3, 5, 4, 6, 8, 7, 9, 10, 8, 12, 11, 13][i], vinculos: [2, 4, 4, 5, 7, 7, 8, 9, 9, 11, 10, 12][i], whats: [40, 48, 50, 61, 58, 70, 66, 75, 72, 80, 79, 88][i], faltas: [3, 2, 4, 2, 3, 1, 2, 3, 1, 2, 2, 1][i] })),
  plataforma_criar_salao: () => ({ ok: true, id: 's5', slug: 'novo-salao', codigo: 'NOV7Q2' }),
  plataforma_confiabilidade: () => ({ dias: 30, concluidos: 318, concluidos_sozinhos: 120, faltas: 14, cancelamentos: 22, cancelamentos_tardios: 9, cancelamentos_da_casa: 5, remarcacoes: 31, sem_resposta: 3, contestacoes: 1, profissionais_atencao: [{ id: 'pr3', nome: 'Fernanda Lima', faltas: 6, taxa: 18, sem_resposta: 2 }], faltosas: [{ id: 'c2', nome: 'Carla Menezes', faltas: 3, salao: 'Studio Mel' }, { id: 'c4', nome: 'Beatriz Souza', faltas: 2, salao: 'Espaço Bela' }, { id: 'c5', nome: 'Renata Lima', faltas: 1, salao: 'Studio Mel' }] }),
  plataforma_resumo: () => ({ saloes: 3, autonomas: 5, profissionais: 14, clientes: 212, vinculos: 240, clientes_sem_vinculo: 4, atendimentos_mes: 318, agendados_futuro: 97, novas_contas_7d: 11, whats_hoje: { na_fila: 2, enviadas: 41, falharam: 1 }, emails: { na_fila: 0, enviados: 58, falharam: 2 } }),
  plataforma_modelos: () => [
    { chave: 'lembrete_agendamento', grupo: 'cliente', titulo: 'Lembrete de véspera', descricao: 'Sai um dia antes do horário.', variaveis: ['nome','servico','profissional','quando','link'], padrao: '📅 *Amanhã tem horário marcado*\n\nOi, {nome}! Só passando pra lembrar:\n\n✨ {servico}\n👩 com *{profissional}*\n🗓️ {quando}\n\nResponda *1* pra confirmar, ou *2* se precisar remarcar.\n\n🔗 Sua agenda: {link}', texto: null, ordem: 10, envia: true, natureza: 'utilidade', sufixo: 'Responda 1 para confirmar ou 2 se precisar remarcar.' },
    { chave: 'agendamento_confirmado', grupo: 'cliente', titulo: 'Horário confirmado', descricao: 'Quando o horário é aceito.', variaveis: ['nome','servico','profissional','quando','link'], padrao: '✅ *Horário confirmado*\n\nOi, {nome}! Está tudo certo:\n\n✨ {servico}\n👩 com *{profissional}*\n🗓️ {quando}', texto: '✅ Fechado, {nome}! {servico} com {profissional}, {quando}. Te espero 💛', ordem: 20, envia: true, natureza: 'utilidade', sufixo: null },
    { chave: 'pedido_de_aceite', grupo: 'profissional', titulo: 'Pedido de horário', descricao: 'A profissional responde 1 ou 2.', variaveis: ['nome_agenda','servico','quando_longo','telefone_cliente','prazo'], padrao: '🔔 *Pedido de horário*\n\n👤 {nome_agenda}\n✨ {servico}\n🕒 {quando_longo}\n\nResponda *1* para aceitar ou *2* para recusar.', texto: null, ordem: 200, envia: true, natureza: 'utilidade', sufixo: null },
    { chave: 'resposta.confirmado', grupo: 'resposta', titulo: 'Cliente confirmou', descricao: 'Depois do "1".', variaveis: ['quando','profissional'], padrao: '✅ *Confirmado!* Te espero dia {quando}. 💛', texto: null, ordem: 300, envia: null, natureza: null, sufixo: null },
    { chave: 'ia.orientacao', grupo: 'ia', titulo: 'Orientação do agente', descricao: 'Quem ele é, como fala, o que nunca faz.', variaveis: [], padrao: 'Você é a assistente do MIMO, o app de agenda de um salão de beleza, falando com uma cliente pelo WhatsApp.\n\nComo você fala: curto, caloroso e direto...', texto: null, ordem: 600, envia: null, natureza: null, sufixo: null },
    { chave: 'push.agendamento_confirmado', grupo: 'push', titulo: 'Horário confirmado', descricao: 'Quando o horário da cliente é aceito ou marcado direto.', variaveis: ['titulo','texto','nome','servico','profissional','quando'], padrao: '{titulo}\n{texto}', texto: 'Tudo certo, {nome}! ✅\n{servico} com {profissional}, {quando}.', ordem: 700, envia: true, natureza: null, sufixo: null, exemplo: { titulo: 'Horário confirmado', texto: 'Manicure com Ana Oliveira dia 12/09 às 14:00.' } },
    { chave: 'push.lembrete_agendamento', grupo: 'push', titulo: 'Lembrete de véspera', descricao: 'Um dia antes do horário.', variaveis: ['titulo','texto','nome','servico','profissional','quando'], padrao: '{titulo}\n{texto}', texto: null, ordem: 705, envia: true, natureza: null, sufixo: null, exemplo: { titulo: 'Amanhã tem horário marcado', texto: 'Manicure com Ana Oliveira dia 12/09 às 14:00.' } },
    { chave: 'push.vaga_disponivel', grupo: 'push', titulo: 'Vaga da lista de espera', descricao: 'Abriu vaga para quem estava na fila.', variaveis: ['titulo','texto','nome','servico','profissional','quando'], padrao: '{titulo}\n{texto}', texto: null, ordem: 735, envia: false, natureza: null, sufixo: null, exemplo: { titulo: 'Abriu uma vaga! 🎉', texto: 'Studio Mel tem Manicure livre dia 12/09 às 14:00. A vaga fica guardada para você por 30 minutos.' } },
    { chave: 'push.pedido_de_aceite', grupo: 'push', titulo: 'Pedido de horário', descricao: 'A cliente pediu e a profissional precisa responder.', variaveis: ['titulo','texto','nome','servico','quando'], padrao: '{titulo}\n{texto}', texto: null, ordem: 805, envia: true, natureza: null, sufixo: null, exemplo: { titulo: 'Pedido de horário', texto: 'Juliana quer Manicure sábado, 12/09 às 14:00' } },
    { chave: 'push.afiliado_novo', grupo: 'push', titulo: 'Trouxe uma profissional', descricao: 'Quem indicou uma profissional que entrou no app.', variaveis: ['titulo','texto','nome'], padrao: '{titulo}\n{texto}', texto: null, ordem: 900, envia: true, natureza: null, sufixo: null, exemplo: { titulo: 'Você trouxe uma profissional! 💼', texto: 'A partir de agora você recebe uma parte da taxa do app sempre que ela atender pelo aplicativo.' } },
    { chave: 'bot.nao_entendi', grupo: 'bot', titulo: 'Não entendi', descricao: 'Cliente escreveu algo solto. Vazio = quieto.', variaveis: ['nome','link_app'], padrao: '', texto: null, ordem: 510, envia: null, natureza: null, sufixo: null },
  ],
  plataforma_previa: ({ texto_, chave_ }) => String(texto_ ?? '').replace(/\{titulo\}/g, chave_ ? (RPC.plataforma_modelos().find((m) => m.chave === chave_)?.exemplo?.titulo ?? 'Título do aviso') : 'Título do aviso').replace(/\{texto\}/g, chave_ ? (RPC.plataforma_modelos().find((m) => m.chave === chave_)?.exemplo?.texto ?? '') : 'Texto do aviso').replace(/\{nome\}/g, 'Juliana').replace(/\{servico\}/g, 'Manicure').replace(/\{profissional\}/g, 'Ana Oliveira').replace(/\{quando_longo\}/g, 'sábado, 12/09 às 14:00').replace(/\{quando\}/g, '12/09 às 14:00').replace(/\{link_app\}/g, 'https://mimo.com.vc/').replace(/\{link\}/g, 'https://mimo.com.vc/p/ana-oliveira').replace(/\{nome_agenda\}/g, 'Juliana Silva').replace(/\{telefone_cliente\}/g, '(13) 99999-0000').replace(/\{prazo\}/g, '120'),
  plataforma_salvar_modelo: () => ({ ok: true }),
  plataforma_testar_modelo: ({ para_ }) => ({ ok: true, para: para_?.length ? para_ : ['5513999990000', '5511977770000'], quantos: para_?.length || 2 }),
  marcar_servicos: () => ({ ok: true, appointment_id: 'ap1', servicos: 2 }),
  pendencias_de_baixa: () => [
    { appointment_id: 'ap5', professional_id: 'pr1', profissional: 'Ana Oliveira', client_id: 'c2', cliente: 'Carla Mendes', servico: 'Manicure', dia: mais(0), inicio: '09:00:00', fim: '09:45:00', situacao: 'esperando', perguntado_em: new Date(Date.now() - 20 * 60e3).toISOString(), conclui_em: new Date(Date.now() + 160 * 60e3).toISOString(), troca: null, ficha: { comigo: { concluidos: 4, faltas: 2, cancelamentos: 3, cancelamentos_tardios: 2, remarcacoes: 1 }, outras: { horarios: 5, faltas_pct: 20, cancelamentos_pct: 40, remarcacoes_pct: 0 } }, pode_corrigir: false },
    { appointment_id: 'ap6', professional_id: 'pr1', profissional: 'Ana Oliveira', client_id: 'c3', cliente: 'Mariana Souza', servico: 'Spa dos pés', dia: mais(0), inicio: '10:30:00', fim: '11:30:00', situacao: 'esperando', perguntado_em: new Date(Date.now() - 5 * 60e3).toISOString(), conclui_em: new Date(Date.now() + 175 * 60e3).toISOString(), troca: { id: 'apx', quando: 'sábado 19/09 às 10:30', expira_em: null }, ficha: { comigo: { concluidos: 2, faltas: 0, cancelamentos: 0, cancelamentos_tardios: 0, remarcacoes: 1 }, outras: null }, pode_corrigir: false },
    { appointment_id: 'ap3', professional_id: 'pr1', profissional: 'Ana Oliveira', client_id: 'c1', cliente: 'Juliana Silva', servico: 'Escova', dia: mais(-1), inicio: '16:00:00', fim: '16:45:00', situacao: 'concluido_sozinho', perguntado_em: null, conclui_em: null, troca: null, ficha: null, pode_corrigir: true },
  ],
  dar_baixa: () => ({ ok: true, status: 'concluido' }),
  remarcar_por_fora: () => ({ ok: true, appointment_id: 'apn' }),
  minhas_ciencias: () => (typeof location !== 'undefined' && location.search.includes('ciencia=1')) ? [{ id: 'ci1', motivo: 'falta', criada_em: mais(0), servico: 'Manicure', profissional: 'Ana Oliveira', quando: 'sexta 11/09 às 14:00', appointment_id: 'ap3' }] : [],
  aceitar_ciencia: () => null,
  contestar_falta: () => null,
  plataforma_regra_push: () => null,
  plataforma_celulares_push: ({ email_ }) => ({ ok: true, celulares: email_ ? 1 : 2, nome: email_ ? 'Mel Tedesco' : 'Bruno Tedesco' }),
  plataforma_testar_push: ({ email_ }) => ({ ok: true, celulares: email_ ? 1 : 2, nome: email_ ? 'Mel Tedesco' : 'Bruno Tedesco' }),
  plataforma_telefones_teste: () => [{ telefone: '5513999990000', apelido: 'Bruno', criado_em: mais(-3) }, { telefone: '5511977770000', apelido: null, criado_em: mais(-1) }],
  plataforma_salvar_telefones_teste: ({ fones_ }) => (fones_ ?? []).map((f) => { const [a, b] = f.includes(':') ? f.split(':') : [null, f]; return { telefone: '55' + b.replace(/\D/g, '').slice(-11), apelido: a?.trim() || null, criado_em: mais(0) } }),
  plataforma_palavras: () => [{ intencao: 'confirma', palavras: ['1','sim','confirmo','ok','pode ser'] }, { intencao: 'cancela', palavras: ['2','nao','remarcar','cancelar'] }, { intencao: 'sair', palavras: ['sair','parar','stop'] }],
  plataforma_ia: () => [{ salon_id: SALAO, salao: 'Studio Mel', canal: 'evolution', ativo: true, usa_bot: true, usa_ia: true, teto_ia_diario: 200, teto_ia_por_numero: 20, gastas_hoje: 12, orientacao_ia: 'Atendemos de terça a sábado.' }, { salon_id: 's2', salao: 'Espaço Bela', canal: 'manual', ativo: true, usa_bot: false, usa_ia: false, teto_ia_diario: 200, teto_ia_por_numero: 20, gastas_hoje: 0 }],
  plataforma_saloes: () => [
    { id: SALAO, nome: 'Studio Mel', tipo: 'salao', slug: 'studio-mel', codigo: 'MEL2K5', cidade: 'Santos', ativo: true, dona: 'Mel Tedesco', dona_email: 'mel@exemplo.com', profissionais: 4, clientes: 128, servicos: 8, tem_horario: true, atendimentos: 1240, atendimentos_mes: 96, ultimo_atendimento: mais(0), desde: '2024-11-01' },
    { id: 's6', nome: 'Agenda Mel', tipo: 'salao', slug: 'agenda-mel', codigo: 'HXUHH8', cidade: 'Itanhaém', ativo: true, dona: 'Projeto Tedesco Softwares', dona_email: 'ts@exemplo.com', profissionais: 0, clientes: 0, servicos: 0, tem_horario: true, atendimentos: 0, atendimentos_mes: 0, ultimo_atendimento: null, desde: '2025-08-30' },
    { id: 's2', nome: 'Espaço Bela', tipo: 'salao', slug: 'espaco-bela', codigo: 'BEL4TX', cidade: 'Praia Grande', ativo: true, dona: 'Renata Alves', dona_email: 'renata@exemplo.com', profissionais: 3, clientes: 54, atendimentos: 310, atendimentos_mes: 40, ultimo_atendimento: mais(-1), desde: '2025-03-12' },
    { id: 's3', nome: 'Léa Solo', tipo: 'autonoma', slug: 'lea-solo', codigo: 'LEA9QW', cidade: 'Santos', ativo: true, dona: 'Léa Solo', dona_email: 'lea@exemplo.com', profissionais: 1, clientes: 19, atendimentos: 88, atendimentos_mes: 12, ultimo_atendimento: mais(-2), desde: '2025-06-02' },
    { id: 's4', nome: 'Nail da Vi', tipo: 'autonoma', slug: 'nail-da-vi', codigo: 'VIV7MN', cidade: 'São Vicente', ativo: false, dona: 'Vivian Costa', dona_email: 'vi@exemplo.com', profissionais: 1, clientes: 6, atendimentos: 15, atendimentos_mes: 0, ultimo_atendimento: mais(-60), desde: '2025-05-20' },
  ],
  plataforma_salao: () => ({ salao: { id: SALAO, name: 'Studio Mel', tipo: 'salao', codigo: 'MEL2K5', city: 'Santos', active: true }, dona: { nome: 'Mel Tedesco', email: 'mel@exemplo.com', telefone: '(13) 99120-3410' }, equipe: profissionais.map((p, i) => ({ id: p.id, nome: p.name, slug: p.slug, codigo: p.codigo ?? 'XXXXXX', ativa: true, tem_conta: i < 3, telefone: p.phone ?? null, trouxe: [23, 9, 4, 0][i], atendimentos: [412, 180, 96, 40][i] })), clientes: clientes.filter((c) => c.role === 'cliente').map((c, i) => ({ nome: c.full_name, telefone: c.phone, entrou_em: mais(-(5 + i * 9)), como: ['qr', 'cadastro', 'agendamento', 'encaixe'][i % 4], trazida_por: ['Ana Oliveira', 'Camila Rocha', null, 'Ana Oliveira'][i % 4] })), ultimos: agendamentos.slice(0, 8).map((a) => ({ data: a.date, hora: a.start_time.slice(0, 5), status: a.status, servico: a.services?.name, profissional: a.professionals?.name, cliente: a.profiles?.full_name })) }),
  plataforma_pessoas: () => clientes.map((c, i) => ({ id: c.id, nome: c.full_name, email: (c.full_name || 'x').split(' ')[0].toLowerCase() + '@exemplo.com', telefone: c.phone, papel: c.role, desde: mais(-(30 + i * 11)), saloes: c.role === 'admin' ? 'Studio Mel' : null, vinculos: c.role === 'cliente' ? 1 : 0, atendimentos: [9, 4, 2, 6, 0, 0][i % 6], ultimo_acesso: mais(-i), faltas: [0, 2, 0, 1, 0, 0][i % 6], cancelamentos: [1, 3, 0, 0, 0, 0][i % 6], remarcacoes: [2, 1, 0, 0, 0, 0][i % 6] })),
  plataforma_filas: () => [
    { canal: 'whatsapp', id: 'f1', quando: new Date(Date.now() - 5 * 60e3).toISOString(), salao: 'Studio Mel', para: '5513998710003', tipo: 'pedido_de_aceite', status: 'enviado', erro: null, resumo: '🔔 Pedido de horário · Juliana Prado · Escova · qui 12/09 às 10:30' },
    { canal: 'email', id: 'f2', quando: new Date(Date.now() - 12 * 60e3).toISOString(), salao: null, para: 'nova@exemplo.com', tipo: 'boas_vindas', status: 'enviado', erro: null, resumo: 'Você entrou na agenda de Ana Oliveira 💛' },
    { canal: 'whatsapp', id: 'f3', quando: new Date(Date.now() - 40 * 60e3).toISOString(), salao: 'Espaço Bela', para: '5513997001188', tipo: 'lembrete_agendamento', status: 'falhou', erro: 'número não existe no WhatsApp', resumo: '📅 Amanhã tem horário marcado · Manicure com Renata' },
    { canal: 'email', id: 'f4', quando: new Date(Date.now() - 3 * 3600e3).toISOString(), salao: null, para: 'pro@exemplo.com', tipo: 'boas_vindas', status: 'na_fila', erro: 'RESEND_API_KEY não configurada', resumo: 'Sua agenda no MIMO está pronta 💛' },
  ],
  promover_plataforma: ({ email_ }) => 'ok: ' + email_ + ' agora é plataforma',
  config_publica: () => ({ vapid_public: 'BDEMO', instagram: 'mimo.com.vc', app_url: 'https://mimo.com.vc', ia_agente: 'ligado', ia_modelo: 'openai/gpt-oss-120b' }),
  relogio_status: () => ({ ligado: true, jobs: [{ nome: 'mimo-fila', agenda: '* * * * *', ativo: true, ultima: new Date().toISOString(), status: 'succeeded' }, { nome: 'mimo-rotinas', agenda: '*/5 * * * *', ativo: true, ultima: new Date().toISOString(), status: 'succeeded' }] }),
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
    is: (c, v) => { filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return q },
    not: (c, op, v) => { if (op === 'is' && v === null) filtros.push((r) => r[c] != null); return q },
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
