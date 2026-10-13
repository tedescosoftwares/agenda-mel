import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Botao, Cabecalho, Cartao, Carregando, Chip, Selo, Vazio } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { dataCurta, diaNumero, diaSemana, emQuanto, formatDuracao, formatPreco, hora, mesCurto, toISODate } from '@/lib/formato'
import { useAbrirWeb } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Meus horários: as mesmas consultas e regras da web (ClienteAgenda), em tela
// nativa. Próximos e histórico por mês; o detalhe (remarcar, cancelar, avaliar,
// responder proposta) ainda abre na ponte.
export type Agendamento = {
  id: string
  date: string
  start_time: string
  end_time: string | null
  status: string
  service_name: string | null
  service_id: string | null
  professional_id: string | null
  salon_id: string | null
  price_cents: number | null
  pago_cents: number | null
  remarca_de: string | null
  cancelado_por: string | null
  motivo_cancelamento: string | null
  visita_id: string | null
  services: { name: string; price: number | null; duration_minutes: number | null } | null
  professionals: { id: string; name: string; photo_url: string | null } | null
  salons: { name: string; city: string | null; tipo: string | null } | null
  appointment_offers: { id: string; status: string; proposed_start_time: string | null; previous_start_time: string | null; expires_at: string | null }[] | null
  origem?: { id: string; date: string; start_time: string } | null
}

export const SELECAO =
  '*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (name, city, tipo), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)'
const ROTULO: Record<string, string> = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Não fui', cancelado: 'Cancelado' }
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// o nome que vale é o do atendimento (o salão pode ter juntado serviços na visita)
export const nomeDoServico = (a: Agendamento) => a.service_name || a.services?.name || 'Atendimento'
const ajustadoNoSalao = (a: Agendamento) => Boolean(a.service_name && a.services?.name && a.service_name !== a.services.name)
// duração: a do catálogo, salvo quando a visita foi ajustada (aí vale o intervalo real)
export function minutosDe(a: Agendamento): number | null {
  if (!ajustadoNoSalao(a) || !a.end_time) return a.services?.duration_minutes ?? null
  const [h1, m1] = a.start_time.split(':').map(Number)
  const [h2, m2] = a.end_time.split(':').map(Number)
  const d = (h2 ?? 0) * 60 + (m2 ?? 0) - ((h1 ?? 0) * 60 + (m1 ?? 0))
  return d > 0 ? d : (a.services?.duration_minutes ?? null)
}
export const precoDe = (a: Agendamento) => (a.price_cents != null ? a.price_cents / 100 : a.services?.price)
export const ehPedidoDeTroca = (a: Agendamento) => Boolean(a.remarca_de) && a.status === 'pendente'
const jaFoi = (a: Agendamento, agora: Date) => new Date(`${a.date}T${a.end_time || a.start_time}`) <= agora
const podeCancelar = (a: Agendamento) => (a.status === 'pendente' || a.status === 'confirmado') && new Date(`${a.date}T${a.start_time}`) > new Date()
const podeRemarcar = (a: Agendamento) => podeCancelar(a) && Boolean(a.service_id) && !ehPedidoDeTroca(a)
export const temProposta = (a: Agendamento, agora = new Date()) =>
  (a.appointment_offers ?? []).some((o) => o.status === 'pendente' && (!o.expires_at || new Date(o.expires_at) > agora))

function quemCancelou(a: Agendamento): string | null {
  if (a.status !== 'cancelado') return null
  const por = a.cancelado_por ?? 'sistema'
  if (por === 'cliente') return 'Cancelado por você'
  if (por === 'sistema') {
    if (a.motivo_cancelamento === 'reserva não paga') return 'Reserva não paga a tempo'
    return /sem_resposta|troca_sem_resposta/.test(a.motivo_cancelamento ?? '') ? 'Cancelado por falta de resposta' : 'Cancelado'
  }
  return a.salons?.tipo === 'salao' ? 'Cancelado pelo salão' : 'Cancelado pela profissional'
}

type Vaga = { id: string; expires_at: string | null; waitlist_entries: { services: { name: string } | null; professionals: { name: string } | null } | null }

export default function Horarios() {
  const t = useTema()
  const router = useRouter()
  const abrir = useAbrirWeb()
  const { usuario } = useSessao()
  const [aba, setAba] = useState<'proximos' | 'historico'>('proximos')
  const [proximos, setProximos] = useState<Agendamento[] | null>(null)
  const [historico, setHistorico] = useState<Agendamento[]>([])
  const [notas, setNotas] = useState<Map<string, number>>(new Map())
  const [vagas, setVagas] = useState<Vaga[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const carregar = useCallback(async () => {
    if (!usuario) return
    const hoje = toISODate(new Date())
    const [px, hs, hc, rv, vg] = await Promise.all([
      supabase.from('appointments').select(SELECAO).eq('client_id', usuario.id).gte('date', hoje).neq('status', 'cancelado').order('date').order('start_time'),
      supabase.from('appointments').select(SELECAO).eq('client_id', usuario.id).lt('date', hoje).order('date', { ascending: false }).order('start_time', { ascending: false }).limit(40),
      // cancelado com data ainda por vir: não é "próximo", mas faz parte da história
      supabase.from('appointments').select(SELECAO).eq('client_id', usuario.id).gte('date', hoje).eq('status', 'cancelado').order('date', { ascending: false }).limit(20),
      supabase.from('reviews').select('appointment_id, nota').eq('client_id', usuario.id),
      supabase.from('waitlist_offers').select('id, expires_at, waitlist_entries (id, services (name), professionals (name))').eq('status', 'pendente').gt('expires_at', new Date().toISOString()),
    ])
    if (px.error) {
      setErro('Não deu para carregar seus horários. Puxa para baixo para tentar de novo.')
      return
    }
    setErro(null)
    // o que é de hoje mas já terminou não é "próximo": vai para o histórico
    const agora = new Date()
    const todos = (px.data ?? []) as unknown as Agendamento[]
    const lista = todos.filter((a) => !jaFoi(a, agora))
    const passouHoje = todos.filter((a) => jaFoi(a, agora)).reverse()
    // pedido de troca: mostra no lugar de qual horário ele entra
    const faltam = lista.filter((a) => a.remarca_de && !lista.some((o) => o.id === a.remarca_de)).map((a) => a.remarca_de as string)
    const extras = faltam.length ? (((await supabase.from('appointments').select('id, date, start_time').in('id', faltam)).data ?? []) as Agendamento['origem'][]) : []
    setProximos(lista.map((a) => ({ ...a, origem: a.remarca_de ? (lista.find((o) => o.id === a.remarca_de) ?? extras.find((o) => o?.id === a.remarca_de) ?? null) : null })))
    setHistorico(
      [...((hc.data ?? []) as unknown as Agendamento[]), ...passouHoje, ...((hs.data ?? []) as unknown as Agendamento[])].sort((a, b) =>
        (b.date + b.start_time).localeCompare(a.date + a.start_time),
      ),
    )
    setNotas(new Map(((rv.data ?? []) as { appointment_id: string; nota: number }[]).map((r) => [r.appointment_id, r.nota])))
    setVagas((vg.data ?? []) as unknown as Vaga[])
  }, [usuario])

  useFocusEffect(
    useCallback(() => {
      carregar()
    }, [carregar]),
  )

  async function atualizar() {
    setAtualizando(true)
    await carregar()
    setAtualizando(false)
  }

  const agora = new Date()
  const propostas = (proximos ?? []).filter((a) => temProposta(a, agora))
  // o destaque: o primeiro horário de verdade (não um pedido de troca)
  const destaque = (proximos ?? []).find((a) => !ehPedidoDeTroca(a)) ?? null
  const restantes = (proximos ?? []).filter((a) => a !== destaque)
  const trocaAberta = (a: Agendamento) => (proximos ?? []).find((p) => p.remarca_de === a.id && p.status === 'pendente')
  const meses = useMemo(() => agruparPorMes(historico), [historico])
  const feitos = historico.filter((a) => a.status === 'concluido').length
  // remarcar é um pedido de troca: o fluxo de marcar, a partir da data (sem o passo do serviço)
  const remarcar = (a: Agendamento) => router.push({ pathname: '/agendar/data', params: { prof: a.professional_id ?? '', servico: a.service_id ?? '', remarcar: a.id } })
  const deNovo = (a: Agendamento) => router.push({ pathname: '/agendar/servicos', params: { prof: a.professionals?.id ?? '', servico: a.service_id ?? '' } })

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={t.acento} colors={[t.acento]} />}
      >
        <Cabecalho titulo="Horários" sub="O que vem e o que já foi" />

        <View style={[e.abas, { backgroundColor: t.superficie2 }]}>
          <Segmento ativo={aba === 'proximos'} onPress={() => setAba('proximos')} texto={`Próximos${proximos?.length ? ` · ${proximos.length}` : ''}`} />
          <Segmento ativo={aba === 'historico'} onPress={() => setAba('historico')} texto={`Histórico${feitos ? ` · ${feitos}` : ''}`} />
        </View>

        {erro ? <Aviso tom="erro" texto={erro} /> : null}
        {proximos === null && !erro ? <Carregando texto="Buscando seus horários…" /> : null}

        {aba === 'proximos' && proximos ? (
          <>
            {vagas.map((v) => (
              <Cartao key={v.id} tom="acento">
                <Text style={[e.forte, { color: t.texto }]}>Abriu uma vaga para você</Text>
                <Text style={{ color: t.texto2 }}>
                  {v.waitlist_entries?.services?.name ?? 'Seu serviço'}
                  {v.waitlist_entries?.professionals?.name ? ` com ${v.waitlist_entries.professionals.name}` : ''}. Responde antes que passe para a próxima da fila.
                </Text>
                <Botao titulo="Ver a vaga" icone="flash-outline" onPress={() => abrir('/cliente/meus-agendamentos', 'Meus agendamentos')} />
              </Cartao>
            ))}
            {propostas.length > 0 ? (
              <Cartao tom="acento">
                <Text style={[e.forte, { color: t.texto }]}>A profissional sugeriu um horário novo</Text>
                <Text style={{ color: t.texto2 }}>
                  {propostas.length === 1 ? 'Tem uma proposta esperando a sua resposta.' : `Tem ${propostas.length} propostas esperando a sua resposta.`}
                </Text>
                <Botao titulo="Responder" icone="swap-horizontal-outline" onPress={() => abrir('/cliente/meus-agendamentos', 'Meus agendamentos')} />
              </Cartao>
            ) : null}

            {proximos.length === 0 ? (
              <Vazio titulo="Nada marcado por enquanto" texto="Escolha uma profissional e um horário. Leva menos de um minuto.">
                <Botao titulo="Marcar um horário" icone="add-circle-outline" onPress={() => router.push('/agendar/profissional')} />
              </Vazio>
            ) : null}

            {destaque ? (
              <Destaque a={destaque} troca={trocaAberta(destaque)} onPress={() => abrir(`/cliente/agendamento/${destaque.id}`, 'Agendamento')} onRemarcar={podeRemarcar(destaque) && !trocaAberta(destaque) ? () => remarcar(destaque) : undefined} />
            ) : null}

            {restantes.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text style={[e.secao, { color: t.texto2 }]}>Depois</Text>
                {restantes.map((a) => (
                  <Linha key={a.id} a={a} troca={trocaAberta(a)} onPress={() => abrir(`/cliente/agendamento/${a.id}`, 'Agendamento')} onRemarcar={podeRemarcar(a) && !trocaAberta(a) ? () => remarcar(a) : undefined} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {aba === 'historico' && proximos ? (
          historico.length === 0 ? (
            <Vazio mostrarMel={false} titulo="Seu histórico começa no primeiro atendimento" texto="Depois de cada visita você pode avaliar e marcar de novo por aqui." />
          ) : (
            meses.map(([mes, itens]) => {
              const n = itens.filter((a) => a.status === 'concluido').length
              return (
                <View key={mes} style={{ gap: 10 }}>
                  <Text style={[e.secao, { color: t.texto2 }]}>
                    {mes}
                    {n ? ` · ${n} ${n === 1 ? 'atendimento' : 'atendimentos'}` : ''}
                  </Text>
                  {itens.map((a) => (
                    <Linha key={a.id} a={a} historico nota={notas.get(a.id)} onPress={() => abrir(`/cliente/agendamento/${a.id}`, 'Agendamento')} onDeNovo={a.professionals && a.service_id ? () => deNovo(a) : undefined} />
                  ))}
                </View>
              )
            })
          )
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function Segmento({ ativo, texto, onPress }: { ativo: boolean; texto: string; onPress: () => void }) {
  const t = useTema()
  return (
    <Pressable onPress={onPress} style={[e.segmento, ativo && { backgroundColor: t.superficie, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}>
      <Text style={[e.segmentoTexto, { color: ativo ? t.texto : t.texto2 }]}>{texto}</Text>
    </Pressable>
  )
}

// o próximo horário, grande, com o que ela precisa saber de bate-pronto
function Destaque({ a, troca, onPress, onRemarcar }: { a: Agendamento; troca?: Agendamento; onPress: () => void; onRemarcar?: () => void }) {
  const t = useTema()
  const preco = precoDe(a)
  const min = minutosDe(a)
  return (
    <Cartao onPress={onPress} estilo={{ borderColor: t.acento, borderWidth: 1.5 }}>
      <View style={e.entreLinhas}>
        <Selo texto={a.status === 'pendente' ? 'Aguardando confirmação' : 'Seu próximo horário'} tom={a.status === 'pendente' ? 'aviso' : 'acento'} />
        <Text style={{ color: t.texto2, fontWeight: '600' }}>{emQuanto(a.date)}</Text>
      </View>
      <View style={e.corpo}>
        <View style={[e.data, { backgroundColor: t.veu }]}>
          <Text style={[e.dataDia, { color: t.acento }]}>{diaNumero(a.date)}</Text>
          <Text style={[e.dataMes, { color: t.acento }]}>{mesCurto(a.date)}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[e.servico, { color: t.texto }]} numberOfLines={2}>
            {nomeDoServico(a)}
          </Text>
          <Text style={{ color: t.texto2 }}>
            {diaSemana(a.date)} às {hora(a.start_time)}
            {min ? ` · ${formatDuracao(min)}` : ''}
          </Text>
          {a.salons?.name ? (
            <Text style={{ color: t.texto2 }} numberOfLines={1}>
              {a.salons.name}
              {a.salons.city ? ` · ${a.salons.city}` : ''}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[e.entreLinhas, { borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 }]}>
        <View style={e.prof}>
          <Avatar url={a.professionals?.photo_url} nome={a.professionals?.name} tamanho={32} />
          <Text style={{ color: t.texto2 }}>
            com <Text style={{ color: t.texto, fontWeight: '700' }}>{a.professionals?.name ?? 'a profissional'}</Text>
          </Text>
        </View>
        {preco != null ? <Text style={[e.preco, { color: t.texto }]}>{formatPreco(preco)}</Text> : null}
      </View>
      {troca ? <Nota icone="repeat-outline" texto={`Você pediu para mudar para ${dataCurta(troca.date)} às ${hora(troca.start_time)}. Aguardando a profissional.`} /> : null}
      <View style={e.acoes}>
        <Botao titulo="Ver detalhes" onPress={onPress} estilo={e.acao} />
        {onRemarcar ? <Botao titulo="Remarcar" tipo="fantasma" icone="repeat-outline" onPress={onRemarcar} estilo={e.acao} /> : null}
      </View>
    </Cartao>
  )
}

function Linha({ a, troca, historico = false, nota, onPress, onRemarcar, onDeNovo }: { a: Agendamento; troca?: Agendamento; historico?: boolean; nota?: number; onPress: () => void; onRemarcar?: () => void; onDeNovo?: () => void }) {
  const t = useTema()
  const troca_ = ehPedidoDeTroca(a)
  const min = minutosDe(a)
  const preco = precoDe(a)
  const apagado = historico && a.status !== 'concluido'
  return (
    <Cartao onPress={onPress} estilo={e.linha}>
      <View style={[e.dataMini, { backgroundColor: t.superficie2 }]}>
        <Text style={[e.dataMiniSem, { color: t.texto3 }]}>{diaSemana(a.date).slice(0, 3)}</Text>
        <Text style={[e.dataMiniDia, { color: apagado ? t.texto3 : t.texto }]}>{diaNumero(a.date)}</Text>
        <Text style={[e.dataMiniMes, { color: t.texto2 }]}>{mesCurto(a.date)}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={e.entreLinhas}>
          <Text style={{ color: t.texto2, fontSize: 13, fontWeight: '600' }}>
            {hora(a.start_time)}
            {min ? ` · ${formatDuracao(min)}` : ''}
          </Text>
          <Selo
            texto={troca_ ? 'Troca aguardando' : (ROTULO[a.status] ?? a.status)}
            tom={a.status === 'confirmado' || a.status === 'concluido' ? 'ok' : a.status === 'pendente' ? 'aviso' : 'neutro'}
          />
        </View>
        <Text style={[e.linhaServico, { color: apagado ? t.texto2 : t.texto }]} numberOfLines={2}>
          {nomeDoServico(a)}
        </Text>
        <View style={e.prof}>
          <Avatar url={a.professionals?.photo_url} nome={a.professionals?.name} tamanho={22} />
          <Text style={{ color: t.texto2, fontSize: 13, flex: 1 }} numberOfLines={1}>
            {a.professionals?.name ?? 'Profissional'}
            {a.salons?.name ? ` · ${a.salons.name}` : ''}
          </Text>
          {preco != null ? <Text style={{ color: t.texto, fontWeight: '700', fontSize: 13 }}>{formatPreco(preco)}</Text> : null}
        </View>
        {ajustadoNoSalao(a) ? <Nota icone="sparkles-outline" texto={`Ajustado no salão: você tinha marcado ${a.services?.name}.`} /> : null}
        {historico && a.status === 'cancelado' ? <Nota icone="close-circle-outline" texto={quemCancelou(a) ?? 'Cancelado'} /> : null}
        {historico && a.status === 'concluido' && nota ? <Estrelas nota={nota} /> : null}
        {troca_ && a.origem ? <Nota icone="repeat-outline" texto={`No lugar de ${dataCurta(a.origem.date)} às ${hora(a.origem.start_time)}. Até ela responder, o de antes continua valendo.`} /> : null}
        {troca ? <Nota icone="repeat-outline" texto={`Você pediu para mudar para ${dataCurta(troca.date)} às ${hora(troca.start_time)}. Aguardando a profissional.`} /> : null}
        {onRemarcar || onDeNovo ? (
          <View style={e.chips}>
            {onRemarcar ? <Chip texto="Remarcar" onPress={onRemarcar} /> : null}
            {onDeNovo ? <Chip texto="Marcar de novo" onPress={onDeNovo} /> : null}
          </View>
        ) : null}
      </View>
    </Cartao>
  )
}

function Nota({ icone, texto }: { icone: React.ComponentProps<typeof Ionicons>['name']; texto: string }) {
  const t = useTema()
  return (
    <View style={e.nota}>
      <Ionicons name={icone} size={13} color={t.texto3} style={{ marginTop: 2 }} />
      <Text style={{ color: t.texto2, fontSize: 12.5, lineHeight: 17, flex: 1 }}>{texto}</Text>
    </View>
  )
}

function Estrelas({ nota }: { nota: number }) {
  const t = useTema()
  return (
    <View style={[e.nota, { alignItems: 'center' }]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= nota ? 'star' : 'star-outline'} size={13} color={n <= nota ? '#f5a623' : t.texto3} />
      ))}
      <Text style={{ color: t.texto3, fontSize: 12 }}> sua avaliação</Text>
    </View>
  )
}

function agruparPorMes(itens: Agendamento[]): [string, Agendamento[]][] {
  const m = new Map<string, Agendamento[]>()
  for (const a of itens) {
    const [ano, mes] = a.date.split('-').map(Number)
    const nome = MESES[(mes ?? 1) - 1] ?? ''
    const rotulo = `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`
    if (!m.has(rotulo)) m.set(rotulo, [])
    m.get(rotulo)!.push(a)
  }
  return [...m.entries()]
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 14, paddingBottom: 32 },
  forte: { fontSize: 16, fontWeight: '800' },
  abas: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 3 },
  segmento: { flex: 1, minHeight: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentoTexto: { fontSize: 14, fontWeight: '700' },
  secao: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  entreLinhas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  corpo: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  data: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dataDia: { fontSize: 26, fontWeight: '800', lineHeight: 30 },
  dataMes: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  servico: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  prof: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  preco: { fontSize: 16, fontWeight: '800' },
  linha: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 },
  dataMini: { width: 52, paddingVertical: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dataMiniSem: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  dataMiniDia: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  dataMiniMes: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  linhaServico: { fontSize: 15.5, fontWeight: '700' },
  nota: { flexDirection: 'row', gap: 5, alignItems: 'flex-start', marginTop: 2 },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 2 },
  acao: { flex: 1, minHeight: 42 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 6 },
})
