import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Botao, Cabecalho, Cartao, Carregando, Selo, Vazio } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { diaNumero, diaSemana, emQuanto, formatDuracao, formatPreco, hora, mesCurto, primeiroNome, saudacao, toISODate } from '@/lib/formato'
import { useAbrirWeb } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Meus horários: a mesma consulta da web (ClienteAgenda), em tela nativa.
// Detalhe, remarcar, cancelar e o histórico abrem na ponte: a web já sabe fazer.
type Agendamento = {
  id: string
  date: string
  start_time: string
  end_time: string | null
  status: string
  service_name: string | null
  price_cents: number | null
  remarca_de: string | null
  services: { name: string; price: number | null; duration_minutes: number | null } | null
  professionals: { id: string; name: string; photo_url: string | null } | null
  salons: { name: string; city: string | null; tipo: string | null } | null
  appointment_offers: { id: string; status: string; expires_at: string | null }[] | null
}

const SELECAO =
  '*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (name, city, tipo), appointment_offers (id, status, proposed_start_time, previous_start_time, expires_at)'
const ROTULO: Record<string, string> = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', faltou: 'Não fui', cancelado: 'Cancelado' }

// o nome que vale é o do atendimento (o salão pode ter juntado serviços na visita)
const nomeDoServico = (a: Agendamento) => a.service_name || a.services?.name || 'Atendimento'
const precoDe = (a: Agendamento) => (a.price_cents != null ? a.price_cents / 100 : a.services?.price)
const temProposta = (a: Agendamento) =>
  (a.appointment_offers ?? []).some((o) => o.status === 'pendente' && (!o.expires_at || new Date(o.expires_at) > new Date()))

export default function Horarios() {
  const t = useTema()
  const router = useRouter()
  const abrir = useAbrirWeb()
  const { usuario, perfil } = useSessao()
  const [itens, setItens] = useState<Agendamento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const carregar = useCallback(async () => {
    if (!usuario) return
    const { data, error } = await supabase
      .from('appointments')
      .select(SELECAO)
      .eq('client_id', usuario.id)
      .gte('date', toISODate(new Date()))
      .neq('status', 'cancelado')
      .order('date')
      .order('start_time')
    if (error) {
      setErro('Não deu para carregar seus horários. Puxa para baixo para tentar de novo.')
      return
    }
    setErro(null)
    setItens((data ?? []) as Agendamento[])
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

  const nome = primeiroNome(perfil?.full_name)
  const proximo = itens?.[0]
  const depois = itens?.slice(1) ?? []
  const propostas = (itens ?? []).filter(temProposta).length

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={t.acento} colors={[t.acento]} />}
      >
        <Cabecalho
          titulo={nome ? `${saudacao()}, ${nome}!` : `${saudacao()}!`}
          sub="Seus próximos horários"
          direita={<Avatar url={perfil?.avatar_url} nome={perfil?.full_name} tamanho={40} />}
        />

        {propostas > 0 ? (
          <Cartao tom="acento">
            <Text style={[e.forte, { color: t.texto }]}>A profissional sugeriu um horário novo</Text>
            <Text style={{ color: t.texto2 }}>
              {propostas === 1 ? 'Tem uma proposta esperando a sua resposta.' : `Tem ${propostas} propostas esperando a sua resposta.`}
            </Text>
            <Botao titulo="Responder" icone="swap-horizontal-outline" onPress={() => abrir('/cliente/meus-agendamentos', 'Meus agendamentos')} />
          </Cartao>
        ) : null}

        {erro ? <Aviso tom="erro" texto={erro} /> : null}
        {itens === null && !erro ? <Carregando texto="Buscando seus horários…" /> : null}

        {itens && itens.length === 0 ? (
          <Vazio titulo="Nada marcado por enquanto" texto="Que tal já garantir o seu próximo horário? Leva um minuto.">
            <Botao titulo="Agendar" icone="add-circle-outline" onPress={() => abrir('/cliente/home', 'Agendar')} />
            <Botao titulo="Entrar num salão" tipo="fantasma" icone="qr-code-outline" onPress={() => router.push('/saloes')} />
          </Vazio>
        ) : null}

        {proximo ? <Destaque a={proximo} onPress={() => abrir(`/cliente/agendamento/${proximo.id}`, 'Agendamento')} /> : null}

        {depois.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={[e.secao, { color: t.texto2 }]}>Depois</Text>
            {depois.map((a) => (
              <Item key={a.id} a={a} onPress={() => abrir(`/cliente/agendamento/${a.id}`, 'Agendamento')} />
            ))}
          </View>
        ) : null}

        {itens && itens.length > 0 ? (
          <View style={e.acoes}>
            <Botao titulo="Agendar outro" icone="add-circle-outline" onPress={() => abrir('/cliente/home', 'Agendar')} />
            <Botao titulo="Ver histórico" tipo="linha" icone="time-outline" onPress={() => abrir('/cliente/meus-agendamentos?aba=historico', 'Histórico')} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

// o próximo horário, grande, com o que ela precisa saber de bate-pronto
function Destaque({ a, onPress }: { a: Agendamento; onPress: () => void }) {
  const t = useTema()
  const preco = precoDe(a)
  const duracao = a.services?.duration_minutes
  return (
    <Cartao onPress={onPress} estilo={{ borderColor: t.acento, borderWidth: 1.5 }}>
      <View style={e.entreLinhas}>
        <Selo
          texto={a.status === 'pendente' ? 'Aguardando confirmação' : 'Seu próximo horário'}
          tom={a.status === 'pendente' ? 'aviso' : 'acento'}
        />
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
            {duracao ? ` · ${formatDuracao(duracao)}` : ''}
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
      {a.remarca_de && a.status === 'pendente' ? (
        <Text style={{ color: t.texto2, fontSize: 13 }}>Pedido de troca de horário: aguardando a profissional.</Text>
      ) : null}
    </Cartao>
  )
}

function Item({ a, onPress }: { a: Agendamento; onPress: () => void }) {
  const t = useTema()
  return (
    <Cartao onPress={onPress} estilo={e.item}>
      <View style={[e.dataMini, { backgroundColor: t.superficie2 }]}>
        <Text style={[e.dataMiniDia, { color: t.texto }]}>{diaNumero(a.date)}</Text>
        <Text style={[e.dataMiniMes, { color: t.texto2 }]}>{mesCurto(a.date)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[e.itemServico, { color: t.texto }]} numberOfLines={1}>
          {nomeDoServico(a)}
        </Text>
        <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>
          {diaSemana(a.date)} às {hora(a.start_time)}
          {a.professionals?.name ? ` · ${a.professionals.name}` : ''}
        </Text>
      </View>
      <Selo texto={ROTULO[a.status] ?? a.status} tom={a.status === 'confirmado' ? 'ok' : a.status === 'pendente' ? 'aviso' : 'neutro'} />
    </Cartao>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 14, paddingBottom: 32 },
  forte: { fontSize: 16, fontWeight: '800' },
  secao: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  acoes: { gap: 10, marginTop: 6 },
  entreLinhas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  corpo: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  data: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dataDia: { fontSize: 26, fontWeight: '800', lineHeight: 30 },
  dataMes: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  servico: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  prof: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  preco: { fontSize: 16, fontWeight: '800' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  dataMini: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dataMiniDia: { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  dataMiniMes: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  itemServico: { fontSize: 15, fontWeight: '700' },
})
