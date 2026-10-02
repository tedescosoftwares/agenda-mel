// O catálogo de momentos da Mel (2.88): QUANDO ela fala. Cada momento lê o
// contexto que o banco entrega (mel_contexto) e diz se está acontecendo,
// com que dados (os placeholders da frase), qual a identidade (o que torna
// este momento "o mesmo" de antes), por quanto tempo não repetir, a
// prioridade e a ação que pode oferecer. O texto não mora aqui: vem de
// mel_frases, administrado pela Plataforma.
//
// Regras de prioridade: base por categoria + modificadores de urgência.
// Nível: 'reforco' nunca é a única superfície do fato e não tem X;
// 'importante' pode ser dispensado por 2 h; 'dispensavel' some até o dia virar.

export type Ctx = {
  agora: { data: string; hora: string; minutos_do_dia: number; dia_semana: number; dia_semana_nome: string; periodo: 'manha' | 'tarde' | 'noite' }
  salao: { id: string; nome: string; tipo: string; ramo: string; cidade: string | null; uf: string | null; aceite_automatico: boolean; dias_desde_criacao: number; onboarding_concluido: boolean; tem_link: boolean; equipe: number }
  pessoa: { user_id: string; nome: string | null; dona: boolean; professional_id: string | null }
  hoje: Record<string, any>
  amanha: Record<string, any>
  semana_que_vem: Record<string, any>
  operacional: Record<string, any>
  calendario: { feriado_hoje: string | null; feriado_amanha: string | null; data_comercial: { nome: string; data: string; dias: number } | null }
  clima: Record<string, any> | null
  historico: { primeira_vez: boolean; recentes: Array<{ chave: string; identidade: string | null; superficie: string; frase_id: string | null; mostrada_em: string; dispensada_em: string | null; clicada_em: string | null; concluida_em: string | null }> }
  // primeiros_passos() (só a dona recebe): servicos, equipe, equipe_pendente, agendamentos, avisos, horarios, dados, onboarding_concluido_em
  configuracao?: Record<string, any> | null
  // o que só o app sabe (vem no corpo da chamada): tour_feito
  extra?: { tour_feito?: boolean } | null
}

export type Dados = Record<string, string | number | boolean | null | undefined>
export type Acao = { type: string; payload: Record<string, unknown> } | null
export type Nivel = 'reforco' | 'importante' | 'dispensavel'
export type Momento = {
  chave: string
  categoria: 'agenda' | 'oportunidade' | 'marco' | 'clima' | 'calendario' | 'operacional' | 'geral' | 'configuracao'
  nivel: Nivel
  base: number
  superficies: Array<'mel_bubble' | 'weather_card'>
  tom: string
  cooldownMin: number | null          // null = vale enquanto a identidade for a mesma; 0 = persistente (volta a cada atualização, mesmo fechado)
  detectar: (c: Ctx) => Dados | null
  identidade: (d: Dados, c: Ctx) => string
  modificadores?: (d: Dados, c: Ctx) => number
  acao?: (d: Dados, c: Ctx) => Acao
  tomDe?: (d: Dados, c: Ctx) => string
}

const DIA = 24 * 60
const n = (v: unknown) => Number(v ?? 0) || 0
const fimDeSemana = (c: Ctx) => c.agora.dia_semana === 5 || c.agora.dia_semana === 6
const semanaNome = (dow: number) => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][dow] ?? ''
const reais = (cents: unknown) => 'R$ ' + Math.round(n(cents) / 100).toLocaleString('pt-BR')
const horaCurta = (h: string | null | undefined) => (h ? h.replace(':00', 'h').replace(':', 'h') : '')

export const MOMENTOS: Momento[] = [
  // ------------------------------------------------------------ operacional
  {
    chave: 'pedido_esperando_aceite', categoria: 'operacional', nivel: 'reforco', base: 90, superficies: ['mel_bubble'], tom: 'alerta', cooldownMin: null,
    detectar: (c) => {
      if (c.salao.aceite_automatico) return null
      const lista = c.hoje.pendentes_lista ?? []
      if (!lista.length) return null
      const p = lista[0]
      return { n: lista.length, cliente: p.cliente, hora: horaCurta(p.hora), ids: lista.map((x: any) => x.id).join(','), esperando: p.esperando_min }
    },
    identidade: (d) => String(d.ids),
    modificadores: (d) => (n(d.esperando) > 20 ? 15 : 0) + Math.min(15, (n(d.n) - 1) * 5),
    acao: (d) => ({ type: 'VER_PEDIDOS', payload: { ids: String(d.ids).split(',') } }),
  },
  {
    chave: 'conversa_esperando_humano', categoria: 'operacional', nivel: 'reforco', base: 85, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: null,
    detectar: (c) => {
      const lista = (c.operacional.conversas_humano ?? []).filter((x: any) => n(x.minutos) >= 30)
      if (!lista.length) return null
      return { cliente: lista[0].cliente, minutos: lista[0].minutos, n: lista.length }
    },
    identidade: (d) => `${d.cliente}-${d.n}`,
    modificadores: (d) => (n(d.minutos) > 60 ? 10 : 0),
    acao: () => ({ type: 'VER_FILA_WHATSAPP', payload: {} }),
  },
  {
    chave: 'baixas_pendentes', categoria: 'operacional', nivel: 'reforco', base: 60, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 240,
    detectar: (c) => {
      const qtd = n(c.operacional.baixas_pendentes)
      if (!qtd) return null
      if (c.agora.minutos_do_dia < 18 * 60 && !n(c.operacional.baixas_de_ontem)) return null
      return { n: qtd, valor: reais(c.operacional.baixas_valor_cents), de_ontem: n(c.operacional.baixas_de_ontem) }
    },
    identidade: (d, c) => `${c.agora.data}-${d.n}`,
    modificadores: (d, c) => (n(d.n) >= 3 ? 10 : 0) + (n(d.de_ontem) > 0 ? 10 : 0) + (n(c.operacional.baixas_valor_cents) > 30000 ? 5 : 0),
    acao: (_d, c) => ({ type: 'FECHAR_DIA', payload: { dia: c.agora.data } }),
  },
  {
    chave: 'mensagens_na_fila', categoria: 'operacional', nivel: 'importante', base: 55, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 120,
    detectar: (c) => {
      const qtd = n(c.operacional.fila_whatsapp)
      if (!qtd || c.operacional.whatsapp_automatico) return null
      if (n(c.operacional.fila_whatsapp_desde_min) < 30) return null
      return { n: qtd }
    },
    identidade: (d) => String(d.n),
    modificadores: (d) => Math.min(15, Math.max(0, n(d.n) - 3) * 5),
    acao: () => ({ type: 'VER_FILA_WHATSAPP', payload: {} }),
  },

  // ------------------------------------------------------------ agenda
  {
    chave: 'proxima_cliente_em_breve', categoria: 'agenda', nivel: 'importante', base: 70, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: null,
    detectar: (c) => {
      const p = c.hoje.proxima
      if (!p) return null
      const min = n(p.minutos_ate)
      if (min < 10 || min > 45) return null
      if (n(c.hoje.em_andamento) > 0) return null
      const ehPrimeira = c.hoje.primeira?.id === p.id
      return { cliente: p.cliente || 'A próxima', hora: horaCurta(p.hora), servico: p.servico, minutos: min, profissional: p.profissional, id: p.id, primeira: ehPrimeira, ultima: c.hoje.ultima?.id === p.id, longo: n(p.minutos) > 90 }
    },
    identidade: (d) => String(d.id),
    modificadores: (d) => (n(d.minutos) < 20 ? 10 : 0) + (d.primeira ? 5 : 0) + (d.longo ? 5 : 0),
    acao: (d, c) => ({ type: 'ABRIR_AGENDA', payload: { dia: c.agora.data, appointment_id: d.id } }),
  },
  {
    chave: 'primeira_do_dia', categoria: 'agenda', nivel: 'dispensavel', base: 55, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => {
      const p = c.hoje.primeira
      if (!p || n(c.hoje.concluidos) > 0 || n(c.hoje.em_andamento) > 0) return null
      const [h, m] = String(p.hora).split(':').map(Number)
      const faltam = h * 60 + m - c.agora.minutos_do_dia
      if (faltam <= 45) return null
      return { cliente: p.cliente || 'A primeira', hora: horaCurta(p.hora), servico: p.servico, n: c.hoje.confirmados, faltam, nova: !!p.nova }
    },
    identidade: (d, c) => `${c.agora.data}-${d.hora}`,
    modificadores: (d) => (n(d.faltam) < 60 ? 10 : 0) + (d.nova ? 5 : 0),
    acao: (_d, c) => ({ type: 'ABRIR_AGENDA', payload: { dia: c.agora.data } }),
  },
  {
    chave: 'dia_cheio', categoria: 'agenda', nivel: 'dispensavel', base: 50, superficies: ['mel_bubble', 'weather_card'], tom: 'comemorando', cooldownMin: DIA,
    detectar: (c) => {
      if (n(c.hoje.ocupacao_pct) < 85 || n(c.hoje.total) < 4) return null
      if (c.agora.minutos_do_dia >= 15 * 60) return null
      return { n: c.hoje.total, temperatura: c.clima?.temperatura ?? '', cem: n(c.hoje.ocupacao_pct) >= 100 }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (d, c) => (c.agora.dia_semana === 6 ? 5 : 0) + (d.cem ? 5 : 0),
  },
  {
    chave: 'dia_vazio', categoria: 'agenda', nivel: 'dispensavel', base: 55, superficies: ['mel_bubble'], tom: 'neutra', cooldownMin: DIA,
    detectar: (c) => {
      if (!c.hoje.abre || n(c.hoje.total) > 0 || c.agora.minutos_do_dia >= 14 * 60) return null
      if (!c.salao.onboarding_concluido || c.calendario.feriado_hoje) return null
      return { dia_semana: c.agora.dia_semana_nome }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (_d, c) => (fimDeSemana(c) ? 10 : 0) + (n(c.semana_que_vem.ocupacao_pct) < 35 ? 5 : 0) + (c.salao.dias_desde_criacao < 7 ? -15 : 0),
    acao: (_d, c) => (c.salao.tem_link ? { type: 'DIVULGAR_VAGA', payload: { dia: c.agora.data } } : null),
  },
  {
    chave: 'amanha_vazio', categoria: 'agenda', nivel: 'dispensavel', base: 50, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: DIA,
    detectar: (c) => {
      if (!c.amanha.abre || n(c.amanha.total) > 0 || c.agora.minutos_do_dia < 15 * 60) return null
      if (c.calendario.feriado_amanha) return null
      return { dia_semana: semanaNome(n(c.amanha.dia_semana)), data: c.amanha.data }
    },
    identidade: (d) => String(d.data),
    modificadores: (d, c) => (n(c.amanha.dia_semana) === 6 ? 10 : 0) + (n(c.hoje.ocupacao_pct) >= 85 ? 5 : 0) + (c.salao.dias_desde_criacao < 7 ? -15 : 0),
    acao: (d, c) => (c.salao.tem_link ? { type: 'DIVULGAR_VAGA', payload: { dia: d.data } } : null),
  },
  {
    chave: 'amanha_cheio', categoria: 'agenda', nivel: 'dispensavel', base: 45, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => {
      if (n(c.amanha.ocupacao_pct) < 85 || c.agora.minutos_do_dia < 17 * 60) return null
      return { n: c.amanha.total, sem_confirmar: c.amanha.sem_lembrete, data: c.amanha.data }
    },
    identidade: (d) => String(d.data),
    modificadores: (d) => (n(d.sem_confirmar) >= 3 ? 10 : 0),
    acao: (d) => (n(d.sem_confirmar) > 0 ? { type: 'PEDIR_CONFIRMACAO', payload: { dia: d.data } } : { type: 'VER_AMANHA', payload: { dia: d.data } }),
  },

  // ------------------------------------------------------------ oportunidade
  {
    chave: 'vaga_hoje', categoria: 'oportunidade', nivel: 'dispensavel', base: 60, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: null,
    detectar: (c) => {
      if (n(c.hoje.total) === 0) return null
      const v = (c.hoje.vagas ?? []).find((x: any) => n(x.minutos) >= 60)
      if (!v) return null
      return { hora: horaCurta(v.inicio), hora_fim: horaCurta(v.fim), minutos: v.minutos, profissional: v.profissional, professional_id: v.professional_id, inicio: v.inicio, fim: v.fim, n_espera: c.operacional.espera ?? 0 }
    },
    identidade: (d, c) => `${c.agora.data}-${d.professional_id}-${d.inicio}`,
    modificadores: (d, c) => (n(d.minutos) >= 120 ? 10 : 0) + (fimDeSemana(c) ? 5 : 0) + (n(d.n_espera) > 0 ? 10 : 0),
    acao: (d, c) => n(d.n_espera) > 0
      ? { type: 'OFERTAR_VAGA_LISTA', payload: { prof: d.professional_id, dia: c.agora.data, inicio: d.inicio, fim: d.fim } }
      : c.salao.tem_link ? { type: 'DIVULGAR_VAGA', payload: { dia: c.agora.data, hora: d.inicio } } : null,
  },
  {
    chave: 'cancelamento_recente', categoria: 'oportunidade', nivel: 'importante', base: 65, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: null,
    detectar: (c) => {
      const x = (c.hoje.cancelados_recentes ?? []).find((y: any) => !y.pela_casa)
      if (!x) return null
      return { cliente: x.cliente || 'Uma cliente', hora: horaCurta(x.hora), servico: x.servico, n_espera: c.operacional.espera ?? 0, id: x.id, hoje: x.data === c.agora.data, data: x.data, inicio: x.hora, fim: x.hora_fim, professional_id: x.professional_id, caro: n(x.preco_cents) > n(c.hoje.previsto_cents) / Math.max(1, n(c.hoje.total)) }
    },
    identidade: (d) => String(d.id),
    modificadores: (d) => (d.hoje ? 15 : 0) + (n(d.n_espera) > 0 ? 10 : 0) + (d.caro ? 5 : 0),
    acao: (d, c) => n(d.n_espera) > 0
      ? { type: 'OFERTAR_VAGA_LISTA', payload: { prof: d.professional_id, dia: d.data, inicio: d.inicio, fim: d.fim } }
      : c.salao.tem_link ? { type: 'DIVULGAR_VAGA', payload: { dia: d.data, hora: d.inicio } } : null,
  },
  {
    chave: 'semana_fraca', categoria: 'oportunidade', nivel: 'dispensavel', base: 45, superficies: ['mel_bubble'], tom: 'neutra', cooldownMin: 7 * DIA,
    detectar: (c) => {
      if (![4, 5].includes(c.agora.dia_semana) || c.salao.dias_desde_criacao < 30) return null
      const pct = c.semana_que_vem.ocupacao_pct
      if (pct == null || n(pct) >= 35) return null
      return { ocupacao_pct: pct, semana: c.semana_que_vem.inicio }
    },
    identidade: (d) => String(d.semana),
    modificadores: (_d, c) => (!c.operacional.promocao_ativa ? 10 : 0) + (n(c.hoje.ocupacao_pct) < 35 ? 5 : 0),
    acao: (d) => ({ type: 'CRIAR_PROMOCAO', payload: { semana: d.semana } }),
  },
  {
    chave: 'cliente_nova_hoje', categoria: 'oportunidade', nivel: 'dispensavel', base: 40, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => {
      const novas = c.hoje.novas ?? []
      if (!novas.length) return null
      return { cliente: novas[0].cliente || 'Alguém', hora: horaCurta(novas[0].hora), servico: novas[0].servico, n: novas.length, id: novas[0].id }
    },
    identidade: (d, c) => `${c.agora.data}-${d.id}`,
    modificadores: (d) => (n(d.n) >= 2 ? 5 : 0),
    acao: (d, c) => ({ type: 'ABRIR_AGENDA', payload: { dia: c.agora.data, appointment_id: d.id } }),
  },

  // ------------------------------------------------------------ marco do dia
  {
    chave: 'abertura_do_dia', categoria: 'marco', nivel: 'dispensavel', base: 50, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => {
      if (n(c.hoje.confirmados) + n(c.hoje.concluidos) === 0 || c.agora.minutos_do_dia >= 11 * 60) return null
      const jaHoje = c.historico.recentes.some((r) => r.chave === 'abertura_do_dia' && r.mostrada_em.slice(0, 10) === c.agora.data)
      if (jaHoje) return null
      return { n: n(c.hoje.confirmados) + n(c.hoje.concluidos), primeira_hora: horaCurta(c.hoje.primeira?.hora), ultima_hora: horaCurta(c.hoje.ultima?.hora_fim ?? c.hoje.ultima?.hora), cliente: c.hoje.primeira?.cliente ?? '', temperatura: c.clima?.temperatura ?? '', pendentes: c.hoje.pendentes }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (_d, c) => (c.agora.dia_semana === 1 ? 5 : 0),
    acao: (_d, c) => ({ type: 'ABRIR_AGENDA', payload: { dia: c.agora.data } }),
  },
  {
    chave: 'metade_do_dia', categoria: 'marco', nivel: 'dispensavel', base: 40, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => {
      const total = n(c.hoje.total), feitos = n(c.hoje.concluidos), faltam = n(c.hoje.restantes)
      if (total < 4 || feitos * 2 < total || faltam < 2) return null
      if ((c.hoje.cancelados_recentes ?? []).length) return null
      return { feitos, faltam, folga: n(c.hoje.proxima?.minutos_ate) > 20 }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (d) => (d.folga ? 5 : 0),
  },
  {
    chave: 'ultima_do_dia', categoria: 'marco', nivel: 'dispensavel', base: 45, superficies: ['mel_bubble'], tom: 'cansada', cooldownMin: null,
    detectar: (c) => {
      const u = c.hoje.ultima
      if (!u || n(c.hoje.restantes) !== 1) return null
      const [h, m] = String(u.hora).split(':').map(Number)
      const faltam = h * 60 + m - c.agora.minutos_do_dia
      if (faltam > 60) return null
      if (faltam >= 10 && faltam <= 45) return null   // é a 'proxima_cliente_em_breve' que fala
      return { cliente: u.cliente || 'A última', hora: horaCurta(u.hora), servico: u.servico, dia_semana: c.agora.dia_semana_nome, id: u.id, muitos: n(c.hoje.total) >= 6 }
    },
    identidade: (d) => String(d.id),
    modificadores: (d, c) => (c.agora.dia_semana === 5 ? 5 : 0) + (d.muitos ? 5 : 0),
    tomDe: (_d, c) => (c.agora.periodo === 'noite' ? 'cansada' : 'feliz'),
  },
  {
    chave: 'dia_fechado', categoria: 'marco', nivel: 'dispensavel', base: 50, superficies: ['mel_bubble', 'weather_card'], tom: 'comemorando', cooldownMin: DIA,
    detectar: (c) => {
      if (n(c.hoje.total) < 1 || n(c.hoje.restantes) > 0 || n(c.hoje.em_andamento) > 0) return null
      if (c.agora.minutos_do_dia < 16 * 60) return null
      return { n: c.hoje.concluidos, faltas: c.hoje.faltas, faturamento: reais(c.hoje.faturamento_cents), pendencia: n(c.operacional.baixas_pendentes) }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (d) => (n(d.n) >= 6 ? 10 : 0) + (n(d.pendencia) > 0 ? 10 : 0),
    acao: (d, c) => (n(d.pendencia) > 0 ? { type: 'FECHAR_DIA', payload: { dia: c.agora.data } } : { type: 'VER_AMANHA', payload: { dia: c.amanha.data } }),
    tomDe: (d) => (n(d.faltas) > 0 ? 'cansada' : 'comemorando'),
  },

  // ------------------------------------------------------------ clima
  {
    chave: 'chuva_antes_dos_horarios', categoria: 'clima', nivel: 'importante', base: 65, superficies: ['mel_bubble', 'weather_card'], tom: 'alerta', cooldownMin: 180,
    detectar: (c) => {
      const horas: any[] = c.clima?.horas ?? []
      if (!horas.length || c.clima?.condicao === 'chuva' || c.clima?.condicao === 'trovoada') return null
      const h = horas.slice(0, 4).find((x) => n(x.chuva_pct) >= 60)
      if (!h?.hora) return null
      const [hh, mm] = String(h.hora).split(':').map(Number)
      const minutoChuva = hh * 60 + mm
      const depois = [c.hoje.proxima, c.hoje.ultima].filter(Boolean).filter((a: any) => { const [x, y] = String(a.hora).split(':').map(Number); return x * 60 + y >= minutoChuva })
      if (!depois.length) return null
      return { hora_chuva: horaCurta(h.hora), chuva_pct: h.chuva_pct, n_depois: n(c.hoje.restantes), sem_confirmar: c.hoje.sem_lembrete, hora_iso: h.hora }
    },
    identidade: (d, c) => `${c.agora.data}-${d.hora_iso}`,
    modificadores: (d) => (n(d.chuva_pct) >= 80 ? 10 : 0) + (n(d.sem_confirmar) >= 2 ? 10 : 0),
    acao: (d, c) => (n(d.sem_confirmar) > 0 ? { type: 'PEDIR_CONFIRMACAO', payload: { dia: c.agora.data, desde: d.hora_iso } } : null),
  },
  {
    chave: 'trovoada_agora', categoria: 'clima', nivel: 'importante', base: 65, superficies: ['mel_bubble', 'weather_card'], tom: 'alerta', cooldownMin: 120,
    detectar: (c) => {
      if (c.clima?.condicao !== 'trovoada' || !c.hoje.abre) return null
      return { cliente: c.hoje.proxima?.cliente ?? '', hora: horaCurta(c.hoje.proxima?.hora), proxima_em: c.hoje.proxima?.minutos_ate ?? null }
    },
    identidade: (_d, c) => `${c.agora.data}-${c.agora.hora.slice(0, 2)}`,
    modificadores: (d, c) => (d.proxima_em != null && n(d.proxima_em) <= 90 ? 10 : 0) + (c.agora.periodo === 'noite' ? 5 : 0),
    acao: (d, c) => (d.proxima_em != null ? { type: 'ABRIR_AGENDA', payload: { dia: c.agora.data } } : null),
  },
  {
    chave: 'calor_extremo', categoria: 'clima', nivel: 'dispensavel', base: 45, superficies: ['mel_bubble', 'weather_card'], tom: 'cansada', cooldownMin: 240,
    detectar: (c) => {
      const t = n(c.clima?.temperatura), s = n(c.clima?.sensacao)
      if (!c.clima || (t < 33 && s < 36)) return null
      if (c.agora.minutos_do_dia < 10 * 60 || c.agora.minutos_do_dia >= 18 * 60) return null
      return { temperatura: t, sensacao: s || t, n: c.hoje.restantes }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (d) => (n(d.temperatura) >= 36 ? 10 : 0) + (n(d.n) >= 4 ? 5 : 0),
  },
  {
    chave: 'frio_forte', categoria: 'clima', nivel: 'dispensavel', base: 35, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: 360,
    detectar: (c) => {
      const t = c.clima?.temperatura
      if (t == null || n(t) > 13 || !c.hoje.abre) return null
      return { temperatura: t, minima: c.clima?.previsao?.min ?? t }
    },
    identidade: (_d, c) => c.agora.data,
    modificadores: (d, c) => (n(d.minima) <= 10 ? 5 : 0) + (c.agora.periodo === 'manha' ? 5 : 0),
  },

  // ------------------------------------------------------------ calendário
  {
    chave: 'vespera_feriado', categoria: 'calendario', nivel: 'dispensavel', base: 40, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => (c.calendario.feriado_amanha ? { feriado: c.calendario.feriado_amanha, n: c.amanha.total, data: c.amanha.data } : null),
    identidade: (d) => String(d.data),
    modificadores: (d, c) => (n(d.n) > 0 ? 15 : 0) + ([4, 0].includes(n(c.amanha.dia_semana)) ? 10 : 0),
    acao: (d) => (n(d.n) > 0 ? { type: 'VER_AMANHA', payload: { dia: d.data } } : null),
  },
  {
    chave: 'feriado_hoje', categoria: 'calendario', nivel: 'dispensavel', base: 35, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: DIA,
    detectar: (c) => (c.calendario.feriado_hoje ? { feriado: c.calendario.feriado_hoje, n: c.hoje.total } : null),
    identidade: (_d, c) => c.agora.data,
    modificadores: (d, c) => (n(d.n) > 0 ? 15 : 0) + (n(d.n) === 0 && c.hoje.abre ? 5 : 0),
    tomDe: (d) => (n(d.n) > 0 ? 'feliz' : 'cansada'),
  },
  {
    chave: 'data_comercial_proxima', categoria: 'calendario', nivel: 'dispensavel', base: 40, superficies: ['mel_bubble', 'weather_card'], tom: 'feliz', cooldownMin: 3 * DIA,
    detectar: (c) => {
      const d = c.calendario.data_comercial
      if (!d || d.dias < 3 || d.dias > 12) return null
      return { data: d.nome, dias: d.dias, quando: d.data, semana_pct: c.semana_que_vem.ocupacao_pct ?? 0 }
    },
    identidade: (d) => String(d.quando),
    modificadores: (d, c) => (n(d.semana_pct) < 50 ? 10 : 0) + (!c.operacional.promocao_ativa ? 10 : 0) + (n(d.dias) <= 5 ? 5 : 0),
    acao: (d) => (n(d.semana_pct) < 85 ? { type: 'CRIAR_PROMOCAO', payload: { data_comercial: d.data } } : null),
  },

  // ------------------------------------------------------------ configuração inicial (só a dona vê)
  {
    chave: 'configurar_servicos', categoria: 'configuracao', nivel: 'importante', base: 75, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 0,
    detectar: (c) => (c.configuracao && n(c.configuracao.servicos) === 0 ? { nome: c.pessoa.nome ?? '' } : null),
    identidade: (_d, c) => c.agora.data,
    acao: () => ({ type: 'IR_CONFIGURAR', payload: { passo: 'servicos' } }),
  },
  {
    chave: 'configurar_equipe', categoria: 'configuracao', nivel: 'importante', base: 72, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 0,
    detectar: (c) => (c.configuracao && c.salao.tipo === 'salao' && n(c.configuracao.servicos) > 0 && n(c.configuracao.equipe) === 0 ? { nome: c.pessoa.nome ?? '', n_servicos: c.configuracao.servicos } : null),
    identidade: (_d, c) => c.agora.data,
    acao: () => ({ type: 'IR_CONFIGURAR', payload: { passo: 'equipe' } }),
  },
  {
    chave: 'equipe_sem_acesso', categoria: 'configuracao', nivel: 'dispensavel', base: 55, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 0,
    detectar: (c) => (c.configuracao && n(c.configuracao.equipe_pendente) > 0 ? { n: c.configuracao.equipe_pendente, profissional: '' } : null),
    identidade: (d, c) => `${c.agora.data}-${d.n}`,
    acao: () => ({ type: 'IR_CONFIGURAR', payload: { passo: 'equipe' } }),
  },
  {
    chave: 'agendamento_teste', categoria: 'configuracao', nivel: 'dispensavel', base: 60, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: 0,
    detectar: (c) => (c.configuracao && n(c.configuracao.servicos) > 0 && (c.salao.tipo !== 'salao' || n(c.configuracao.equipe) > 0) && n(c.configuracao.agendamentos) === 0 ? { nome: c.pessoa.nome ?? '' } : null),
    identidade: (_d, c) => c.agora.data,
    acao: () => ({ type: 'ENCAIXAR', payload: {} }),
  },
  {
    chave: 'ligar_avisos', categoria: 'configuracao', nivel: 'dispensavel', base: 45, superficies: ['mel_bubble'], tom: 'atenta', cooldownMin: 0,
    detectar: (c) => (c.configuracao && c.configuracao.avisos === false && n(c.configuracao.agendamentos) > 0 ? { nome: c.pessoa.nome ?? '' } : null),
    identidade: (_d, c) => c.agora.data,
    acao: () => ({ type: 'LIGAR_AVISOS', payload: {} }),
  },
  {
    chave: 'tour_pendente', categoria: 'configuracao', nivel: 'dispensavel', base: 42, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: 0,
    detectar: (c) => (c.extra && c.extra.tour_feito === false && !c.historico.primeira_vez ? { nome: c.pessoa.nome ?? '' } : null),
    identidade: (_d, c) => c.agora.data,
    acao: () => ({ type: 'FAZER_TOUR', payload: {} }),
  },
  {
    chave: 'configuracao_concluida', categoria: 'configuracao', nivel: 'dispensavel', base: 80, superficies: ['mel_bubble', 'weather_card'], tom: 'comemorando', cooldownMin: null,
    detectar: (c) => {
      const k = c.configuracao
      if (!k || n(k.servicos) === 0 || (c.salao.tipo === 'salao' && n(k.equipe) === 0) || n(k.agendamentos) === 0) return null
      if (c.salao.dias_desde_criacao > 30) return null   // salão antigo não "acabou de montar"
      return { nome: c.pessoa.nome ?? '', n_servicos: k.servicos, n_equipe: k.equipe }
    },
    identidade: (_d, c) => c.salao.id,   // uma vez só, para sempre
  },

  // ------------------------------------------------------------ o dia a dia e o primeiro oi
  {
    chave: 'contexto_comum', categoria: 'clima', nivel: 'dispensavel', base: 20, superficies: ['mel_bubble', 'weather_card'], tom: 'neutra', cooldownMin: 180,
    detectar: (c) => ({ temperatura: c.clima?.temperatura ?? '', cidade: c.salao.cidade ?? '', dia_semana: c.agora.dia_semana_nome, periodo: c.agora.periodo === 'manha' ? 'manhã' : c.agora.periodo }),
    identidade: (_d, c) => `${c.agora.data}-${c.clima?.condicao ?? 'sem'}-${c.agora.periodo}`,
    tomDe: (_d, c) => (c.agora.periodo === 'noite' ? 'cansada' : 'feliz'),
  },
  {
    chave: 'primeiro_contato', categoria: 'geral', nivel: 'dispensavel', base: 200, superficies: ['mel_bubble'], tom: 'feliz', cooldownMin: null,
    detectar: (c) => (c.historico.primeira_vez ? { nome: c.pessoa.nome ?? '' } : null),
    identidade: (_d, c) => c.pessoa.user_id,
  },
]

// ------------------------------------------------------------ a decisão
export type Vencedor = { momento: Momento; dados: Dados; pontos: number; acao: Acao; tom: string; identidade: string }

const DISPENSA_IMPORTANTE_MIN = 120

// cooldown e dispensa, pelo histórico desta pessoa
function bloqueado(m: Momento, identidade: string, superficie: string, c: Ctx, agora: Date): boolean {
  if (m.cooldownMin === 0) return false   // persistente: enquanto o fato existir, ela insiste (com outra frase)
  for (const r of c.historico.recentes) {
    if (r.chave !== m.chave) continue
    const mostradaHa = (agora.getTime() - new Date(r.mostrada_em).getTime()) / 60000
    if (r.dispensada_em && m.nivel !== 'reforco') {
      const dispensadaHa = (agora.getTime() - new Date(r.dispensada_em).getTime()) / 60000
      if (m.nivel === 'importante' && dispensadaHa < DISPENSA_IMPORTANTE_MIN) return true
      if (m.nivel === 'dispensavel' && r.mostrada_em.slice(0, 10) === c.agora.data) return true
    }
    if (r.identidade !== identidade || r.superficie !== superficie) continue
    if (m.cooldownMin == null) return true                 // mesma identidade: só volta quando o fato mudar
    if (mostradaHa < m.cooldownMin) return true
  }
  return false
}

export function avaliar(c: Ctx, superficie: 'mel_bubble' | 'weather_card', agora = new Date()): Vencedor[] {
  const lista: Vencedor[] = []
  for (const m of MOMENTOS) {
    if (!m.superficies.includes(superficie)) continue
    let dados: Dados | null = null
    try { dados = m.detectar(c) } catch { dados = null }
    if (!dados) continue
    const identidade = m.identidade(dados, c)
    if (bloqueado(m, identidade, superficie, c, agora)) continue
    let pontos = m.base + (m.modificadores?.(dados, c) ?? 0)
    const acao = m.acao?.(dados, c) ?? null
    if (acao) pontos += 5
    if (!c.hoje.abre && !['operacional', 'configuracao'].includes(m.categoria) && m.chave !== 'primeiro_contato') pontos -= 20
    if (!c.pessoa.dona && m.categoria === 'operacional' && ['baixas_pendentes', 'mensagens_na_fila'].includes(m.chave) === false) { /* a profissional vê o que é dela: nada a anular aqui */ }
    lista.push({ momento: m, dados, pontos, acao, tom: m.tomDe?.(dados, c) ?? m.tom, identidade })
  }
  // maior pontuação; empate: o que apareceu há mais tempo
  const ultimaVez = (chave: string) => { const r = c.historico.recentes.find((x) => x.chave === chave); return r ? new Date(r.mostrada_em).getTime() : 0 }
  lista.sort((a, b) => b.pontos - a.pontos || ultimaVez(a.momento.chave) - ultimaVez(b.momento.chave))
  return lista
}

export function porChave(chave: string): Momento | undefined {
  return MOMENTOS.find((m) => m.chave === chave)
}
