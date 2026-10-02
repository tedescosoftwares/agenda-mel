// deno test supabase/functions/mel/momentos_test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { avaliar, type Ctx } from './momentos.ts'

function ctx(extra: Partial<Ctx> & { hoje?: Record<string, unknown>; operacional?: Record<string, unknown>; amanha?: Record<string, unknown> } = {}): Ctx {
  const base: Ctx = {
    agora: { data: '2026-10-02', hora: '14:00', minutos_do_dia: 14 * 60, dia_semana: 5, dia_semana_nome: 'sexta', periodo: 'tarde' },
    salao: { id: 's1', nome: 'Studio Mel', tipo: 'salao', ramo: 'beleza', cidade: 'Santos', uf: 'SP', aceite_automatico: false, dias_desde_criacao: 90, onboarding_concluido: true, tem_link: true, equipe: 3 },
    pessoa: { user_id: 'u1', nome: 'Carla', dona: true, professional_id: null },
    hoje: { total: 6, confirmados: 4, pendentes: 0, concluidos: 2, faltas: 0, restantes: 4, em_andamento: 0, faturamento_cents: 20000, previsto_cents: 60000, ocupacao_pct: 60, sem_lembrete: 2, abre: true, abertura: '09:00', fechamento: '19:00',
      primeira: { id: 'a1', hora: '09:00', cliente: 'Ju' }, proxima: { id: 'a3', hora: '14:20', cliente: 'Bia', servico: 'escova', minutos_ate: 20, minutos: 60, profissional: 'Ana' }, ultima: { id: 'a6', hora: '18:00', hora_fim: '19:00', cliente: 'Rê' },
      novas: [], pendentes_lista: [], cancelados_recentes: [], vagas: [] },
    amanha: { data: '2026-10-03', dia_semana: 6, total: 3, confirmados: 3, sem_lembrete: 1, abre: true, ocupacao_pct: 40, feriado: null },
    semana_que_vem: { inicio: '2026-10-05', ocupacao_pct: 50 },
    operacional: { espera: 0, fila_whatsapp: 0, whatsapp_automatico: false, baixas_pendentes: 0, baixas_de_ontem: 0, baixas_valor_cents: 0, conversas_humano: [], promocao_ativa: false },
    calendario: { feriado_hoje: null, feriado_amanha: null, data_comercial: { nome: 'Dia das Mães', data: '2026-10-20', dias: 18 } },
    clima: { condicao: 'ensolarado', temperatura: 27, sensacao: 28, horas: [] },
    historico: { primeira_vez: false, recentes: [] },
  }
  return { ...base, ...extra, hoje: { ...base.hoje, ...(extra.hoje ?? {}) }, operacional: { ...base.operacional, ...(extra.operacional ?? {}) }, amanha: { ...base.amanha, ...(extra.amanha ?? {}) } } as Ctx
}

Deno.test('próxima cliente em 20 min vence o dia comum e traz ação', () => {
  const fila = avaliar(ctx(), 'mel_bubble')
  assertEquals(fila[0].momento.chave, 'proxima_cliente_em_breve')
  assertEquals(fila[0].dados.cliente, 'Bia')
  assertEquals(fila[0].acao?.type, 'ABRIR_AGENDA')
  assert(fila.some((v) => v.momento.chave === 'contexto_comum'))
})

Deno.test('pedido esperando aceite é reforço e passa na frente', () => {
  const fila = avaliar(ctx({ hoje: { pendentes_lista: [{ id: 'p1', cliente: 'Lu', hora: '16:00', esperando_min: 25 }, { id: 'p2', cliente: 'Mari', hora: '17:00', esperando_min: 5 }] } }), 'mel_bubble')
  assertEquals(fila[0].momento.chave, 'pedido_esperando_aceite')
  assertEquals(fila[0].momento.nivel, 'reforco')
  assertEquals(fila[0].dados.n, 2)
  assertEquals((fila[0].acao?.payload as { ids: string[] }).ids, ['p1', 'p2'])
})

Deno.test('chuva antes dos horários: com horário sem lembrete oferece confirmar; todos avisados fica sem ação', () => {
  const clima = { condicao: 'nublado', temperatura: 24, horas: [{ hora: '15:00', chuva_pct: 20 }, { hora: '16:00', chuva_pct: 75 }, { hora: '17:00', chuva_pct: 80 }] }
  const com = avaliar(ctx({ clima }), 'mel_bubble').find((v) => v.momento.chave === 'chuva_antes_dos_horarios')!
  assertEquals(com.dados.hora_chuva, '16h')
  assertEquals(com.acao?.type, 'PEDIR_CONFIRMACAO')
  const sem = avaliar(ctx({ clima, hoje: { sem_lembrete: 0 } }), 'mel_bubble').find((v) => v.momento.chave === 'chuva_antes_dos_horarios')!
  assertEquals(sem.acao, null)
})

Deno.test('vaga hoje com lista de espera oferta; sem lista divulga', () => {
  const vagas = [{ inicio: '15:30', fim: '16:30', minutos: 60, profissional: 'Ana', professional_id: 'pr1' }]
  const a = avaliar(ctx({ hoje: { vagas }, operacional: { espera: 2 } }), 'mel_bubble').find((v) => v.momento.chave === 'vaga_hoje')!
  assertEquals(a.acao?.type, 'OFERTAR_VAGA_LISTA')
  const b = avaliar(ctx({ hoje: { vagas } }), 'mel_bubble').find((v) => v.momento.chave === 'vaga_hoje')!
  assertEquals(b.acao?.type, 'DIVULGAR_VAGA')
  assertEquals(b.dados.hora, '15h30')
})

Deno.test('cooldown: mesma identidade mostrada há pouco não volta; dispensável dispensado some até o dia virar', () => {
  const recentes = [{ chave: 'proxima_cliente_em_breve', identidade: 'a3', superficie: 'mel_bubble', frase_id: 'f1', mostrada_em: '2026-10-02T13:55:00Z', dispensada_em: null, clicada_em: null, concluida_em: null }]
  const fila = avaliar(ctx({ historico: { primeira_vez: false, recentes } }), 'mel_bubble')
  assert(!fila.some((v) => v.momento.chave === 'proxima_cliente_em_breve'))
  const dispensada = [{ chave: 'calor_extremo', identidade: '2026-10-02', superficie: 'mel_bubble', frase_id: 'f1', mostrada_em: '2026-10-02T11:00:00Z', dispensada_em: '2026-10-02T11:01:00Z', clicada_em: null, concluida_em: null }]
  const quente = avaliar(ctx({ clima: { condicao: 'calor', temperatura: 35, sensacao: 38, horas: [] }, historico: { primeira_vez: false, recentes: dispensada } }), 'mel_bubble')
  assert(!quente.some((v) => v.momento.chave === 'calor_extremo'))
})

Deno.test('reforço não some com dispensa', () => {
  const recentes = [{ chave: 'pedido_esperando_aceite', identidade: 'p1', superficie: 'mel_bubble', frase_id: 'f1', mostrada_em: '2026-10-02T13:00:00Z', dispensada_em: '2026-10-02T13:01:00Z', clicada_em: null, concluida_em: null }]
  const fila = avaliar(ctx({ hoje: { pendentes_lista: [{ id: 'p1', cliente: 'Lu', hora: '16:00', esperando_min: 5 }] }, historico: { primeira_vez: false, recentes } }), 'mel_bubble')
  // mesma identidade e cooldown null: só volta quando o fato mudar; com outro pedido, volta
  assert(!fila.some((v) => v.momento.chave === 'pedido_esperando_aceite'))
  const outra = avaliar(ctx({ hoje: { pendentes_lista: [{ id: 'p1' }, { id: 'p9' }] }, historico: { primeira_vez: false, recentes } }), 'mel_bubble')
  assertEquals(outra[0].momento.chave, 'pedido_esperando_aceite')
})

Deno.test('primeiro contato só na primeira vez; cartão do clima cai no contexto comum', () => {
  const fila = avaliar(ctx({ historico: { primeira_vez: true, recentes: [] } }), 'mel_bubble')
  assertEquals(fila[0].momento.chave, 'primeiro_contato')
  const card = avaliar(ctx(), 'weather_card')
  assert(card.every((v) => v.momento.superficies.includes('weather_card')))
  assertEquals(card[card.length - 1].momento.chave, 'contexto_comum')
})

Deno.test('dia fechado à noite com pendência pede fechar o dia; véspera de feriado com marcadas aponta amanhã', () => {
  const noite = ctx({ agora: { data: '2026-10-02', hora: '19:30', minutos_do_dia: 19 * 60 + 30, dia_semana: 5, dia_semana_nome: 'sexta', periodo: 'noite' }, hoje: { restantes: 0, concluidos: 6, proxima: null }, operacional: { baixas_pendentes: 2, baixas_valor_cents: 18000 } })
  const f = avaliar(noite, 'mel_bubble').find((v) => v.momento.chave === 'dia_fechado')!
  assertEquals(f.acao?.type, 'FECHAR_DIA')
  const v = avaliar(ctx({ calendario: { feriado_hoje: null, feriado_amanha: 'Tiradentes', data_comercial: null } }), 'mel_bubble').find((x) => x.momento.chave === 'vespera_feriado')!
  assertEquals(v.acao?.type, 'VER_AMANHA')
  assertEquals(v.dados.feriado, 'Tiradentes')
})

Deno.test('configuração inicial: sem serviço pede serviços; tudo pronto comemora uma vez; tour pendente sugere o tour', () => {
  const semServico = avaliar(ctx({ configuracao: { servicos: 0, equipe: 0, equipe_pendente: 0, agendamentos: 0, avisos: false }, salao: { ...ctx().salao, dias_desde_criacao: 2 } }), 'mel_bubble')
  assertEquals(semServico[0].momento.chave, 'configurar_servicos')
  assertEquals(semServico[0].acao?.type, 'IR_CONFIGURAR')
  const pronto = avaliar(ctx({ configuracao: { servicos: 6, equipe: 3, equipe_pendente: 0, agendamentos: 1, avisos: true }, salao: { ...ctx().salao, dias_desde_criacao: 2 } }), 'mel_bubble')
  assertEquals(pronto[0].momento.chave, 'configuracao_concluida')
  const jaViu = [{ chave: 'configuracao_concluida', identidade: 's1', superficie: 'mel_bubble', frase_id: 'f', mostrada_em: '2026-09-01T10:00:00Z', dispensada_em: null, clicada_em: null, concluida_em: null }]
  const depois = avaliar(ctx({ configuracao: { servicos: 6, equipe: 3, equipe_pendente: 0, agendamentos: 1, avisos: true }, salao: { ...ctx().salao, dias_desde_criacao: 2 }, historico: { primeira_vez: false, recentes: jaViu } }), 'mel_bubble')
  assert(!depois.some((v) => v.momento.chave === 'configuracao_concluida'))
  const tour = avaliar(ctx({ extra: { tour_feito: false } }), 'mel_bubble').find((v) => v.momento.chave === 'tour_pendente')!
  assertEquals(tour.acao?.type, 'FAZER_TOUR')
  assert(!avaliar(ctx({ extra: { tour_feito: true } }), 'mel_bubble').some((v) => v.momento.chave === 'tour_pendente'))
})
