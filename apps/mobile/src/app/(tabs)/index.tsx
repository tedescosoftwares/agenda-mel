import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Cartao, Selo, type Icone } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { dataCurta, diaNumero, diaSemana, emQuanto, formatDuracao, formatPreco, hora, mesCurto, primeiroNome, saudacao, toISODate } from '@/lib/formato'
import { destinoDoAviso, iconeDoAviso, relativo, type Aviso as AvisoRow } from '@/lib/notificacoes'
import { useAbrirWeb, useIr } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// Início da cliente: a mesma vitrine da web (ClienteHome), em tela nativa.
// O próximo horário em destaque, atalhos, as novidades, as promoções, os
// salões onde ela tem agenda, as profissionais e os serviços em destaque.
// Tudo aqui leva para "marcar com alguém"; o que ainda não é nativo abre na ponte.
type Proximo = {
  id: string
  date: string
  start_time: string
  end_time: string | null
  status: string
  remarca_de: string | null
  service_name: string | null
  services: { name: string; duration_minutes: number | null } | null
  professionals: { id: string; name: string; photo_url: string | null } | null
  salons: { name: string; city: string | null } | null
}
type Profissional = { id: string; nome: string; foto: string | null; especialidade: string | null }
type Agenda = {
  salao: { id: string; nome: string; tipo: string | null; cidade: string | null; logo: string | null }
  trazida_por: { id: string; nome: string } | null
  profissionais: Profissional[] | null
}
type Salao = { id: string; name: string; city: string | null; address: string | null; fotos: string[] | null; logo_url: string | null; tipo: string | null }
type Pagamento = { salon_id: string; modo: string }
type Promo = {
  id: string
  titulo: string
  texto: string | null
  imagem_url: string | null
  salon_id: string | null
  salao: string | null
  professional_id: string | null
  profissional: string | null
  service_id: string | null
  servico: string | null
  fim: string | null
  desconto_pct: number | null
  preco_de: number | null
  preco_por: number | null
}
type Destaque = { id: string; name: string; price: number; duration_minutes: number; images: string[] | null; is_combo: boolean; salao: string | null; quem: { id: string; name: string }[] | null }
type Desconto = { service_id: string; desconto_pct: number; preco_cents: number; preco_com_desconto_cents: number }

const SEL_PROXIMOS = 'id, date, start_time, end_time, status, remarca_de, service_name, services (name, duration_minutes), professionals (id, name, photo_url), salons (name, city)'
const aindaVem = (a: Proximo) => new Date(`${a.date}T${a.end_time || a.start_time}`) > new Date()
const MODO_CURTO: Record<string, string> = { opcional: 'Paga pelo app', obrigatorio: 'Só com pagamento' }
const TONS: [string, string][] = [
  [MARCA.rosa, MARCA.rosa2],
  [MARCA.roxo, MARCA.rosa],
  [MARCA.ameixa, MARCA.roxo],
  [MARCA.rosa2, MARCA.roxo],
]

export default function Inicio() {
  const t = useTema()
  const router = useRouter()
  const abrir = useAbrirWeb()
  const ir = useIr()
  const { usuario, perfil } = useSessao()
  const [proximo, setProximo] = useState<Proximo | null | undefined>(undefined)
  const [agendas, setAgendas] = useState<Agenda[] | null>(null)
  const [saloes, setSaloes] = useState<Record<string, Salao>>({})
  const [pagamentos, setPagamentos] = useState<Record<string, string>>({})
  const [avisos, setAvisos] = useState<AvisoRow[]>([])
  const [naoLidos, setNaoLidos] = useState(0)
  const [promos, setPromos] = useState<Promo[]>([])
  const [destaques, setDestaques] = useState<Destaque[]>([])
  const [descontos, setDescontos] = useState<Record<string, Desconto>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const carregar = useCallback(async () => {
    if (!usuario) return
    const hoje = toISODate(new Date())
    const agora = new Date().toISOString()
    const [px, ag, av, nl, pm, ds] = await Promise.all([
      // "próximo" é o que ainda não terminou e não é um pedido de troca
      supabase.from('appointments').select(SEL_PROXIMOS).eq('client_id', usuario.id).gte('date', hoje).in('status', ['pendente', 'confirmado']).order('date').order('start_time').limit(6),
      supabase.rpc('minhas_agendas'),
      supabase.from('notifications').select('id, kind, title, body, data, action_url, created_at, read_at').is('read_at', null).or(`expires_at.is.null,expires_at.gt.${agora}`).order('created_at', { ascending: false }).limit(3),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null).or(`expires_at.is.null,expires_at.gt.${agora}`),
      supabase.rpc('promocoes_para_mim'),
      supabase.rpc('destaques_para_mim'),
    ])
    if (px.error || ag.error) {
      setErro('Não deu para carregar o seu início. Puxa para baixo para tentar de novo.')
      return
    }
    setErro(null)
    setProximo(((px.data ?? []) as unknown as Proximo[]).find((a) => !a.remarca_de && aindaVem(a)) ?? null)
    const lista = (ag.data ?? []) as Agenda[]
    setAgendas(lista)
    setAvisos((av.data ?? []) as AvisoRow[])
    setNaoLidos(nl.count ?? 0)
    const ps = (pm.data ?? []) as Promo[]
    setPromos(ps)
    if (ps.length) supabase.rpc('promocao_vista', { ids: ps.map((p) => p.id) }).then(() => {})
    const dsl = (ds.data ?? []) as Destaque[]
    setDestaques(dsl)
    if (dsl.length) {
      const { data } = await supabase.rpc('descontos_para_mim', { servicos: dsl.map((d) => d.id) })
      setDescontos(Object.fromEntries(((data ?? []) as Desconto[]).map((d) => [d.service_id, d])))
    }
    // fotos, endereço e forma de pagar dos salões (o resumo da agenda não traz)
    const ids = lista.map((a) => a.salao.id)
    if (ids.length) {
      const [sl, pg] = await Promise.all([
        supabase.from('salons').select('id, name, city, address, fotos, logo_url, tipo').in('id', ids),
        supabase.rpc('pagamento_dos_saloes', { ids }),
      ])
      setSaloes(Object.fromEntries(((sl.data ?? []) as Salao[]).map((s) => [s.id, s])))
      setPagamentos(Object.fromEntries(((pg.data ?? []) as Pagamento[]).map((p) => [p.salon_id, p.modo])))
    }
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

  // "Agendar" abre o fluxo nativo: com quem (se houver mais de uma), serviços, data, hora
  function agendar() {
    if (agendas && agendas.length === 0) return router.push('/saloes')
    router.push('/agendar/profissional')
  }
  function abrirAgenda(ag: Agenda) {
    const p = ag.profissionais?.[0]
    if (ag.salao.tipo === 'autonoma' && p) return abrir(`/cliente/profissional/${p.id}`, p.nome)
    abrir(`/cliente/salao/${ag.salao.id}`, ag.salao.nome)
  }
  function abrirAviso(a: AvisoRow) {
    setAvisos((xs) => xs.filter((x) => x.id !== a.id))
    setNaoLidos((n) => Math.max(0, n - 1))
    supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.id).then(() => {})
    ir(destinoDoAviso(a, 'cliente'), a.title)
  }
  function marcarLidas() {
    setAvisos([])
    setNaoLidos(0)
    supabase.rpc('marcar_avisos_lidos').then(() => {})
  }
  // promoção de um serviço abre a página dele; de uma profissional, o perfil; do salão, a página do salão
  function abrirPromo(p: Promo) {
    supabase.rpc('promocao_clicada', { promo: p.id }).then(() => {})
    if (p.service_id) return abrir(`/cliente/servico/${p.service_id}?${p.professional_id ? `prof=${p.professional_id}&` : ''}de=home`, p.servico ?? p.titulo)
    if (p.professional_id) return abrir(`/cliente/profissional/${p.professional_id}`, p.profissional ?? p.titulo)
    if (p.salon_id) return abrir(`/cliente/salao/${p.salon_id}`, p.salao ?? p.titulo)
    abrir('/cliente/indicacao', p.titulo)
  }

  const nome = primeiroNome(perfil?.full_name)
  const semAgenda = agendas !== null && agendas.length === 0
  // todas as profissionais das agendas dela, sem repetir
  const profissionais = (agendas ?? []).flatMap((a) => a.profissionais ?? []).filter((p, i, xs) => xs.findIndex((o) => o.id === p.id) === i)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={t.acento} colors={[t.acento]} />}
      >
        <View style={e.topo}>
          <Pressable onPress={() => router.push('/perfil')} hitSlop={6}>
            <Avatar url={perfil?.avatar_url} nome={perfil?.full_name ?? usuario?.email} tamanho={46} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[e.saudacao, { color: t.texto2 }]}>{saudacao()},</Text>
            <Text style={[e.nome, { color: t.texto }]} numberOfLines={1}>
              {nome || 'que bom te ver'}
            </Text>
          </View>
          <Sino n={naoLidos} onPress={() => abrir('/cliente/notificacoes', 'Avisos')} />
        </View>

        {erro ? <Aviso tom="erro" texto={erro} /> : null}

        {proximo === undefined && !erro ? (
          <Heroi>
            <ActivityIndicator color="#fff" style={{ paddingVertical: 28 }} />
          </Heroi>
        ) : proximo ? (
          <Heroi onPress={() => router.push({ pathname: '/agendamento/[id]', params: { id: proximo.id } })}>
            <View style={e.entreLinhas}>
              <Text style={e.heroiKicker}>{proximo.status === 'pendente' ? 'Aguardando confirmação' : 'Seu próximo horário'}</Text>
              <View style={e.heroiPilula}>
                <Text style={e.heroiPilulaTexto}>{emQuanto(proximo.date)}</Text>
              </View>
            </View>
            <Text style={e.heroiTitulo} numberOfLines={2}>
              {proximo.service_name || proximo.services?.name || 'Atendimento'}
            </Text>
            <Text style={e.heroiLinha}>
              {diaSemana(proximo.date)}, {diaNumero(proximo.date)} de {mesCurto(proximo.date)} · {hora(proximo.start_time)}
              {proximo.services?.duration_minutes ? ` · ${formatDuracao(proximo.services.duration_minutes)}` : ''}
            </Text>
            <View style={[e.entreLinhas, { marginTop: 6 }]}>
              <View style={e.heroiProf}>
                <View style={e.heroiAvatar}>
                  <Avatar url={proximo.professionals?.photo_url} nome={proximo.professionals?.name} tamanho={34} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={e.heroiProfNome} numberOfLines={1}>
                    com {proximo.professionals?.name ?? 'a profissional'}
                  </Text>
                  {proximo.salons?.name ? (
                    <Text style={e.heroiProfOnde} numberOfLines={1}>
                      {proximo.salons.name}
                      {proximo.salons.city ? ` · ${proximo.salons.city}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={e.heroiSeta}>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </View>
            </View>
          </Heroi>
        ) : semAgenda ? (
          <Heroi>
            <Text style={e.heroiKicker}>Bem-vinda à MIMO</Text>
            <Text style={e.heroiTitulo}>Entre na agenda da sua profissional</Text>
            <Text style={e.heroiLinha}>Com o código ou o QR que ela te mandou você vê os horários dela e marca em um minuto.</Text>
            <BotaoClaro titulo="Tenho um código" icone="qr-code-outline" onPress={() => router.push('/saloes')} />
          </Heroi>
        ) : (
          <Heroi>
            <Text style={e.heroiKicker}>Nada marcado por enquanto</Text>
            <Text style={e.heroiTitulo}>Que tal garantir o seu próximo horário?</Text>
            <Text style={e.heroiLinha}>Escolha a profissional e o horário. Leva menos de um minuto.</Text>
            <BotaoClaro titulo="Agendar agora" icone="add-circle-outline" onPress={agendar} />
          </Heroi>
        )}

        <View style={e.atalhos}>
          <Atalho icone="add-circle-outline" rotulo="Agendar" onPress={agendar} />
          <Atalho icone="calendar-outline" rotulo="Horários" onPress={() => router.push('/horarios')} />
          <Atalho icone="qr-code-outline" rotulo="Entrar num salão" onPress={() => router.push('/saloes')} />
          <Atalho icone="gift-outline" rotulo="Indicar amigas" onPress={() => abrir('/cliente/indicacao', 'Indicar amigas')} />
        </View>

        {avisos.length > 0 ? (
          <View style={e.secao}>
            <Secao titulo="Novidades" conta={naoLidos} acao="Marcar lidas" onAcao={marcarLidas} />
            {avisos.map((a) => (
              <Cartao key={a.id} onPress={() => abrirAviso(a)} estilo={e.novidade}>
                <View style={[e.novidadeIcone, { backgroundColor: t.veu }]}>
                  <Ionicons name={iconeDoAviso(a.kind)} size={18} color={t.acento} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[e.novidadeTitulo, { color: t.texto }]} numberOfLines={1}>
                    {a.title}
                  </Text>
                  {a.body ? (
                    <Text style={{ color: t.texto2, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                      {a.body}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: t.texto3, fontSize: 12 }}>{relativo(a.created_at)}</Text>
              </Cartao>
            ))}
          </View>
        ) : null}

        {promos.length > 0 ? <Promocoes promos={promos} onAbrir={abrirPromo} /> : null}

        {agendas && agendas.length > 0 ? (
          <View style={e.secao}>
            <Secao titulo={agendas.length === 1 && agendas[0]!.salao.tipo === 'autonoma' ? 'Sua profissional' : 'Onde você se cuida'} acao="Ver todos" onAcao={() => router.push('/saloes')} />
            {agendas.map((ag) =>
              ag.salao.tipo === 'autonoma' ? (
                <CartaoAutonoma key={ag.salao.id} ag={ag} onPress={() => abrirAgenda(ag)} />
              ) : (
                <CartaoSalao key={ag.salao.id} ag={ag} salao={saloes[ag.salao.id]} modo={pagamentos[ag.salao.id]} onPress={() => abrirAgenda(ag)} />
              ),
            )}
          </View>
        ) : null}

        {profissionais.length > 1 ? (
          <View style={e.secao}>
            <Secao titulo="Profissionais" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
              {profissionais.map((p) => (
                <Pressable key={p.id} onPress={() => abrir(`/cliente/profissional/${p.id}`, p.nome)} style={({ pressed }) => [e.bolha, { opacity: pressed ? 0.7 : 1 }]}>
                  <Avatar url={p.foto} nome={p.nome} tamanho={64} />
                  <Text style={[e.bolhaNome, { color: t.texto }]} numberOfLines={1}>
                    {primeiroNome(p.nome)}
                  </Text>
                  <Text style={[e.bolhaSub, { color: t.texto2 }]} numberOfLines={1}>
                    {(p.especialidade ?? '').split(' · ')[0]?.split(' e ')[0] ?? ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {destaques.length > 0 ? (
          <View style={e.secao}>
            <Secao titulo="Serviços em destaque" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
              {destaques.map((d, i) => (
                <CartaoServico
                  key={d.id}
                  d={d}
                  desconto={descontos[d.id]}
                  tom={TONS[i % TONS.length]!}
                  mostrarSalao={(agendas?.length ?? 0) > 1}
                  onPress={() => abrir(`/cliente/servico/${d.id}?${d.quem?.length === 1 ? `prof=${d.quem[0]!.id}&` : ''}de=home`, d.name)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

// o cartão grande do topo, no degradê da MIMO
function Heroi({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const miolo = (
    <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={e.heroi}>
      <View style={[e.bolhaDeco, { width: 170, height: 170, top: -60, right: -40 }]} />
      <View style={[e.bolhaDeco, { width: 120, height: 120, bottom: -50, left: -30 }]} />
      {children}
    </LinearGradient>
  )
  if (!onPress) return miolo
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}>
      {miolo}
    </Pressable>
  )
}

function BotaoClaro({ titulo, icone, onPress }: { titulo: string; icone: Icone; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [e.botaoClaro, { opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name={icone} size={18} color={MARCA.rosaEscuro} />
      <Text style={e.botaoClaroTexto}>{titulo}</Text>
    </Pressable>
  )
}

function Sino({ n, onPress }: { n: number; onPress: () => void }) {
  const t = useTema()
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityLabel="Avisos" style={({ pressed }) => [e.sino, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name="notifications-outline" size={22} color={t.texto} />
      {n > 0 ? (
        <View style={[e.sinoBadge, { backgroundColor: t.acento, borderColor: t.fundo }]}>
          <Text style={e.sinoBadgeTexto}>{n > 9 ? '9+' : n}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function Atalho({ icone, rotulo, onPress }: { icone: Icone; rotulo: string; onPress: () => void }) {
  const t = useTema()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [e.atalho, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[e.atalhoIcone, { backgroundColor: t.superficie, borderColor: t.fio }]}>
        <Ionicons name={icone} size={24} color={t.acento} />
      </View>
      <Text style={[e.atalhoRotulo, { color: t.texto }]} numberOfLines={2}>
        {rotulo}
      </Text>
    </Pressable>
  )
}

function Secao({ titulo, conta, acao, onAcao }: { titulo: string; conta?: number; acao?: string; onAcao?: () => void }) {
  const t = useTema()
  return (
    <View style={e.secaoCabeca}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <Text style={[e.secaoTitulo, { color: t.texto }]}>{titulo}</Text>
        {conta ? (
          <View style={[e.conta, { backgroundColor: t.acento }]}>
            <Text style={e.contaTexto}>{conta}</Text>
          </View>
        ) : null}
      </View>
      {acao && onAcao ? (
        <Pressable onPress={onAcao} hitSlop={8}>
          <Text style={[e.secaoAcao, { color: t.acento }]}>{acao}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

// o carrossel de promoções: só o que é de quem ela tem na carteira, mais o que a plataforma manda para todo mundo
function Promocoes({ promos, onAbrir }: { promos: Promo[]; onAbrir: (p: Promo) => void }) {
  const t = useTema()
  const { width } = useWindowDimensions()
  const largura = width - ESPACO * 2
  const [atual, setAtual] = useState(0)
  const aoRolar = (ev: NativeSyntheticEvent<NativeScrollEvent>) => setAtual(Math.round(ev.nativeEvent.contentOffset.x / (largura + 12)))
  return (
    <View style={e.secao}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={largura + 12}
        decelerationRate="fast"
        onScroll={aoRolar}
        scrollEventThrottle={32}
        style={e.sangria}
        contentContainerStyle={e.fileira}
      >
        {promos.map((p) => (
          <Pressable key={p.id} onPress={() => onAbrir(p)} style={({ pressed }) => [e.promo, { width: largura, opacity: pressed ? 0.9 : 1 }]}>
            {p.imagem_url ? <Image source={{ uri: p.imagem_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={StyleSheet.absoluteFill} />}
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.25 }} end={{ x: 0, y: 1 }} />
            {p.desconto_pct != null ? (
              <View style={e.promoSelo}>
                <Text style={e.promoSeloTexto}>-{p.desconto_pct}%</Text>
              </View>
            ) : null}
            <View style={e.promoTexto}>
              <Text style={e.promoTitulo} numberOfLines={2}>
                {p.titulo}
              </Text>
              {p.texto ? (
                <Text style={e.promoSub} numberOfLines={1}>
                  {p.texto}
                </Text>
              ) : null}
              <Text style={e.promoMini} numberOfLines={1}>
                {p.profissional ?? p.salao ?? 'MIMO'}
                {p.preco_por != null ? ` · de ${formatPreco(p.preco_de ?? 0)} por ${formatPreco(p.preco_por)}` : ''}
                {p.fim ? ` · até ${dataCurta(p.fim)}` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {promos.length > 1 ? (
        <View style={e.pontos}>
          {promos.map((p, i) => (
            <View key={p.id} style={[e.ponto, { backgroundColor: i === atual ? t.acento : t.fio, width: i === atual ? 18 : 6 }]} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function CartaoSalao({ ag, salao, modo, onPress }: { ag: Agenda; salao?: Salao; modo?: string; onPress: () => void }) {
  const t = useTema()
  const capa = salao?.fotos?.[0]
  const equipe = ag.profissionais ?? []
  const onde = [salao?.address, salao?.city ?? ag.salao.cidade].filter(Boolean).join(' · ')
  return (
    <Cartao onPress={onPress} estilo={e.salao}>
      <View style={e.salaoCapa}>
        {capa ? <Image source={{ uri: capa }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={[StyleSheet.absoluteFill, e.centro]}><Ionicons name="storefront-outline" size={26} color="#fff" /></LinearGradient>}
        {salao?.logo_url || ag.salao.logo ? <Image source={{ uri: salao?.logo_url ?? ag.salao.logo ?? '' }} style={[e.salaoLogo, { borderColor: t.superficie }]} contentFit="cover" /> : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[e.salaoNome, { color: t.texto }]} numberOfLines={1}>
          {ag.salao.nome}
        </Text>
        {onde ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location-outline" size={13} color={t.texto3} />
            <Text style={{ color: t.texto2, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
              {onde}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <View style={{ flexDirection: 'row' }}>
            {equipe.slice(0, 4).map((p, i) => (
              <View key={p.id} style={[e.equipeFoto, { borderColor: t.superficie, marginLeft: i ? -8 : 0 }]}>
                <Avatar url={p.foto} nome={p.nome} tamanho={24} />
              </View>
            ))}
          </View>
          <Text style={{ color: t.texto2, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
            {equipe.length} {equipe.length === 1 ? 'profissional' : 'profissionais'}
          </Text>
          {modo && MODO_CURTO[modo] ? <Selo texto={MODO_CURTO[modo]!} tom="acento" /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.texto3} />
    </Cartao>
  )
}

function CartaoAutonoma({ ag, onPress }: { ag: Agenda; onPress: () => void }) {
  const t = useTema()
  const p = ag.profissionais?.[0]
  return (
    <Cartao onPress={onPress} estilo={e.salao}>
      <Avatar url={p?.foto} nome={p?.nome ?? ag.salao.nome} tamanho={60} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[e.salaoNome, { color: t.texto }]} numberOfLines={1}>
          {p?.nome ?? ag.salao.nome}
        </Text>
        <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>
          {[p?.especialidade, ag.salao.cidade].filter(Boolean).join(' · ') || 'Autônoma'}
        </Text>
        <Text style={[e.salaoLink, { color: t.acento }]}>Ver horários</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.texto3} />
    </Cartao>
  )
}

function CartaoServico({ d, desconto, tom, mostrarSalao, onPress }: { d: Destaque; desconto?: Desconto; tom: [string, string]; mostrarSalao: boolean; onPress: () => void }) {
  const t = useTema()
  const foto = d.images?.[0]
  const quem = d.quem ?? []
  const sub = [d.duration_minutes ? formatDuracao(d.duration_minutes) : null, quem.length > 1 ? `${quem.length} profissionais` : quem.length === 1 ? `com ${primeiroNome(quem[0]!.name)}` : null].filter(Boolean).join(' · ')
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [e.servico, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.85 : 1 }]}>
      <View style={e.servicoCapa}>
        {foto ? <Image source={{ uri: foto }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={tom} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, e.centro]}><Ionicons name="sparkles" size={34} color="rgba(255,255,255,0.8)" /></LinearGradient>}
        <View style={e.preco}>
          {desconto ? (
            <>
              <Text style={e.precoDe}>{formatPreco(desconto.preco_cents / 100)}</Text>
              <Text style={[e.precoTexto, { color: MARCA.rosaEscuro }]}>{formatPreco(desconto.preco_com_desconto_cents / 100)}</Text>
            </>
          ) : (
            <Text style={e.precoTexto}>{formatPreco(d.price)}</Text>
          )}
        </View>
        {desconto ? (
          <View style={e.servicoSelo}>
            <Text style={e.servicoSeloTexto}>-{desconto.desconto_pct}%</Text>
          </View>
        ) : null}
      </View>
      <View style={e.servicoTexto}>
        <Text style={[e.servicoNome, { color: t.texto }]} numberOfLines={2}>
          {d.name}
        </Text>
        {sub ? (
          <Text style={{ color: t.texto2, fontSize: 12 }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        {mostrarSalao && d.salao ? (
          <Text style={{ color: t.texto3, fontSize: 11.5 }} numberOfLines={1}>
            {d.salao}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 18, paddingBottom: 36 },
  centro: { alignItems: 'center', justifyContent: 'center' },
  entreLinhas: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6 },
  saudacao: { fontSize: 14 },
  nome: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, lineHeight: 28 },
  sino: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sinoBadge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  sinoBadgeTexto: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  heroi: { borderRadius: 24, padding: 18, gap: 6, overflow: 'hidden' },
  bolhaDeco: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  heroiKicker: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  heroiPilula: { backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  heroiPilulaTexto: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroiTitulo: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, lineHeight: 29, marginTop: 2 },
  heroiLinha: { color: 'rgba(255,255,255,0.92)', fontSize: 14.5, lineHeight: 20 },
  heroiProf: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  heroiAvatar: { borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' },
  heroiProfNome: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  heroiProfOnde: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5 },
  heroiSeta: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  botaoClaro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', minHeight: 44, paddingHorizontal: 18, borderRadius: 14, marginTop: 8 },
  botaoClaroTexto: { color: MARCA.rosaEscuro, fontSize: 15, fontWeight: '800' },
  atalhos: { flexDirection: 'row', gap: 8 },
  atalho: { flex: 1, alignItems: 'center', gap: 6 },
  atalhoIcone: { width: 54, height: 54, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  atalhoRotulo: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  secao: { gap: 10 },
  secaoCabeca: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  secaoTitulo: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  secaoAcao: { fontSize: 13.5, fontWeight: '700' },
  conta: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  contaTexto: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  novidade: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 },
  novidadeIcone: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  novidadeTitulo: { fontSize: 14.5, fontWeight: '700' },
  sangria: { marginHorizontal: -ESPACO },
  fileira: { paddingHorizontal: ESPACO, gap: 12 },
  promo: { height: 176, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  promoSelo: { position: 'absolute', top: 12, left: 12, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  promoSeloTexto: { color: MARCA.rosaEscuro, fontSize: 12.5, fontWeight: '800' },
  promoTexto: { padding: 14, gap: 2 },
  promoTitulo: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.3, lineHeight: 22 },
  promoSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13.5 },
  promoMini: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 2 },
  pontos: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  ponto: { height: 6, borderRadius: 3 },
  salao: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  salaoCapa: { width: 92, height: 76, borderRadius: 14, overflow: 'hidden', backgroundColor: '#eee' },
  salaoLogo: { position: 'absolute', right: 5, bottom: 5, width: 26, height: 26, borderRadius: 8, borderWidth: 2, backgroundColor: '#fff' },
  salaoNome: { fontSize: 16, fontWeight: '800' },
  salaoLink: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  equipeFoto: { borderRadius: 999, borderWidth: 2 },
  bolha: { width: 78, alignItems: 'center', gap: 5 },
  bolhaNome: { fontSize: 13, fontWeight: '700' },
  bolhaSub: { fontSize: 11, marginTop: -3 },
  servico: { width: 158, borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  servicoCapa: { height: 118, backgroundColor: '#eee' },
  servicoTexto: { padding: 10, gap: 2 },
  servicoNome: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  servicoSelo: { position: 'absolute', top: 8, right: 8, backgroundColor: MARCA.rosa, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  servicoSeloTexto: { color: '#fff', fontSize: 11, fontWeight: '800' },
  preco: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(255,255,255,0.94)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 5 },
  precoTexto: { color: '#1f2026', fontSize: 12.5, fontWeight: '800' },
  precoDe: { color: '#9a9ea8', fontSize: 11, textDecorationLine: 'line-through' },
})
