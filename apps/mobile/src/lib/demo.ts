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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='720'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='1200' height='720' fill='url(#g)'/><circle cx='980' cy='140' r='180' fill='rgba(255,255,255,0.18)'/><circle cx='220' cy='600' r='240' fill='rgba(255,255,255,0.12)'/><text x='80' y='400' font-family='Arial' font-size='110' font-weight='700' fill='rgba(255,255,255,0.35)'>${txt}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const DEMO_UID = 'c1'
const CENARIO = process.env.EXPO_PUBLIC_DEMO ?? '1'
const NOVA = CENARIO === 'nova'
const VAZIA = CENARIO === 'vazia'
const S1 = 's1' // Studio Mel (salão)
const S2 = 's2' // Bia Lash (autônoma)

const perfis: Linha[] = [
  { id: 'c1', full_name: 'Juliana Silva', phone: '(13) 99879-0115', avatar_url: null, role: 'cliente', accepts_reminders: true, referral_code: 'JULIANA10', nascimento: '1994-08-23', created_at: '2025-01-10T12:00:00Z' },
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
  { id: 'pr1', user_id: 'p1', salon_id: S1, name: 'Ana Oliveira', slug: 'ana-oliveira', bio: 'Especialista em unhas decoradas e cuidados completos. Atendo com hora marcada, num cantinho tranquilo no Gonzaga.', especialidade: 'Nail designer · gel e decoradas', instagram: 'ana.oliveira.nails', photo_url: FOTO(0), active: true, aceite_manual: true, minutos_para_aceitar: 120, buffer_minutes: 0 },
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

const prof = (id: string) => profissionais.find((p) => p.id === id)
const serv = (id: string) => servicos.find((s) => s.id === id)
const salao = (id: string) => saloes.find((s) => s.id === id)
const resumoProf = (p?: Linha) => (p ? { id: p.id, name: p.name, photo_url: p.photo_url } : null)
const resumoServ = (s?: Linha) => (s ? { name: s.name, price: s.price, duration_minutes: s.duration_minutes } : null)
const resumoSalao = (s?: Linha) => (s ? { name: s.name, city: s.city, tipo: s.tipo } : null)

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
    appointment_offers: [],
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
  waitlist_offers: [],
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
    { id: 'pg1', appointment_id: 'ap2', client_id: 'c1', salon_id: S1, status: 'pago', valor_cents: 3000, total_cents: 6000, sinal_pct: 50, pago_em: horasAtras(28), criado_em: horasAtras(29) },
  ],
  reviews: [],
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
  resolver_codigo: (args) => {
    const s = saloes.find((x) => x.codigo === String(args?.chave ?? '').toUpperCase())
    return s ? { tipo: s.tipo, salao: { id: s.id, nome: s.name, cidade: s.city } } : null
  },
  // o fluxo de marcar: as regras de verdade são do banco; aqui só a forma da resposta
  pagamento_do_salao: (args) => {
    const s = salao(String(args?.salao ?? ''))
    return s
      ? { modo: s.pagamento_modo, sinal_pct: s.sinal_pct, politica: s.politica_cancelamento, estorno_horas: 24, credito_dias: 30, carencia_min: 60, permite_remarcar: s.permite_remarcar, antecedencia_min: s.antecedencia_min_minutos, sinal_modo: 'percentual', sinal_fixo_cents: null }
      : null
  },
  meu_credito: () => null,
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
    or: () => q,
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
const criarSessao = () =>
  ({
    access_token: 'demo',
    refresh_token: 'demo',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: DEMO_UID, email: 'juliana@mimo.demo', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Juliana Silva' }, created_at: '2025-01-10T12:00:00Z' },
  }) as any

let sessao: any = criarSessao()
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
    signOut: async () => {
      sessao = null
      avisar('SIGNED_OUT')
      return { error: null }
    },
    setSession: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
    refreshSession: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
    updateUser: async () => ({ data: { user: sessao?.user ?? null }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    signUp: async () => ({ data: { session: sessao, user: sessao?.user ?? null }, error: null }),
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
  functions: { invoke: async () => ({ data: null, error: null }) },
  channel: () => {
    const c: any = { on: () => c, subscribe: () => c, unsubscribe: async () => 'ok' }
    return c
  },
  removeChannel: async () => 'ok',
} as unknown as SupabaseClient
