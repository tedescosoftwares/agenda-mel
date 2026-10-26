// Modo demonstração do app: tudo roda com dados fictícios, sem Supabase.
// Liga com EXPO_PUBLIC_DEMO=1 (ver README, "Ver as telas sem banco"). Serve
// para duas coisas: olhar e fotografar qualquer tela sem conta e sem rede
// (inclusive no navegador, com `expo start --web`), e mostrar o app para
// alguém antes de existir conta.
//
// É uma IMITAÇÃO do cliente do Supabase, igual à da web (src/lib/demo.js):
// .from().select().eq()… e .rpc(). Cada tabela e cada função devolvem uma
// lista fixa; escrita "dá certo" e não guarda nada. A cliente da demo é a
// Juliana, com agenda no Studio Mel (salão) e com a Bia (autônoma).
//
// O valor da variável escolhe o cenário:
//   EXPO_PUBLIC_DEMO=1      a Juliana com tudo: horários, novidades, promoções
//   EXPO_PUBLIC_DEMO=vazia  mesma Juliana, sem nada marcado e sem aviso novo
//   EXPO_PUBLIC_DEMO=nova   acabou de criar a conta: ainda não entrou em agenda nenhuma
import type { SupabaseClient } from '@supabase/supabase-js'

type Linha = Record<string, any>

const hoje = new Date()
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const mais = (dias: number) => {
  const d = new Date(hoje)
  d.setDate(d.getDate() + dias)
  return iso(d)
}
const horasAtras = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()

// retrato abstrato em SVG, para não depender de rede
const FOTO = (n: number) => {
  const tons = [
    ['#ff7bb5', '#aa4cff'],
    ['#ffb27a', '#ff2d7a'],
    ['#b8a7f7', '#ff7baa'],
    ['#ffd27a', '#ff7bb5'],
    ['#7ad7ff', '#aa4cff'],
  ]
  const [a, b] = tons[n % tons.length]!
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='200' height='200' fill='url(#g)'/><circle cx='100' cy='78' r='34' fill='rgba(255,255,255,.85)'/><path d='M40 190c6-46 30-66 60-66s54 20 60 66z' fill='rgba(255,255,255,.85)'/></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}
// uma capa (salão, serviço, promoção): degradê com um texto grande e translúcido
const CAPA = (a: string, b: string, txt = '') => {
  txt = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;') // o nome vai dentro do SVG: o & cru quebra a imagem
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='720'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='1200' height='720' fill='url(#g)'/><circle cx='980' cy='140' r='180' fill='rgba(255,255,255,0.18)'/><circle cx='220' cy='600' r='240' fill='rgba(255,255,255,0.12)'/><text x='80' y='400' font-family='Arial' font-size='110' font-weight='700' fill='rgba(255,255,255,0.35)'>${txt}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const DEMO_UID = 'c1'
const CENARIO = process.env.EXPO_PUBLIC_DEMO ?? '1'
const NOVA = CENARIO === 'nova'
const VAZIA = CENARIO === 'vazia'
const DONA = CENARIO === 'dona' // 3.65: uma conta de salão abre o app da cliente e é posta para fora
const S1 = 's1' // Studio Mel (salão)
const S2 = 's2' // Bia Lash (autônoma)

// 3.60: na demo, "entrar com o Google" é a Juliana chegando sem WhatsApp; completar_perfil preenche
let peloGoogle = false
const perfis: Linha[] = [
  { id: 'c1', full_name: 'Juliana Silva', phone: '(13) 99879-0115', avatar_url: null, role: DONA ? 'admin' : 'cliente', aceitou_termos_em: '2025-01-10T12:00:00Z', accepts_reminders: true, aceita_email: true, referral_code: 'JULIANA10', nascimento: '1994-08-23', created_at: '2025-01-10T12:00:00Z' },
]

const saloes: Linha[] = [
  {
    id: S1, name: 'Studio Mel', slug: 'studio-mel', tipo: 'salao', active: true, codigo: 'MEL2K5', city: 'Santos', uf: 'SP', bairro: 'Gonzaga',
    address: 'Rua das Flores, 120 · Gonzaga', cep: '11060300', lat: -23.9668, lng: -46.3325, phone: '(13) 3333-0000', whatsapp: '(13) 99120-3410', instagram: 'studiomel',
    descricao: 'Um cantinho no Gonzaga para você se cuidar com calma: café, música baixa e uma equipe que capricha em cada detalhe.',
    fotos: [CAPA('#ff7baa', '#aa4cff'), CAPA('#ffc2d8', '#ff2d7a')], logo_url: null,
    pagamento_modo: 'opcional', sinal_pct: 50, politica_cancelamento: 'moderada', antecedencia_min_minutos: 60, permite_remarcar: true,
  },
  {
    id: S2, name: 'Bia Lash', slug: 'bia-lash', tipo: 'autonoma', active: true, codigo: 'BIA4LX', city: 'Santos', uf: 'SP', bairro: 'Boqueirão',
    address: 'Av. Conselheiro Nébias, 500 · Boqueirão', phone: null, whatsapp: '(13) 99777-0404', instagram: 'bialash',
    descricao: 'Extensão de cílios fio a fio e volume, com hora marcada.', fotos: [], logo_url: null,
    pagamento_modo: 'nao', sinal_pct: 50, politica_cancelamento: 'flexivel', antecedencia_min_minutos: 120, permite_remarcar: true,
  },
]

const profissionais: Linha[] = [
  { id: 'pr1', user_id: 'p1', salon_id: S1, name: 'Ana Oliveira', codigo: 'ANA7K2', slug: 'ana-oliveira', bio: 'Especialista em unhas decoradas e cuidados completos. Atendo com hora marcada, num cantinho tranquilo no Gonzaga.', especialidade: 'Nail designer · gel e decoradas', instagram: 'ana.oliveira.nails', photo_url: FOTO(0), active: true, aceite_manual: true, minutos_para_aceitar: 120, buffer_minutes: 0 },
  { id: 'pr2', user_id: 'p2', salon_id: S1, name: 'Camila Rocha', slug: 'camila-rocha', bio: 'Cabeleireira e colorista.', especialidade: 'Cabelo e coloração', photo_url: FOTO(1), active: true, aceite_manual: false },
  { id: 'pr3', user_id: 'p3', salon_id: S1, name: 'Fernanda Lima', slug: 'fernanda-lima', bio: 'Esteticista facial e corporal.', especialidade: 'Estética', photo_url: FOTO(2), active: true, aceite_manual: false },
  { id: 'pr4', user_id: 'p4', salon_id: S1, name: 'Roberta Souza', slug: 'roberta-souza', bio: 'Maquiagem e sobrancelhas.', especialidade: 'Sobrancelhas e make', photo_url: FOTO(3), active: true, aceite_manual: true },
  { id: 'pr6', user_id: 'p6', salon_id: S2, name: 'Bia Ferreira', slug: 'bia-ferreira', bio: 'Lash designer. Fio a fio, volume brasileiro e manutenção.', especialidade: 'Extensão de cílios', photo_url: FOTO(4), active: true, aceite_manual: true },
]

const servicos: Linha[] = [
  { id: 'sv1', categoria_id: 'ct2', salon_id: S1, name: 'Manicure', description: 'Cutilagem, lixamento e esmaltação.', duration_minutes: 45, price: 35, active: true, destaque: false, images: [], is_combo: false, return_days: 15 },
  { id: 'sv2', categoria_id: 'ct2', salon_id: S1, name: 'Manicure + Pedicure', description: 'O combo completo.', duration_minutes: 90, price: 85, active: true, destaque: true, images: [CAPA('#ff2d7a', '#ffb27a')], is_combo: true, return_days: 15 },
  { id: 'sv3', categoria_id: 'ct2', salon_id: S1, name: 'Pedicure', description: '', duration_minutes: 45, price: 40, active: true, destaque: false, images: [], is_combo: false, return_days: 20 },
  { id: 'sv4', categoria_id: 'ct10', salon_id: S1, name: 'Spa dos pés', description: 'Hidratação profunda e massagem.', duration_minutes: 60, price: 65, active: true, destaque: false, images: [], is_combo: false, return_days: 30 },
  { id: 'sv5', categoria_id: 'ct2', salon_id: S1, name: 'Esmaltação em gel', description: 'Dura até 3 semanas.', duration_minutes: 60, price: 75, active: true, destaque: true, images: [], is_combo: false, return_days: 21 },
  { id: 'sv6', categoria_id: 'ct1', salon_id: S1, name: 'Corte feminino', description: '', duration_minutes: 60, price: 80, active: true, destaque: false, images: [], is_combo: false, return_days: 45 },
  { id: 'sv7', categoria_id: 'ct1', salon_id: S1, name: 'Escova', description: '', duration_minutes: 45, price: 60, active: true, destaque: false, images: [], is_combo: false, return_days: 10 },
  { id: 'sv8', categoria_id: 'ct4', salon_id: S1, name: 'Design de sobrancelhas', description: '', duration_minutes: 30, price: 45, active: true, destaque: true, images: [], is_combo: false, return_days: 20 },
  { id: 'sv9', categoria_id: 'ct3', salon_id: S2, name: 'Extensão de cílios', description: 'Fio a fio ou volume brasileiro.', duration_minutes: 120, price: 180, active: true, destaque: true, images: [CAPA('#aa4cff', '#3d0c4e')], is_combo: false, return_days: 21 },
  { id: 'sv10', categoria_id: 'ct3', salon_id: S2, name: 'Manutenção de cílios', description: '', duration_minutes: 75, price: 110, active: true, destaque: false, images: [], is_combo: false, return_days: 21 },
]

const vinculosProf: Linha[] = [
  ['pr1', 'sv1'], ['pr1', 'sv2'], ['pr1', 'sv3'], ['pr1', 'sv4'], ['pr1', 'sv5'],
  ['pr2', 'sv6'], ['pr2', 'sv7'], ['pr3', 'sv4'], ['pr4', 'sv8'], ['pr6', 'sv9'], ['pr6', 'sv10'],
].map(([professional_id, service_id]) => ({ professional_id, service_id }))

// a página da profissional pede `salons (name, tipo)` aninhado
for (const p of profissionais) p.salons = { name: saloes.find((s) => s.id === p.salon_id)?.name ?? null, tipo: saloes.find((s) => s.id === p.salon_id)?.tipo ?? null }
const prof = (id: string) => profissionais.find((p) => p.id === id)
const serv = (id: string) => servicos.find((s) => s.id === id)
const salao = (id: string) => saloes.find((s) => s.id === id)
const resumoProf = (p?: Linha) => (p ? { id: p.id, name: p.name, photo_url: p.photo_url } : null)
const resumoServ = (s?: Linha) => (s ? { name: s.name, price: s.price, duration_minutes: s.duration_minutes } : null)
const resumoSalao = (s?: Linha) => (s ? { id: s.id, name: s.name, city: s.city, tipo: s.tipo, address: s.address, phone: s.phone, lat: s.lat ?? null, lng: s.lng ?? null } : null)

const agendamentos: Linha[] = [
  { id: 'ap1', client_id: 'c1', professional_id: 'pr1', service_id: 'sv2', salon_id: S1, date: mais(2), start_time: '14:00:00', end_time: '15:30:00', status: 'pendente', price_cents: 8500, created_at: horasAtras(3) },
  { id: 'ap2', client_id: 'c1', professional_id: 'pr2', service_id: 'sv7', salon_id: S1, date: mais(9), start_time: '10:30:00', end_time: '11:15:00', status: 'confirmado', price_cents: 6000, pago_cents: 3000, created_at: horasAtras(30) },
  { id: 'ap10', client_id: 'c1', professional_id: 'pr6', service_id: 'sv9', salon_id: S2, date: mais(16), start_time: '09:00:00', end_time: '11:00:00', status: 'confirmado', price_cents: 18000, created_at: horasAtras(50) },
  { id: 'ap3', client_id: 'c1', professional_id: 'pr1', service_id: 'sv1', salon_id: S1, date: mais(-12), start_time: '09:00:00', end_time: '10:45:00', status: 'concluido', price_cents: 11000, service_name: 'Manicure + Esmaltação em gel', created_at: horasAtras(14 * 24) },
  { id: 'ap4', client_id: 'c1', professional_id: 'pr3', service_id: 'sv4', salon_id: S1, date: mais(-30), start_time: '16:00:00', end_time: '17:00:00', status: 'concluido', price_cents: 6500, created_at: horasAtras(33 * 24) },
  { id: 'ap5', client_id: 'c1', professional_id: 'pr6', service_id: 'sv9', salon_id: S2, date: mais(-40), start_time: '09:00:00', end_time: '11:00:00', status: 'concluido', price_cents: 18000, created_at: horasAtras(45 * 24) },
  { id: 'apdev', client_id: 'c1', professional_id: 'pr2', service_id: 'sv7', salon_id: S1, date: mais(4), start_time: '15:00:00', end_time: '15:45:00', status: 'cancelado', cancelado_por: 'salao', cancelado_em: mais(-1) + 'T18:20:00', price_cents: 6000, pago_cents: 3000, created_at: horasAtras(3 * 24) },
  { id: 'ap6', client_id: 'c1', professional_id: 'pr4', service_id: 'sv8', salon_id: S1, date: mais(-60), start_time: '11:00:00', end_time: '11:30:00', status: 'faltou', price_cents: 4500, created_at: horasAtras(62 * 24) },
]
  .filter((a) => !NOVA && (!VAZIA || a.date < mais(0)))
  .map((a) => ({
    ...a,
    service_name: a.service_name ?? null,
    remarca_de: null,
    services: resumoServ(serv(a.service_id)),
    professionals: resumoProf(prof(a.professional_id)),
    salons: resumoSalao(salao(a.salon_id)),
    // a Bia propôs adiantar a extensão de cílios: um convite esperando resposta
    appointment_offers: a.id === 'ap10' ? [{ id: 'of1', status: 'pendente', proposed_start_time: '08:00:00', previous_start_time: '09:00:00', expires_at: horasAtras(-48) }] : [],
  }))

const avisos: Linha[] = (NOVA ? [] : [
  { id: 'n1', user_id: 'c1', kind: 'agendamento_confirmado', title: 'Escova confirmada', body: `Com a Camila, dia ${mais(9).slice(8, 10)}/${mais(9).slice(5, 7)} às 10:30, no Studio Mel.`, data: { appointment_id: 'ap2' }, action_url: '/cliente/agendamento/ap2', created_at: horasAtras(1), read_at: null, expires_at: null },
  { id: 'n2', user_id: 'c1', kind: 'pedido_enviado', title: 'Pedido enviado para a Ana', body: 'Manicure + Pedicure, daqui a 2 dias às 14:00. Ela confirma em até 2 horas.', data: { appointment_id: 'ap1' }, action_url: '/cliente/agendamento/ap1', created_at: horasAtras(3), read_at: null, expires_at: null },
  { id: 'n3', user_id: 'c1', kind: 'vaga_disponivel', title: 'Abriu uma vaga', body: `Ana Oliveira tem horário livre dia ${mais(1).slice(8, 10)}/${mais(1).slice(5, 7)} às 15:00.`, data: {}, action_url: '/cliente/fila-espera', created_at: horasAtras(2 * 24), read_at: horasAtras(20), expires_at: null },
  { id: 'n4', user_id: 'c1', kind: 'indicacao_creditada', title: 'Você ganhou R$ 20 de crédito', body: 'A Carla agendou pela sua indicação.', data: {}, action_url: '/cliente/indicacao', created_at: horasAtras(5 * 24), read_at: horasAtras(4 * 24), expires_at: null },
] as Linha[]).map((n) => (VAZIA ? { ...n, read_at: n.read_at ?? horasAtras(1) } : n))

const fila: Linha[] = NOVA ? [] : [
  { id: 'w1', client_id: 'c1', professional_id: 'pr1', service_id: 'sv5', date_from: mais(0), date_to: mais(7), window_start: '15:00:00', window_end: '18:00:00', status: 'aguardando', created_at: horasAtras(24), services: resumoServ(serv('sv5')), professionals: resumoProf(prof('pr1')) },
]

const promocoes: Linha[] = [
  { id: 'pm1', titulo: 'Esmaltação em gel com 20% off', texto: 'Só esta semana, com a Ana', imagem_url: CAPA('#ff2d7a', '#aa4cff', '-20%'), salon_id: S1, salao: 'Studio Mel', professional_id: 'pr1', profissional: 'Ana Oliveira', service_id: 'sv5', servico: 'Esmaltação em gel', fim: mais(5), desconto_pct: 20, preco_de: 75, preco_por: 60 },
  { id: 'pm2', titulo: 'Semana da sobrancelha', texto: 'Design por R$ 39 no Studio Mel', imagem_url: CAPA('#aa4cff', '#ff7baa', 'R$ 39'), salon_id: S1, salao: 'Studio Mel', professional_id: 'pr4', profissional: null, service_id: 'sv8', servico: 'Design de sobrancelhas', fim: null, desconto_pct: null, preco_de: 45, preco_por: null },
  { id: 'pm3', titulo: 'Indique uma amiga e ganhe', texto: 'Crédito na próxima visita', imagem_url: CAPA('#1f2026', '#ff2d7a', 'MIMO'), salon_id: null, salao: null, professional_id: null, profissional: null, service_id: null, servico: null, fim: null, desconto_pct: null, preco_de: null, preco_por: null },
]

const TABELAS: Record<string, Linha[]> = {
  profiles: perfis,
  salons: saloes,
  professionals: profissionais,
  services: servicos,
  professional_services: vinculosProf.map((v) => ({ ...v, services: serv(v.service_id), professionals: prof(v.professional_id) })),
  appointments: agendamentos,
  appointment_services: [
    { id: 'as1', appointment_id: 'ap3', name: 'Manicure', price_cents: 3500, preco_cheio_cents: 3500, duration_minutes: 45, ordem: 1 },
    { id: 'as2', appointment_id: 'ap3', name: 'Esmaltação em gel', price_cents: 7500, preco_cheio_cents: 7500, duration_minutes: 60, ordem: 2 },
  ],
  notifications: avisos,
  waitlist_entries: fila,
  waitlist_offers:
    NOVA || VAZIA
      ? []
      : [{ id: 'wo1', entry_id: 'w1', date: mais(1), start_time: '15:00:00', end_time: '16:00:00', status: 'pendente', expires_at: horasAtras(-0.7), waitlist_entries: { id: 'w1', services: { name: 'Esmaltação em gel' }, professionals: { name: 'Ana Oliveira' } } }],
  comandas: [{ id: 'cmv', appointment_id: 'ap3', appointment_ids: ['ap3'], client_id: 'c1', salon_id: S1, status: 'fechada', fechada_em: mais(-12) + 'T11:02:00' }],
  vinculos: NOVA
    ? []
    : [
        { id: 'vc1', client_id: 'c1', salon_id: S1, saiu_em: null, trazida_por: 'pr1', como: 'qr', criado_em: mais(-40) },
        { id: 'vc2', client_id: 'c1', salon_id: S2, saiu_em: null, trazida_por: 'pr6', como: 'link', criado_em: mais(-50) },
      ],
  client_favorites: [{ client_id: 'c1', professional_id: 'pr1' }, { client_id: 'c1', professional_id: 'pr6' }],
  credit_transactions: [
    { id: 't1', client_id: 'c1', amount_cents: 2000, kind: 'indicacao', description: 'Carla agendou pela sua indicação', created_at: mais(-5) },
    { id: 't2', client_id: 'c1', amount_cents: 1000, kind: 'boas_vindas', description: 'Crédito de boas-vindas', created_at: mais(-40) },
  ],
  pagamentos: [
    { id: 'pg1', appointment_id: 'ap2', client_id: 'c1', salon_id: S1, status: 'pago', valor_cents: 3000, total_cents: 6000, sinal_pct: 50, pago_em: horasAtras(28), cobranca_id: 'pay_demo_2k9f1', termos_aceitos_em: horasAtras(28), criado_em: horasAtras(29) },
    // o sinal do horário que o salão cancelou: devolvido, menos a taxa do PIX
    { id: 'pg2', appointment_id: 'apdev', client_id: 'c1', salon_id: S1, status: 'estornado', valor_cents: 3000, total_cents: 6000, sinal_pct: 50, pago_em: horasAtras(70), cobranca_id: 'pay_demo_7h3dv', termos_aceitos_em: horasAtras(70), estorno_cents: 2801, estornado_em: mais(-1) + 'T18:40:00', motivo_estorno: 'cancelado pelo salão', tentativas_estorno: 1, criado_em: horasAtras(71) },
  ],
  profissional_preferida: [{ client_id: 'c1', salon_id: S1, professional_id: 'pr1' }],
  reviews: [{ id: 'rv1', appointment_id: 'ap4', client_id: 'c1', professional_id: 'pr3', nota: 5, comentario: 'Saí renovada!', created_at: mais(-29) }],
  push_tokens_app: [],
  // quem atende em que dia (domingo fechado, sábado até as 14h)
  professional_hours: profissionais.flatMap((p) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ professional_id: p.id, weekday, open: weekday !== 0, start_time: '09:00:00', end_time: weekday === 6 ? '14:00:00' : '18:00:00' })),
  ),
  categorias_de_servico: [
    ['ct1', 'Cabelo', 'cabelo', 10],
    ['ct2', 'Unhas', 'unhas', 20],
    ['ct3', 'Cílios', 'cilios', 30],
    ['ct4', 'Sobrancelhas', 'sobrancelhas', 40],
    ['ct7', 'Estética facial', 'estetica-facial', 70],
    ['ct10', 'Bem-estar e spa', 'bem-estar-e-spa', 100],
  ].map(([id, nome, slug, ordem]) => ({ id, salon_id: null, nome, slug, ordem, ativa: true, descricao: null, imagem_url: null })),
  servicos_juntos: [
    { service_id: 'sv1', sugerido_id: 'sv3' },
    { service_id: 'sv2', sugerido_id: 'sv5' },
    { service_id: 'sv6', sugerido_id: 'sv7' },
  ],
}

const somar = (hora: string, min: number) => {
  const [h, m] = String(hora).split(':').map(Number)
  const tot = (h ?? 0) * 60 + (m ?? 0) + min
  return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
}

const agendaDe = (s: Linha, vinculo: Linha) => ({
  salao: { id: s.id, nome: s.name, tipo: s.tipo, cidade: s.city, logo: s.logo_url, codigo: s.codigo },
  entrou_em: vinculo.criado_em,
  como: vinculo.como,
  trazida_por: vinculo.trazida_por ? { id: vinculo.trazida_por, nome: prof(vinculo.trazida_por)?.name, ativa: true } : null,
  profissionais: profissionais
    .filter((p) => p.salon_id === s.id && p.active)
    .map((p) => ({ id: p.id, nome: p.name, foto: p.photo_url, especialidade: p.especialidade ?? null, slug: p.slug })),
})


// o guia de salões (3.64): duas cidades, um salão já na MIMO (o Studio Mel), os outros pela Mel no WhatsApp
type LugarDemo = Linha & { cidade: string; cidade_slug: string; uf: string; slug: string; nome: string; categoria: string; bairro: string }
const guiaLugares: LugarDemo[] = [
  { id: 'gl1', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', slug: 'studio-mel', nome: 'Studio Mel', categoria: 'beleza', bairro: 'Centro', endereco: 'Rua das Flores, 120', resumo: 'Unhas, cabelo e estética num só lugar, no coração do Centro.', foto: CAPA('#ff2d7a', '#7a3cff', 'Studio Mel'), fotos: [CAPA('#ff2d7a', '#7a3cff', 'Studio Mel'), CAPA('#7a3cff', '#ffb27a', 'Studio Mel')], pontos: 5.2, selecao: true, na_mimo: true, mimo: { salao_id: S1, nome: 'Studio Mel', slug: 'studio-mel', subdominio: 'studiomel' }, latitude: -24.183, longitude: -46.788, servicos: ['Manicure', 'Pedicure', 'Corte', 'Coloração', 'Limpeza de pele', 'Design de sobrancelhas'], horarios: [1, 2, 3, 4, 5].map((dia) => ({ dia, faixas: [['09:00', '19:00']] })).concat([{ dia: 6, faixas: [['09:00', '14:00']] }]), instagram: 'studiomel', whatsapp: '5513999990001', conteudo: { chamada: 'Um salão completo para você se cuidar da cabeça aos pés.', sobre: ['O Studio Mel reúne nail designers, cabeleireiras e esteticistas num espaço claro e acolhedor, pertinho da praia.', 'Horários marcados, sem fila: você escolhe a profissional e o horário pelo app.'], destaques: [{ titulo: 'Unhas decoradas', texto: 'Gel, fibra e as nail arts do momento com a Ana.' }, { titulo: 'Coloração', texto: 'Mechas, morena iluminada e correção de cor com a Camila.' }] } },
  { id: 'gl2', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', slug: 'ro-coiffeur', nome: 'Rô Coiffeur', categoria: 'cabelo', bairro: 'Centro', endereco: 'Av. Rui Barbosa, 455', resumo: 'Cabeleireira há 20 anos: cortes, escova e química.', foto: CAPA('#8a5cff', '#ff8fb3', 'Rô Coiffeur'), fotos: [CAPA('#8a5cff', '#ff8fb3', 'Rô Coiffeur')], pontos: 4.9, selecao: false, na_mimo: false, votos: 3, latitude: -24.186, longitude: -46.79, servicos: ['Corte', 'Escova', 'Progressiva', 'Hidratação'], horarios: [2, 3, 4, 5, 6].map((dia) => ({ dia, faixas: [['09:00', '18:00']] })), instagram: 'rocoiffeur', whatsapp: '5513999990002', conteudo: { chamada: 'Tradição no cuidado com o cabelo no Centro de Itanhaém.', sobre: ['A Rô atende com hora marcada e conhece cada cliente pelo nome.'], destaques: [] } },
  { id: 'gl3', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', slug: 'espaco-unha-e-arte', nome: 'Espaço Unha & Arte', categoria: 'unhas', bairro: 'Suarão', endereco: 'Rua Marechal Deodoro, 88', resumo: 'Nail designer: alongamento em gel, fibra e nail art.', foto: CAPA('#ff6a3d', '#ffd166', 'Unha & Arte'), fotos: [CAPA('#ff6a3d', '#ffd166', 'Unha & Arte')], pontos: 5.0, selecao: true, na_mimo: false, votos: 1, latitude: -24.17, longitude: -46.77, servicos: ['Alongamento em gel', 'Fibra de vidro', 'Esmaltação em gel', 'Spa dos pés'], horarios: [1, 2, 3, 4, 5, 6].map((dia) => ({ dia, faixas: [['10:00', '19:00']] })), instagram: 'unhaearte', whatsapp: null, conteudo: { chamada: 'Unhas que são obra de arte, no Suarão.', sobre: ['Alongamentos, esmaltação em gel e nail art com hora marcada.'], destaques: [] } },
  { id: 'gl4', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', slug: 'bella-pele-estetica', nome: 'Bella Pele Estética', categoria: 'estetica', bairro: 'Centro', endereco: 'Rua Cunha Moreira, 310', resumo: 'Limpeza de pele, peeling e massagem modeladora.', foto: null, fotos: [], pontos: 4.3, selecao: false, na_mimo: false, latitude: -24.19, longitude: -46.795, servicos: ['Limpeza de pele', 'Peeling', 'Drenagem', 'Massagem modeladora'], horarios: [1, 2, 3, 4, 5].map((dia) => ({ dia, faixas: [['08:00', '12:00'], ['13:00', '18:00']] })), instagram: null, whatsapp: '5513999990004', conteudo: { chamada: 'Cuidados com a pele e o corpo no Centro.', sobre: [], destaques: [] } },
  { id: 'gl5', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', slug: 'cilios-da-ju', nome: 'Cílios da Ju', categoria: 'cilios', bairro: 'Belas Artes', endereco: 'Rua Benedito Calixto, 52', resumo: 'Extensão de cílios fio a fio e volume brasileiro.', foto: CAPA('#2d1b4e', '#ff2d7a', 'Cílios da Ju'), fotos: [CAPA('#2d1b4e', '#ff2d7a', 'Cílios da Ju')], pontos: 4.7, selecao: false, na_mimo: false, latitude: -24.2, longitude: -46.81, servicos: ['Fio a fio', 'Volume brasileiro', 'Manutenção', 'Lash lifting'], horarios: [2, 3, 4, 5, 6].map((dia) => ({ dia, faixas: [['09:00', '18:00']] })), instagram: 'ciliosdaju', whatsapp: '5513999990005', conteudo: { chamada: 'Olhar marcante com cílios feitos sob medida.', sobre: ['A Ju atende no Belas Artes, só com hora marcada.'], destaques: [] } },
  { id: 'gl6', cidade: 'Mongaguá', cidade_slug: 'mongagua', uf: 'SP', slug: 'studio-carol-hair', nome: 'Studio Carol Hair', categoria: 'cabelo', bairro: 'Centro', endereco: 'Av. Marina, 700', resumo: 'Cabelo e sobrancelhas no Centro de Mongaguá.', foto: CAPA('#7a3cff', '#2dd4bf', 'Carol Hair'), fotos: [CAPA('#7a3cff', '#2dd4bf', 'Carol Hair')], pontos: 4.8, selecao: false, na_mimo: false, votos: 7, latitude: -24.09, longitude: -46.62, servicos: ['Corte', 'Escova', 'Sobrancelhas'], horarios: [1, 2, 3, 4, 5, 6].map((dia) => ({ dia, faixas: [['09:00', '19:00']] })), instagram: null, whatsapp: '5513999990006', conteudo: { chamada: 'Cabelo bonito e sobrancelhas no ponto.', sobre: [], destaques: [] } },
  { id: 'gl7', cidade: 'Mongaguá', cidade_slug: 'mongagua', uf: 'SP', slug: 'nail-club-mongagua', nome: 'Nail Club Mongaguá', categoria: 'unhas', bairro: 'Agenor de Campos', endereco: 'Rua São Paulo, 15', resumo: 'Manicure, pedicure e alongamentos.', foto: null, fotos: [], pontos: 4.2, selecao: false, na_mimo: false, latitude: -24.11, longitude: -46.65, servicos: ['Manicure', 'Pedicure', 'Alongamento'], horarios: [1, 2, 3, 4, 5].map((dia) => ({ dia, faixas: [['09:00', '18:00']] })), instagram: null, whatsapp: null, conteudo: { chamada: 'Unhas em dia em Agenor de Campos.', sobre: [], destaques: [] } },
]
const cartaoDoGuia = (l: LugarDemo) => ({ id: l.id, slug: l.slug, pontos: l.pontos ?? null, nome: l.nome, cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, bairro: l.bairro, endereco: l.endereco, categoria: l.categoria, resumo: l.resumo, foto: l.foto, fotos: l.fotos, selecao: l.selecao, na_mimo: l.na_mimo, latitude: l.latitude, longitude: l.longitude, servicos: l.servicos, horarios: l.horarios })
// a ordem pública (3.17, a mesma do site e do servidor): MIMO, Seleção, pontos (foto + nota), nome
const fotosDe = (l: LugarDemo) => (Array.isArray(l.fotos) ? l.fotos.length : l.foto ? 1 : 0)
const guiaCidade = (cidade: string, categoria = '') => {
  const todos = guiaLugares.filter((l) => l.cidade_slug === cidade)
  if (!todos.length) return null
  const lugares = (categoria ? todos.filter((l) => l.categoria === categoria) : todos).map(cartaoDoGuia)
    .sort((a, b) => (a.na_mimo ? 0 : 1) - (b.na_mimo ? 0 : 1) || (b.selecao ? 1 : 0) - (a.selecao ? 1 : 0) || Number(b.pontos ?? 0) - Number(a.pontos ?? 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
  const contar = (f: (l: LugarDemo) => string) => Object.entries(todos.reduce<Record<string, number>>((acc, l) => ((acc[f(l)] = (acc[f(l)] ?? 0) + 1), acc), {}))
  return {
    cidade: todos[0]!.cidade, cidade_slug: cidade, uf: todos[0]!.uf, total: todos.length, foto: todos.find((l) => l.foto)?.foto ?? null,
    regiao: { slug: 'baixada-santista', nome: 'Baixada Santista' },
    categorias: contar((l) => l.categoria).map(([c, n]) => ({ categoria: c, total: n, foto: todos.filter((l) => l.categoria === c && fotosDe(l) > 0).map((l) => l.foto)[0] ?? null })),
    bairros: contar((l) => l.bairro).map(([b, n]) => ({ bairro: b, total: n })),
    lugares, lista: { total: lugares.length, partes: 1, por_parte: 50 },
  }
}

const meusVotosDemo: string[] = []
// 3.68: os contatos pelo guia (migração 213): um pela Mel, anteontem, sem resposta ainda
const contatosDemo: Linha[] = NOVA ? [] : [{ id: 'gc1', lugar_id: 'gl2', canal: 'mel', criado_em: horasAtras(50), respondido_em: null, concluido: null, nota: null }]
const contatoDemo = (c: Linha) => {
  const l = guiaLugares.find((x) => x.id === c.lugar_id)!
  return { ...c, lugar: { id: l.id, nome: l.nome, cidade_slug: l.cidade_slug, slug: l.slug, categoria: l.categoria, bairro: l.bairro, foto: l.foto ?? null, na_mimo: Boolean(l.mimo) } }
}
const RPC: Record<string, (args?: Linha) => unknown> = {
  minhas_agendas: () => TABELAS.vinculos!.filter((v) => v.client_id === DEMO_UID && !v.saiu_em).map((v) => agendaDe(salao(v.salon_id)!, v)),
  meu_perfil_resumo: () => (NOVA ? { desde: horasAtras(2), atendimentos: 0, proximos: 0, agendas: 0, favoritas: 0, saldo_cents: 0 } : { desde: '2025-01-10T12:00:00Z', atendimentos: 14, proximos: VAZIA ? 0 : 3, agendas: 2, favoritas: 2, saldo_cents: 3000 }),
  saldo_creditos: () => 3000,
  promocoes_para_mim: () => (NOVA ? promocoes.filter((p) => !p.salon_id) : promocoes),
  promocao_vista: () => null,
  promocao_clicada: () => null,
  destaques_para_mim: () =>
    servicos
      .filter((s) => !NOVA && s.destaque && s.active)
      .map((s) => ({
        id: s.id, name: s.name, price: s.price, duration_minutes: s.duration_minutes, images: s.images, is_combo: s.is_combo, salon_id: s.salon_id, salao: salao(s.salon_id)?.name,
        quem: vinculosProf.filter((v) => v.service_id === s.id).map((v) => ({ id: v.professional_id, name: prof(v.professional_id)?.name ?? '' })),
      })),
  descontos_para_mim: (args) =>
    promocoes
      .filter((p) => p.desconto_pct && p.service_id && ((args?.servicos as string[] | undefined) ?? []).includes(p.service_id))
      .map((p) => {
        const cents = Math.round((serv(p.service_id)?.price ?? 0) * 100)
        return { service_id: p.service_id, promocao_id: p.id, titulo: p.titulo, desconto_pct: p.desconto_pct, preco_cents: cents, preco_com_desconto_cents: Math.round((cents * (100 - p.desconto_pct)) / 100) }
      }),
  pagamento_dos_saloes: (args) => ((args?.ids as string[] | undefined) ?? []).map((id) => ({ salon_id: id, modo: salao(id)?.pagamento_modo ?? 'nao', sinal_pct: salao(id)?.sinal_pct ?? 50 })),
  horarios_livres: () => ['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00', '16:00', '17:00'].map((hora) => ({ hora })),
  dias_com_vaga: () => [mais(1), mais(2), mais(3), mais(5), mais(6)].map((dia) => ({ dia, vagas: 6 })),
  posicao_na_fila: () => [{ posicao: 2, na_frente: 1, janela: 'entre 15:00 e 18:00, até ' + mais(7).slice(8, 10) + '/' + mais(7).slice(5, 7) }],
  // o código de seis letras de uma profissional ou de um salão (a forma da web)
  resolver_codigo: (args) => {
    const chave = String(args?.chave ?? '').trim().toUpperCase()
    const p = profissionais.find((x) => x.codigo === chave)
    if (p) {
      const s = salao(p.salon_id)!
      return { tipo: 'profissional', codigo: p.codigo, nome: p.name, foto: p.photo_url ?? null, especialidade: p.especialidade ?? null, profissional_id: p.id, salao: { id: s.id, nome: s.name, cidade: s.city, tipo: s.tipo, logo: s.logo_url ?? null } }
    }
    const s = saloes.find((x) => x.codigo === chave)
    return s ? { tipo: 'salao', codigo: s.codigo, nome: s.name, foto: s.logo_url ?? null, especialidade: null, profissional_id: null, salao: { id: s.id, nome: s.name, cidade: s.city, tipo: s.tipo, logo: s.logo_url ?? null } } : null
  },
  // entrar numa agenda: na demo, o vínculo nasce na hora
  vincular: (args) => {
    const alvo = RPC.resolver_codigo!({ chave: args?.codigo }) as Linha | null
    if (!alvo) return { ok: false, motivo: 'código não encontrado. Confere as seis letras?' }
    const existente = TABELAS.vinculos!.find((v) => v.client_id === DEMO_UID && v.salon_id === alvo.salao.id && !v.saiu_em)
    if (!existente) TABELAS.vinculos!.push({ id: 'vc-' + alvo.salao.id, client_id: DEMO_UID, salon_id: alvo.salao.id, saiu_em: null, trazida_por: alvo.profissional_id, como: args?.jeito ?? 'codigo', criado_em: mais(0) })
    return { ok: true, novo: !existente, salao: alvo.salao, trazida_por: alvo.profissional_id ? (prof(alvo.profissional_id)?.name ?? null) : null, tipo: alvo.tipo }
  },
  telefone_disponivel: (args) => (String(args?.fone ?? '').replace(/\D/g, '').endsWith('0001') ? { disponivel: false, em_uso: true, motivo: 'Esse WhatsApp já está em uso.' } : { disponivel: true }),
  // 3.60: completa a conta que chegou pelo Google
  completar_perfil: (args) => {
    if (!peloGoogle) return { ok: false, motivo: 'Esse perfil já tem WhatsApp. Para trocar, use o perfil.', ja_tinha: true }
    perfis[0]!.phone = args?.fone_ ?? null
    if (args?.nome_) perfis[0]!.full_name = args.nome_
    if (args?.nascimento_) perfis[0]!.nascimento = args.nascimento_
    perfis[0]!.aceitou_termos_em = new Date().toISOString()
    peloGoogle = false
    return { ok: true, phone: args?.fone_ ?? null, encaixes: 1, agendas: 2 }
  },
  documentos_vigentes: () => ({}),
  // o fluxo de marcar: as regras de verdade são do banco; aqui só a forma da resposta
  pagamento_do_salao: (args) => {
    const s = salao(String(args?.salao ?? ''))
    return s
      ? { modo: s.pagamento_modo, sinal_pct: s.sinal_pct, politica: s.politica_cancelamento, estorno_horas: 24, credito_dias: 30, carencia_min: 60, permite_remarcar: s.permite_remarcar, antecedencia_min: s.antecedencia_min_minutos, sinal_modo: 'percentual', sinal_fixo_cents: null }
      : null
  },
  meu_credito: () => null,
  regras_do_agendamento: (args) => {
    const a = agendamentos.find((x) => x.id === args?.appt)
    if (!a) return null
    // o prazo de devolução: 12 h antes do horário (um timestamp sem fuso, como o banco devolve)
    const inicio = new Date(`${a.date}T${a.start_time}`)
    const limite = new Date(inicio.getTime() - 12 * 3600e3)
    const p2 = (n: number) => String(n).padStart(2, '0')
    const limiteIso = `${limite.getFullYear()}-${p2(limite.getMonth() + 1)}-${p2(limite.getDate())}T${p2(limite.getHours())}:${p2(limite.getMinutes())}:00`
    return { politica: 'moderada', horas: 12, credito_dias: 30, limite: limiteIso, dentro_do_prazo: true, pago_cents: a.pago_cents ?? 0, taxa_cents: 199, volta_cents: Math.max(0, (a.pago_cents ?? 0) - 199), credito_ate: null, credito_ate_se_cancelar: mais(30), salao: salao(a.salon_id)?.name ?? null, salon_id: a.salon_id }
  },
  pagina_do_salao: (args) => {
    const s = salao(String(args?.salao ?? ''))
    if (!s) return null
    const equipe = profissionais.filter((p) => p.salon_id === s.id && p.active)
    const notas = (n: number) => (n === 1 ? 5 : 4.8)
    return {
      salao: {
        id: s.id, nome: s.name, tipo: s.tipo, descricao: s.descricao, fotos: s.fotos, logo_url: s.logo_url, endereco: s.address, cidade: s.city, cep: s.cep ?? null, lat: s.lat ?? null, lng: s.lng ?? null,
        telefone: s.phone, whatsapp: s.whatsapp ?? s.phone, instagram: s.instagram, pagamento: RPC.pagamento_do_salao!({ salao: s.id }), aceita: true,
      },
      horarios: s.tipo === 'salao' ? [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: weekday !== 0, start_time: '09:00:00', end_time: weekday === 6 ? '14:00:00' : '19:00:00' })) : [],
      nota: s.id === S1 ? { media: 4.9, quantas: 37 } : { media: 5, quantas: 12 },
      equipe: equipe.map((p, i) => ({ id: p.id, nome: p.name, foto: p.photo_url, bio: p.bio, faz: vinculosProf.filter((v) => v.professional_id === p.id).map((v) => serv(v.service_id)?.name ?? '').sort(), nota: notas(i) })),
      servicos: servicos
        .filter((x) => x.salon_id === s.id && x.active)
        .map((x) => ({ ...x, quem: vinculosProf.filter((v) => v.service_id === x.id).map((v) => ({ id: v.professional_id, nome: prof(v.professional_id)?.name, foto: prof(v.professional_id)?.photo_url, preco_cents: null, duracao_minutos: null })) })),
      capas: s.id === S1 ? { ct2: [CAPA('#ff2d7a', '#ff7baa')], ct1: [CAPA('#aa4cff', '#ff7baa')] } : {},
      preferida: s.id === S1 ? 'pr1' : null,
      promocoes: promocoes.filter((p) => p.salon_id === s.id).map((p) => ({ id: p.id, titulo: p.titulo, texto: p.texto, imagem_url: p.imagem_url, service_id: p.service_id, professional_id: p.professional_id, desconto_pct: p.desconto_pct, fim: p.fim })),
    }
  },
  escolher_preferida: () => null,
  avaliacao_da_profissional: (args) => (args?.prof === 'pr1' ? [{ media: 4.9, quantas: 23 }] : args?.prof === 'pr6' ? [{ media: 5, quantas: 12 }] : []),
  avaliacoes_da_profissional: (args) =>
    args?.prof === 'pr1' || args?.prof === 'pr6'
      ? [
          { nota: 5, comentario: 'Atendimento impecável, saí renovada!', quem: 'Carla', quando: mais(-3) + 'T12:00:00Z' },
          { nota: 5, comentario: 'Super atenciosa e caprichosa.', quem: 'Mariana', quando: mais(-9) + 'T12:00:00Z' },
          { nota: 4, comentario: 'Ficou lindo, só atrasou um pouquinho.', quem: 'Beatriz', quando: mais(-20) + 'T12:00:00Z' },
        ]
      : [],
  servicos_sugeridos_para: (args) => TABELAS.servicos_juntos!.filter((j) => ((args?.servicos as string[] | undefined) ?? []).includes(j.service_id)).map((j) => ({ sugerido_id: j.sugerido_id })),
  config_publica: () => ({ whatsapp_suporte: '5513991151099', instagram: 'mimo.com.vc' }),
  pedir_troca_whatsapp: (args) => ({ via: 'whatsapp', para: String(args?.novo ?? ''), expira_em: horasAtras(-0.17) }),
  confirmar_troca_whatsapp: () => ({ ok: true, phone: '(13) 99999-0000' }),
  sair_da_agenda: () => null,
  comprovante_da_comanda: (args) => {
    if (args?.comanda !== 'cmv') return null
    const s = salao(S1)!
    return {
      id: 'cmv', fechada_em: mais(-12) + 'T11:02:00', status: 'fechada',
      itens: [{ nome: 'Manicure', qtd: 1, preco_cents: 3500 }, { nome: 'Esmaltação em gel', qtd: 1, preco_cents: 7500 }],
      subtotal_cents: 11000, desconto_cents: 0, total_cents: 11000, sinal_app_cents: 0,
      pagamentos: [{ forma: 'pix', valor_cents: 11000, parcelas: null, detalhe: null, recebido_cents: null, troco_cents: null }],
      atendida_por: 'Ana Oliveira', observacao: null, appointment_id: 'ap3', dia: mais(-12), hora: '09:00:00',
      salao: { id: s.id, nome: s.name, tipo: s.tipo, endereco: s.address, cidade: s.city, cnpj: '12.345.678/0001-95', logo_url: s.logo_url }, cliente: 'Juliana Silva',
    }
  },
  meu_resumo_indicacoes: () => [{ codigo: 'JULIANA10', saldo_cents: 3000, indicadas_total: 2, indicadas_creditadas: 1, premio_indicou_cents: 2000, premio_indicada_cents: 1500 }],
  sair_lista_espera: () => null,
  minhas_ciencias: () => [],
  aceitar_ciencia: () => null,
  contestar_falta: () => null,
  responder_antecipacao: () => 'aceita',
  responder_vaga: () => 'aceita',
  sugestoes_de_visita: (args) => {
    const p = prof(String(args?.prof ?? ''))
    if (p?.salon_id !== S1) return []
    const dur = ((args?.servicos as string[] | undefined) ?? []).reduce((a, id) => a + (serv(id)?.duration_minutes ?? 0), 0)
    const fim = somar(String(args?.apos ?? args?.hora ?? '09:00'), args?.apos ? 0 : dur)
    const outras = profissionais.filter((x) => x.salon_id === S1 && x.id !== p.id)
    const lista = [
      { service_id: 'sv8', professional_id: 'pr4', hora_sugerida: fim + ':00', modo: 'logo_depois' },
      { service_id: 'sv4', professional_id: 'pr3', hora_sugerida: somar(fim, 60) + ':00', modo: 'com_espera' },
      { service_id: 'sv7', professional_id: 'pr2', hora_sugerida: somar(fim, 90) + ':00', modo: 'com_espera' },
    ].filter((x) => outras.some((o) => o.id === x.professional_id) && (args?.com_espera || x.modo === 'logo_depois'))
    return lista.map((x) => {
      const sv = serv(x.service_id)!
      const pr = prof(x.professional_id)!
      return { ...x, service_name: sv.name, price: sv.price, duration_minutes: sv.duration_minutes, professional_name: pr.name, photo_url: pr.photo_url }
    })
  },
  marcar_servicos: (args) => ({ ok: true, appointment_id: 'ap1', servicos: ((args?.servicos as string[] | undefined) ?? []).length, minutos: 90, cents: 8500, desconto_cents: 0, pagar: Boolean(args?.pagar), credito_usado: 0 }),
  marcar_visita: () => ({ ok: true, appointment_id: 'ap1', visita_id: 'v1', partes: ['ap1'], confirmada: false }),
  pedir_remarcacao: () => ({ ok: true, appointment_id: 'ap2', pendente: true, minutos: 45 }),
  partes_da_visita: () => [],
  registrar_token_app: () => null,
  remover_token_app: () => null,
  avancar_ofertas_expiradas: () => null,
  enviar_lembretes: () => null,
  marcar_avisos_lidos: () => null,
  // o guia no app (3.64)
  guia_cidades: () => ['itanhaem', 'mongagua'].map((c) => { const d = guiaCidade(c)!; return { cidade: d.cidade, cidade_slug: c, uf: d.uf, total: d.total, foto: d.foto, categorias: d.categorias.map((x) => ({ categoria: x.categoria, total: x.total })) } }),
  // 3.69: as regiões (migração 182): uma só na demo, com as duas cidades
  guia_regioes: () => [{ slug: 'baixada-santista', nome: 'Baixada Santista', uf: 'SP', ordem: 1, foto: null, chamada: 'As cidades do litoral sul no guia: os salões, as categorias e o que cada cidade concentra.', texto: null, cidades: ['itanhaem', 'mongagua'] }],
  guia_cidade: (args) => guiaCidade(String(args?.cidade_ ?? ''), String(args?.categoria_ ?? '')),
  guia_pagina: (args) => {
    const l = guiaLugares.find((x) => x.cidade_slug === String(args?.cidade_ ?? '') && x.slug === String(args?.slug_ ?? ''))
    if (!l) return null
    const outros = guiaLugares.filter((x) => x.cidade_slug === l.cidade_slug && x.id !== l.id)
    return { lugar: { ...cartaoDoGuia(l), telefone: null, whatsapp: l.whatsapp, instagram: l.instagram, site: null, conteudo: l.conteudo, mimo: l.mimo ?? null, votos: Number(l.votos ?? 0), bairro_total: outros.filter((x) => x.bairro === l.bairro).length + 1, cidade_total: outros.length + 1 }, vizinhos: outros.map(cartaoDoGuia), mesma_categoria: outros.filter((x) => x.categoria === l.categoria).map(cartaoDoGuia) }
  },
  guia_contato_config: () => ({ ligado: true, numero: '5513991151099', botoes: ['Quero marcar pela Mel'], msg_cliente: 'Oi, Mel! Quero marcar em {nome} ({cidade}).' }),
  site_minha_cidade: () => ({ cidade: 'Itanhaém', uf: 'SP', origem: 'ip' }),
  // 3.67: "quero esse salão na MIMO" (migração 212): pede ou desfaz; só nos salões fora da MIMO
  guia_votar: (args) => {
    const l = guiaLugares.find((x) => x.id === String(args?.lugar_ ?? ''))
    if (!l) return { ok: false, motivo: 'Salão não encontrado.' }
    if (l.mimo) return { ok: false, na_mimo: true, motivo: 'Esse salão já agenda pela MIMO.' }
    const i = meusVotosDemo.indexOf(l.id)
    if (i >= 0) meusVotosDemo.splice(i, 1); else meusVotosDemo.push(l.id)
    l.votos = Math.max(0, Number(l.votos ?? 0) + (i >= 0 ? -1 : 1))
    return { ok: true, votou: i < 0, votos: l.votos }
  },
  guia_meus_votos: () => [...meusVotosDemo],
  guia_registrar_contato: (args) => {
    const l = guiaLugares.find((x) => x.id === String(args?.lugar_ ?? ''))
    if (!l) return { ok: false, motivo: 'Salão não encontrado.' }
    const ja = contatosDemo.find((c) => c.lugar_id === l.id && c.canal === args?.canal_ && Date.now() - new Date(String(c.criado_em)).getTime() < 10 * 60e3)
    if (ja) return { ok: true, id: ja.id, novo: false }
    const novo = { id: 'gc' + (contatosDemo.length + 2), lugar_id: l.id, canal: String(args?.canal_ ?? 'mel'), criado_em: mais(0), respondido_em: null, concluido: null, nota: null }
    contatosDemo.unshift(novo)
    return { ok: true, id: novo.id, novo: true }
  },
  guia_meus_contatos: () => contatosDemo.map(contatoDemo),
  guia_responder_contato: (args) => {
    const c = contatosDemo.find((x) => x.id === String(args?.contato_ ?? ''))
    if (!c) return { ok: false, motivo: 'Contato não encontrado.' }
    if (args?.concluido_ && !(Number(args?.nota_) >= 1 && Number(args?.nota_) <= 5)) return { ok: false, motivo: 'Dê uma nota de 1 a 5.' }
    c.concluido = Boolean(args?.concluido_); c.nota = c.concluido ? Number(args?.nota_) : null; c.respondido_em = mais(0)
    return { ok: true }
  },
  vincular_pelo_guia: (args) => {
    const s = salao(String(args?.salao_ ?? ''))
    if (!s) return { ok: false, motivo: 'Esse salão não está mais na MIMO.' }
    const existente = TABELAS.vinculos!.find((v) => v.client_id === DEMO_UID && v.salon_id === s.id && !v.saiu_em)
    if (!existente) TABELAS.vinculos!.push({ id: 'vg-' + s.id, client_id: DEMO_UID, salon_id: s.id, saiu_em: null, trazida_por: null, como: 'guia', guia_lugar_id: args?.lugar_ ?? null, criado_em: mais(0) })
    return { ok: true, novo: !existente, salao: { id: s.id, nome: s.name, tipo: s.tipo, cidade: s.city, logo: s.logo_url ?? null } }
  },
}

// a imitação do PostgREST: filtros, ordem, limite, um só
function consulta(linhas: Linha[]) {
  const filtros: ((r: Linha) => boolean)[] = []
  const ordens: [string, number][] = []
  let limite: number | null = null
  let unico = false
  let soContagem = false
  const resultado = () => {
    let r = linhas.filter((x) => filtros.every((f) => f(x)))
    if (ordens.length) {
      r = [...r].sort((a, b) => {
        for (const [c, dir] of ordens) {
          if (a[c] > b[c]) return dir
          if (a[c] < b[c]) return -dir
        }
        return 0
      })
    }
    if (limite != null) r = r.slice(0, limite)
    const count = r.length
    if (soContagem) return { data: null, error: null, count }
    return { data: unico ? (r[0] ?? null) : r, error: null, count }
  }
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => {
      if (o?.head) soContagem = true
      return q
    },
    eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filtros.push((r) => r[c] !== v), q),
    gte: (c: string, v: any) => (filtros.push((r) => r[c] >= v), q),
    lte: (c: string, v: any) => (filtros.push((r) => r[c] <= v), q),
    gt: (c: string, v: any) => (filtros.push((r) => r[c] > v), q),
    lt: (c: string, v: any) => (filtros.push((r) => r[c] < v), q),
    in: (c: string, v: unknown[]) => (filtros.push((r) => v.includes(r[c])), q),
    is: (c: string, v: unknown) => (filtros.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
    not: (c: string, op: string, v: unknown) => {
      if (op === 'is' && v === null) filtros.push((r) => r[c] != null)
      return q
    },
    // "a.eq.1,b.is.null,c.cs.{x}": basta uma parte bater
    or: (expr: string) => {
      filtros.push((r) =>
        expr.split(',').some((parte) => {
          const [col = '', op = '', ...resto] = parte.split('.')
          const v = resto.join('.')
          const x = r[col]
          if (op === 'eq') return String(x) === v
          if (op === 'neq') return String(x) !== v
          if (op === 'is') return v === 'null' ? x == null : String(x) === v
          if (op === 'gt') return x != null && String(x) > v
          if (op === 'gte') return x != null && String(x) >= v
          if (op === 'lt') return x != null && String(x) < v
          if (op === 'lte') return x != null && String(x) <= v
          if (op === 'cs') return Array.isArray(x) && v.replace(/^\{|\}$/g, '').split(',').filter(Boolean).every((i) => x.includes(i))
          if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').includes(String(x))
          return true
        }),
      )
      return q
    },
    ilike: (c: string, v: string) => {
      const t = String(v).replace(/%/g, '').toLowerCase()
      filtros.push((r) => String(r[c] ?? '').toLowerCase().includes(t))
      return q
    },
    order: (c: string, o?: { ascending?: boolean }) => (ordens.push([c, o?.ascending === false ? -1 : 1]), q),
    limit: (n: number) => ((limite = n), q),
    range: (a: number, b: number) => ((limite = b + 1), q),
    maybeSingle: () => ((unico = true), q),
    single: () => ((unico = true), q),
    insert: () => q,
    update: () => q,
    upsert: () => q,
    delete: () => q,
    then: (ok?: (v: any) => any, erro?: (e: any) => any) => Promise.resolve(resultado()).then(ok, erro),
  }
  return q
}

// uma sessão de mentira, do jeito que o supabase-js devolve
const criarSessao = (provedor = 'email') =>
  ({
    access_token: 'demo',
    refresh_token: 'demo',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: DEMO_UID, email: 'juliana@mimo.demo', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: provedor, providers: [provedor] }, user_metadata: { full_name: 'Juliana Silva', ...(provedor === 'google' ? { avatar_url: FOTO(1) } : {}) }, created_at: '2025-01-10T12:00:00Z' },
  }) as any

// no cenário "fora" o app abre sem sessão: entrar, criar conta e o convite
let sessao: any = CENARIO === 'fora' ? null : criarSessao()
const ouvintes = new Set<(evento: string, s: any) => void>()
const avisar = (evento: string) => ouvintes.forEach((f) => f(evento, sessao))

export const demo = {
  auth: {
    getSession: async () => ({ data: { session: sessao }, error: null }),
    getUser: async () => ({ data: { user: sessao?.user ?? null }, error: null }),
    onAuthStateChange: (f: (evento: string, s: any) => void) => {
      ouvintes.add(f)
      return { data: { subscription: { unsubscribe: () => ouvintes.delete(f) } } }
    },
    signInWithPassword: async () => {
      sessao = criarSessao()
      avisar('SIGNED_IN')
      return { data: { session: sessao, user: sessao.user }, error: null }
    },
    // 3.60: entrar com o Google: a conta chega sem WhatsApp e o app pede (completar.tsx)
    signInWithOAuth: async () => {
      peloGoogle = true
      perfis[0]!.phone = null
      perfis[0]!.aceitou_termos_em = null
      sessao = criarSessao('google')
      avisar('SIGNED_IN')
      return { data: { provider: 'google', url: null }, error: null }
    },
    exchangeCodeForSession: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
    signOut: async () => {
      sessao = null
      avisar('SIGNED_OUT')
      return { error: null }
    },
    setSession: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
    refreshSession: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
    updateUser: async () => ({ data: { user: sessao?.user ?? null }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    // criar conta: a demo "manda o e-mail" (um usuário com identidade, não o fantasma do e-mail repetido)
    signUp: async (c: { email: string }) => ({ data: { session: null, user: { id: 'nova', email: c.email, identities: [{ id: 'nova' }] } }, error: null }),
    resend: async () => ({ data: {}, error: null }),
    startAutoRefresh: async () => {},
    stopAutoRefresh: async () => {},
  },
  from: (tabela: string) => consulta(TABELAS[tabela] ?? []),
  rpc: (nome: string, args?: Linha) => {
    // função que não está na lista é escrita (cancelar, avaliar, entrar…):
    // na demo ela "dá certo" e não guarda nada
    const f = RPC[nome]
    const dado = f ? f(args) : null
    const q = consulta(Array.isArray(dado) ? dado : dado == null ? [] : [dado])
    // devolve como o Postgres devolve: lista, objeto ou nada
    q.then = (ok?: (v: any) => any, erro?: (e: any) => any) => Promise.resolve({ data: dado, error: null }).then(ok, erro)
    return q
  },
  storage: {
    from: () => ({
      upload: async () => ({ data: { path: 'demo' }, error: null }),
      getPublicUrl: (p: string) => ({ data: { publicUrl: p } }),
      createSignedUrl: async (p: string) => ({ data: { signedUrl: p }, error: null }),
      remove: async () => ({ data: [], error: null }),
    }),
  },
  // as Edge Functions: "dão certo" com dados fictícios
  functions: {
    invoke: async (nome: string, opts?: { body?: Linha }) => {
      const corpo = opts?.body ?? {}
      if (nome === 'pagamento-criar') {
        if (corpo.simular) return { data: { ok: true, jeito: 'pix', pendente: false }, error: null }
        const appt = agendamentos.find((a) => a.id === corpo.appointment_id)
        const total = appt?.price_cents ?? 8500
        const valor = Math.max(100, Math.round(total * 0.5))
        const existente = TABELAS.pagamentos!.find((p) => p.id === 'pg-demo')
        const pg = existente ?? { id: 'pg-demo', appointment_id: corpo.appointment_id, client_id: DEMO_UID, salon_id: S1, status: 'aguardando', valor_cents: valor, total_cents: total, sinal_pct: 50, pago_em: null, cobranca_id: 'pay_demo_8f3k2', termos_aceitos_em: new Date().toISOString(), criado_em: new Date().toISOString() }
        if (!existente) {
          TABELAS.pagamentos!.push(pg)
          // o PIX "cai" sozinho depois de um tempo, para a tela mostrar o comprovante
          setTimeout(() => {
            pg.status = 'pago'
            pg.pago_em = new Date().toISOString()
            if (appt) appt.pago_cents = valor
          }, 15000)
        }
        return {
          data: { ok: true, pagamento_id: pg.id, valor_cents: pg.valor_cents, sinal_pct: 50, sandbox: true, expira_em: new Date(Date.now() + 14 * 60e3).toISOString(), existente: Boolean(existente), copia_cola: '00020126580014br.gov.bcb.pix0136demo-mimo-' + String(corpo.appointment_id ?? 'x') + '5204000053039865406042.505802BR5904MIMO6006Santos62070503***6304ABCD' },
          error: null,
        }
      }
      return { data: null, error: null }
    },
  },
  channel: () => {
    const c: any = { on: () => c, subscribe: () => c, unsubscribe: async () => 'ok' }
    return c
  },
  removeChannel: async () => 'ok',
} as unknown as SupabaseClient
