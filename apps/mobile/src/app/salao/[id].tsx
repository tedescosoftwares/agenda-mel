import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { MODOS, POLITICAS, agruparPorCategoria, linksDeRota, textoSinal, situacaoAgora, precoDoServico, duracaoDoServico, quemFaz, menorPrecoDaCasa, horaCurta } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Botao, Carregando, Chip, Vazio } from '@/components/ui'
import { useCategorias } from '@/lib/agendar'
import { formatDuracao, formatPreco, iniciais, primeiroNome } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// A página do salão (3.79: a mesma da web, src/components/salao/PaginaSalao.jsx): a capa, quem é, se está aberto
// agora, marcar, as ações (WhatsApp, rota, Instagram, compartilhar), as promoções, os destaques, os serviços por
// categoria com preço, a equipe, as avaliações e o "sobre". Tudo leva a marcar com alguém. O app é da cliente
// logada: aqui nada pede conta (na web, a página pública do salão pede).
export type Equipe = { id: string; nome: string; foto: string | null; bio: string | null; faz: string[] | null; nota: number | null; slug?: string | null; especialidade?: string | null; avaliacoes?: number | null }
export type ServicoDoSalao = { id: string; name: string; price: number; duration_minutes: number; images: string[] | null; description: string | null; is_combo: boolean; categoria_id: string | null; destaque: boolean; a_partir: boolean | null; quem: { id: string; nome: string; foto: string | null; preco_cents: number | null; duracao_minutos: number | null }[] | null }
export type Avaliacao = { nota: number; comentario: string | null; quem: string; quando: string; profissional: string | null; servico: string | null }
export type PaginaDoSalao = {
  salao: { id: string; nome: string; tipo: string | null; descricao: string | null; fotos: string[] | null; logo_url: string | null; endereco: string | null; bairro?: string | null; cidade: string | null; lat: number | null; lng: number | null; telefone: string | null; whatsapp: string | null; instagram: string | null; pagamento: { modo: string; sinal_pct: number; politica: string | null } | null; aceita: boolean | null } | null
  horarios: { weekday: number; open: boolean; start_time: string; end_time: string }[] | null
  nota: { media: number | null; quantas: number } | null
  avaliacoes?: Avaliacao[] | null
  equipe: Equipe[] | null
  servicos: ServicoDoSalao[] | null
  capas: Record<string, string[]> | null
  preferida: string | null
  promocoes: { id: string; titulo: string; texto: string | null; imagem_url: string | null; service_id: string | null; professional_id: string | null; desconto_pct: number | null; fim?: string | null }[] | null
}
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const POR_CATEGORIA = 5
const TONS: [string, string][] = [
  [MARCA.rosa, MARCA.roxo],
  [MARCA.roxo, MARCA.rosa2],
  [MARCA.rosa2, '#ff9a6c'],
  ['#7c5cff', MARCA.rosa],
  ['#ff5c8a', '#c86bff'],
  ['#f26b8a', '#8a5cff'],
]
export function tomDe(nome: string): [string, string] {
  let h = 0
  for (const ch of String(nome ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONS[h % TONS.length]!
}

type Grupo = { id: string; nome: string; itens: ServicoDoSalao[] }
type Situacao = { aberto: boolean; texto: string } | null

export default function Salao() {
  const t = useTema()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { id } = useLocalSearchParams<{ id: string }>()
  const cats = useCategorias()
  const rolagem = useRef<ScrollView>(null)
  const ySecao = useRef(0)
  const yCategoria = useRef<Record<string, number>>({})
  const [pg, setPg] = useState<PaginaDoSalao | null | undefined>(undefined)
  const [foto, setFoto] = useState(0)
  const [descAberta, setDescAberta] = useState(false)
  const [abertas, setAbertas] = useState<Record<string, boolean>>({})
  const [todasAvaliacoes, setTodasAvaliacoes] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      supabase.rpc('pagina_do_salao', { salao: id }).then(({ data }) => {
        if (vivo) setPg((data as PaginaDoSalao | null) ?? null)
      })
      return () => {
        vivo = false
      }
    }, [id]),
  )

  async function escolherPreferida(profId: string | null) {
    setPg((x) => (x ? { ...x, preferida: profId } : x))
    await supabase.rpc('escolher_preferida', { salao: id, prof: profId })
  }

  if (pg === undefined) {
    return (
      <Tela titulo="Salão">
        <Carregando />
      </Tela>
    )
  }
  const s = pg?.salao
  if (!pg || !s) {
    return (
      <Tela titulo="Salão">
        <Vazio mostrarMel={false} titulo="Não encontramos esse salão." />
      </Tela>
    )
  }

  const fotos = s.fotos ?? []
  const largura = width - ESPACO * 2
  const nota = pg.nota?.quantas ? pg.nota : null
  const local = [s.bairro, s.cidade].filter(Boolean).join(', ')
  const rotas = linksDeRota({ lat: s.lat, lng: s.lng, nome: s.nome, endereco: s.endereco, cidade: s.cidade }) as { google: string; waze: string; apple: string | null } | null
  const zap = s.whatsapp ? 'https://wa.me/55' + String(s.whatsapp).replace(/\D/g, '').replace(/^55/, '') : null
  const insta = s.instagram ? 'https://instagram.com/' + String(s.instagram).replace(/^@/, '') : null
  const agora = situacaoAgora(pg.horarios) as Situacao
  const hoje = new Date().getDay()
  const horarios = pg.horarios ?? []
  const equipe = pg.equipe ?? []
  // o que ninguém faz não dá para marcar: fica fora da vitrine
  const servicos = (pg.servicos ?? []).filter((x) => (x.quem ?? []).length > 0)
  const grupos = agruparPorCategoria(servicos, cats) as Grupo[]
  const destaques = servicos.filter((x) => x.destaque).slice(0, 8)
  const promos = pg.promocoes ?? []
  const descontoDe = (sid: string) => promos.find((p) => p.service_id === sid && p.desconto_pct)?.desconto_pct ?? null
  const avaliacoes = (pg.avaliacoes ?? []).filter((a) => a.comentario || todasAvaliacoes)
  const menor = menorPrecoDaCasa(servicos) as number | null
  const pag = s.pagamento && s.pagamento.modo !== 'nao' ? s.pagamento : null
  const politica = pag?.politica ? POLITICAS[pag.politica as keyof typeof POLITICAS] : null
  const fechado = s.aceita === false
  const abrirLink = (u: string) => Linking.openURL(u).catch(() => {})
  const aoRolar = (ev: NativeSyntheticEvent<NativeScrollEvent>) => setFoto(Math.round(ev.nativeEvent.contentOffset.x / largura))
  const irPara = (y: number) => rolagem.current?.scrollTo({ y: Math.max(0, y - 8), animated: true })

  // o serviço: com a preferida (se faz), senão a única que faz; a página do serviço escolhe o resto
  function agendar(sv: ServicoDoSalao) {
    const quem = sv.quem ?? []
    const prof = pg?.preferida && quem.some((q) => q.id === pg.preferida) ? pg.preferida : quem.length === 1 ? quem[0]!.id : ''
    router.push({ pathname: '/servico/[id]', params: { id: sv.id, ...(prof ? { prof } : {}) } })
  }
  async function compartilhar() {
    try {
      await Share.share({ message: `${s!.nome}${s!.cidade ? ` · ${s!.cidade}` : ''}, na MIMO` })
    } catch {
      /* ela desistiu */
    }
  }

  return (
    <Tela
      titulo={s.nome}
      rolagem={rolagem}
      rodape={
        !fechado && servicos.length ? (
          <View style={e.pe}>
            <View style={{ flex: 1 }}>
              {menor ? (
                <Text style={{ color: t.texto2, fontSize: 13 }}>
                  a partir de <Text style={{ color: t.texto, fontWeight: '800', fontSize: 15.5 }}>{formatPreco(menor)}</Text>
                </Text>
              ) : null}
              {agora ? <Text style={{ color: agora.aberto ? t.ok : t.texto3, fontSize: 12 }} numberOfLines={1}>{agora.texto}</Text> : null}
            </View>
            <Botao titulo="Agendar" icone="calendar-outline" onPress={() => irPara(ySecao.current)} estilo={{ minWidth: 140 }} />
          </View>
        ) : undefined
      }
    >
      {/* ---- a capa ---- */}
      <View style={e.capa}>
        {fotos.length ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={aoRolar} scrollEventThrottle={32}>
            {fotos.map((f) => (
              <Image key={f} source={{ uri: f }} style={{ width: largura, height: 240 }} contentFit="cover" transition={200} />
            ))}
          </ScrollView>
        ) : (
          <LinearGradient colors={[MARCA.rosa2, MARCA.roxo]} style={[StyleSheet.absoluteFill, e.centro]}>
            <Ionicons name="storefront-outline" size={56} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        )}
        <LinearGradient colors={['rgba(20,8,28,0)', 'rgba(20,8,28,0.4)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.55 }} end={{ x: 0, y: 1 }} pointerEvents="none" />
        {fotos.length > 1 ? (
          <View style={e.pontos}>
            {fotos.map((f, i) => (
              <View key={f} style={[e.ponto, { backgroundColor: i === foto ? '#fff' : 'rgba(255,255,255,0.55)', width: i === foto ? 18 : 7 }]} />
            ))}
          </View>
        ) : null}
      </View>

      {/* ---- quem é ---- */}
      <View style={[e.id, { backgroundColor: t.superficie }]}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={[e.logo, { borderColor: t.superficie }]}>
            {s.logo_url ? (
              <Image source={{ uri: s.logo_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <LinearGradient colors={[MARCA.rosa, MARCA.rosa2]} style={[StyleSheet.absoluteFill, e.centro]}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20 }}>{iniciais(s.nome)}</Text>
              </LinearGradient>
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[e.nome, { color: t.texto }]}>{s.nome}</Text>
            {local ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={13} color={t.texto2} />
                <Text style={{ color: t.texto2, fontSize: 13 }}>{local}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={e.selos}>
          {nota ? (
            <View style={[e.selo, { backgroundColor: t.escuro ? 'rgba(245,166,35,0.16)' : '#fff6e5' }]}>
              <Ionicons name="star" size={12} color="#f5a623" />
              <Text style={[e.seloTexto, { color: t.escuro ? '#fcd38a' : '#6b4a00' }]}>
                {Number(nota.media).toFixed(1)} <Text style={{ fontWeight: '500' }}>({nota.quantas})</Text>
              </Text>
            </View>
          ) : null}
          {agora ? (
            <View style={[e.selo, { backgroundColor: agora.aberto ? t.okVeu : t.superficie2 }]}>
              <View style={[e.bolinha, { backgroundColor: agora.aberto ? t.ok : t.texto3 }]} />
              <Text style={[e.seloTexto, { color: agora.aberto ? t.ok : t.texto2 }]}>{agora.texto}</Text>
            </View>
          ) : null}
          {pag ? (
            <View style={[e.selo, { backgroundColor: t.veu }]}>
              <Ionicons name="wallet-outline" size={12} color={t.acento} />
              <Text style={[e.seloTexto, { color: t.acento }]}>{MODOS[pag.modo as keyof typeof MODOS]?.curto ?? 'Paga pelo app'}</Text>
            </View>
          ) : null}
        </View>
        {fechado ? <Text style={{ color: t.aviso, fontSize: 13.5, lineHeight: 19 }}>Este salão não está recebendo agendamentos novos pelo app no momento. Os horários já marcados continuam valendo.</Text> : null}
        {!fechado && servicos.length ? <Botao titulo="Agendar horário" icone="calendar-outline" onPress={() => irPara(ySecao.current)} /> : null}
        <View style={e.acoes}>
          {zap || s.telefone ? <Acao icone="logo-whatsapp" texto={zap ? 'WhatsApp' : 'Ligar'} onPress={() => abrirLink(zap ?? `tel:${String(s.telefone).replace(/\D/g, '')}`)} /> : null}
          {rotas ? <Acao icone="navigate-outline" texto="Rota" onPress={() => abrirLink(Platform.OS === 'ios' && rotas.apple ? rotas.apple : rotas.google)} /> : null}
          {insta ? <Acao icone="logo-instagram" texto="Instagram" onPress={() => abrirLink(insta)} /> : null}
          <Acao icone="share-social-outline" texto="Compartilhar" onPress={compartilhar} />
        </View>
      </View>

      {/* ---- promoções ---- */}
      {promos.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Titulo icone="pricetag-outline" texto="Promoções da casa" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
            {promos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  supabase.rpc('promocao_clicada', { promo: p.id }).then(() => {})
                  if (p.service_id) router.push({ pathname: '/servico/[id]', params: { id: p.service_id, ...(p.professional_id ? { prof: p.professional_id } : {}) } })
                }}
                style={({ pressed }) => [e.promo, { opacity: pressed ? 0.9 : 1 }]}
              >
                {p.imagem_url ? <Image source={{ uri: p.imagem_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={StyleSheet.absoluteFill} />}
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.3 }} end={{ x: 0, y: 1 }} />
                {p.desconto_pct != null ? (
                  <View style={e.promoSelo}>
                    <Text style={e.promoSeloTexto}>-{p.desconto_pct}%</Text>
                  </View>
                ) : null}
                <View style={{ padding: 12, gap: 2 }}>
                  <Text style={e.promoTitulo} numberOfLines={2}>
                    {p.titulo}
                  </Text>
                  {p.texto ? (
                    <Text style={e.promoSub} numberOfLines={1}>
                      {p.texto}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ---- destaques ---- */}
      {destaques.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Titulo icone="sparkles-outline" texto="Destaques da casa" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
            {destaques.map((sv) => {
              const pr = precoDoServico(sv) as { valor: number; aPartir: boolean }
              const capa = sv.images?.[0] ?? (sv.categoria_id ? pg.capas?.[sv.categoria_id]?.[0] : null) ?? null
              const d = descontoDe(sv.id)
              return (
                <Pressable key={sv.id} disabled={fechado} onPress={() => agendar(sv)} style={({ pressed }) => [e.dest, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.9 : 1 }]}>
                  <View style={[e.destFoto, { backgroundColor: t.veu }]}>
                    {capa ? <Image source={{ uri: capa }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={24} color={t.acento} />}
                    {d ? (
                      <View style={e.destSelo}>
                        <Text style={e.destSeloTexto}>-{d}%</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[e.destNome, { color: t.texto }]} numberOfLines={2}>
                    {sv.name}
                  </Text>
                  <Text style={{ color: t.texto2, fontSize: 12 }} numberOfLines={1}>
                    {pr.aPartir ? 'a partir de ' : ''}
                    <Text style={{ color: t.texto, fontWeight: '700' }}>{formatPreco(pr.valor)}</Text> · {formatDuracao(duracaoDoServico(sv) as number)}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ---- serviços ---- */}
      <View style={{ gap: 10 }} onLayout={(ev) => (ySecao.current = ev.nativeEvent.layout.y)}>
        <Titulo icone="sparkles-outline" texto="Serviços" conta={servicos.length || null} />
        {grupos.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={[e.fileira, { gap: 8 }]}>
            {grupos.map((g) => (
              <Chip key={g.id || 'outros'} texto={`${g.nome} · ${g.itens.length}`} onPress={() => irPara(ySecao.current + (yCategoria.current[g.id || 'outros'] ?? 0))} />
            ))}
          </ScrollView>
        ) : null}
        {servicos.length === 0 ? <Vazio mostrarMel={false} titulo="O salão ainda não cadastrou serviços." /> : null}
        {grupos.map((g) => {
          const chave = g.id || 'outros'
          const todos = abertas[chave] || g.itens.length <= POR_CATEGORIA + 1
          const itens = todos ? g.itens : g.itens.slice(0, POR_CATEGORIA)
          const capaCat = g.id ? pg.capas?.[g.id]?.[0] ?? null : null
          return (
            <View key={chave} style={{ gap: 8 }} onLayout={(ev) => (yCategoria.current[chave] = ev.nativeEvent.layout.y)}>
              {grupos.length > 1 ? <Text style={[e.catNomeLista, { color: t.texto2 }]}>{g.nome}</Text> : null}
              <View style={[e.lista, { backgroundColor: t.superficie, borderColor: t.fio }]}>
                {itens.map((sv, i) => {
                  const pr = precoDoServico(sv) as { valor: number; aPartir: boolean }
                  const dur = duracaoDoServico(sv) as number
                  const capa = sv.images?.[0] ?? capaCat
                  const d = descontoDe(sv.id)
                  const com = quemFaz(sv) as string
                  return (
                    <Pressable key={sv.id} disabled={fechado} onPress={() => agendar(sv)} style={({ pressed }) => [e.item, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.fio }, { opacity: pressed ? 0.85 : 1 }]}>
                      <View style={[e.itemFoto, { backgroundColor: t.veu }]}>
                        {capa ? <Image source={{ uri: capa }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={18} color={t.acento} />}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[e.itemNome, { color: t.texto }]} numberOfLines={2}>
                          {sv.name}
                        </Text>
                        <Text style={{ color: t.texto2, fontSize: 12.5 }} numberOfLines={1}>
                          {sv.is_combo ? `~${formatDuracao(dur)}` : formatDuracao(dur)}
                          {com ? ` · ${com}` : ''}
                        </Text>
                        {sv.description ? (
                          <Text style={{ color: t.texto3, fontSize: 12 }} numberOfLines={1}>
                            {sv.description}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 1 }}>
                        {d ? (
                          <View style={e.descSelo}>
                            <Text style={e.descSeloTexto}>-{d}%</Text>
                          </View>
                        ) : null}
                        {pr.aPartir ? <Text style={{ color: t.texto3, fontSize: 10.5 }}>a partir de</Text> : null}
                        <Text style={{ color: t.texto, fontWeight: '800', fontSize: 15 }}>{formatPreco(pr.valor)}</Text>
                        <Text style={{ color: t.acento, fontWeight: '700', fontSize: 12 }}>Agendar ›</Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
              {!todos ? (
                <Pressable onPress={() => setAbertas((x) => ({ ...x, [chave]: true }))} style={[e.mais, { borderColor: t.fio }]}>
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>
                    Ver mais {g.itens.length - POR_CATEGORIA} em {g.nome}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )
        })}
      </View>

      {/* ---- a equipe ---- */}
      {equipe.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Titulo icone="people-outline" texto={equipe.length === 1 ? 'Quem atende' : 'A equipe'} />
          {equipe.length > 1 ? <Text style={{ color: t.texto2, fontSize: 13, lineHeight: 18, marginTop: -4 }}>Marque a estrela da sua preferida: quando mais de uma faz o mesmo serviço, o app já leva para ela.</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
            {equipe.map((p) => {
              const pref = pg.preferida === p.id
              return (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/profissional/[id]', params: { id: p.id } })} style={({ pressed }) => [e.prof, { backgroundColor: t.superficie, borderColor: pref ? t.acento : t.fio, opacity: pressed ? 0.9 : 1 }]}>
                  <Avatar url={p.foto} nome={p.nome} tamanho={64} />
                  <Text style={[e.profNome, { color: t.texto }]} numberOfLines={2}>
                    {p.nome}
                  </Text>
                  {p.nota ? (
                    <Text style={{ color: t.texto, fontSize: 12, fontWeight: '700' }}>
                      <Ionicons name="star" size={11} color="#f5a623" /> {Number(p.nota).toFixed(1)}
                      {p.avaliacoes ? <Text style={{ color: t.texto3, fontWeight: '400' }}> ({p.avaliacoes})</Text> : null}
                    </Text>
                  ) : (
                    <Text style={{ color: t.acento, fontSize: 12 }}>nova na casa</Text>
                  )}
                  <Text style={{ color: t.texto2, fontSize: 11.5, textAlign: 'center' }} numberOfLines={2}>
                    {p.especialidade || (p.faz ?? []).slice(0, 2).join(' · ') || p.bio || ''}
                  </Text>
                  {equipe.length > 1 ? (
                    <Pressable onPress={() => escolherPreferida(pref ? null : p.id)} hitSlop={8} style={[e.estrela, { backgroundColor: pref ? (t.escuro ? 'rgba(245,166,35,0.16)' : '#fff6e5') : t.superficie2 }]} accessibilityLabel={pref ? 'Tirar a preferência' : `Marcar ${p.nome} como preferida`}>
                      <Ionicons name={pref ? 'star' : 'star-outline'} size={16} color={pref ? '#f5a623' : t.texto3} />
                    </Pressable>
                  ) : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ---- avaliações ---- */}
      {nota ? (
        <View style={{ gap: 10 }}>
          <Titulo icone="star-outline" texto="Avaliações" />
          <View style={[e.notaCaixa, { backgroundColor: t.superficie, borderColor: t.fio }]}>
            <Text style={[e.notaGrande, { color: t.texto }]}>{Number(nota.media).toFixed(1)}</Text>
            <View style={{ gap: 3, flex: 1 }}>
              <Estrelas n={Math.round(Number(nota.media))} tamanho={15} />
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>
                {nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'} de quem foi atendida
              </Text>
            </View>
          </View>
          {avaliacoes.slice(0, todasAvaliacoes ? 12 : 3).map((a, i) => (
            <View key={i} style={[e.aval, { backgroundColor: t.superficie, borderColor: t.fio }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[e.avalIni, { backgroundColor: t.veu }]}>
                  <Text style={{ color: t.acento, fontWeight: '800', fontSize: 12 }}>{iniciais(a.quem)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.texto, fontWeight: '700', fontSize: 14 }}>{a.quem}</Text>
                  <Text style={{ color: t.texto2, fontSize: 12 }} numberOfLines={1}>
                    {[a.servico, a.profissional ? `com ${primeiroNome(a.profissional)}` : null].filter(Boolean).join(' ')}
                  </Text>
                </View>
                <Estrelas n={a.nota} tamanho={12} />
              </View>
              {a.comentario ? <Text style={{ color: t.texto, fontSize: 14, lineHeight: 20 }}>{a.comentario}</Text> : null}
              <Text style={{ color: t.texto3, fontSize: 11.5 }}>{new Date(a.quando).toLocaleDateString('pt-BR')}</Text>
            </View>
          ))}
          {!todasAvaliacoes && (pg.avaliacoes ?? []).length > 3 ? (
            <Pressable onPress={() => setTodasAvaliacoes(true)} style={[e.mais, { borderColor: t.fio }]}>
              <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>Ver mais avaliações</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ---- sobre ---- */}
      <View style={{ gap: 10 }}>
        <Titulo icone="storefront-outline" texto={s.tipo === 'autonoma' ? 'Sobre o espaço' : 'Sobre o salão'} />
        {s.descricao ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.texto, lineHeight: 21 }} numberOfLines={descAberta ? undefined : 4}>
              {s.descricao}
            </Text>
            {s.descricao.length > 180 ? (
              <Pressable onPress={() => setDescAberta((v) => !v)} hitSlop={6}>
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>{descAberta ? 'Mostrar menos' : 'Continuar lendo'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={[e.dados, { backgroundColor: t.superficie, borderColor: t.fio }]}>
          {horarios.length > 0 ? (
            <Dado icone="time-outline" rotulo="Horário">
              {agora ? <Text style={{ color: agora.aberto ? t.ok : t.texto2, fontWeight: '700', fontSize: 13 }}>{agora.texto}</Text> : null}
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const h = horarios.find((x) => x.weekday === d)
                return (
                  <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: d === hoje ? t.texto : t.texto2, fontWeight: d === hoje ? '700' : '500' }}>
                      {DIAS[d]}
                      {d === hoje ? <Text style={{ color: t.acento, fontWeight: '500' }}> · hoje</Text> : null}
                    </Text>
                    <Text style={{ color: d === hoje ? t.texto : t.texto2, fontWeight: d === hoje ? '700' : '500' }}>{h?.open ? `${horaCurta(h.start_time)} às ${horaCurta(h.end_time)}` : 'fechado'}</Text>
                  </View>
                )
              })}
            </Dado>
          ) : null}
          {s.endereco || s.cidade ? (
            <Dado icone="location-outline" rotulo="Onde" fio={horarios.length > 0}>
              {s.endereco ? <Text style={[e.forte, { color: t.texto }]}>{s.endereco}</Text> : null}
              <Text style={{ color: t.texto2, fontSize: 13.5 }}>{[s.bairro && !String(s.endereco ?? '').includes(s.bairro) ? s.bairro : null, s.cidade].filter(Boolean).join(' · ')}</Text>
              {rotas ? (
                <View style={[e.chips, { marginTop: 4 }]}>
                  <Chip texto="Google Maps" onPress={() => abrirLink(rotas.google)} />
                  <Chip texto="Waze" onPress={() => abrirLink(rotas.waze)} />
                  {rotas.apple && Platform.OS === 'ios' ? <Chip texto="Apple Maps" onPress={() => abrirLink(rotas.apple!)} /> : null}
                </View>
              ) : null}
            </Dado>
          ) : null}
          {pag ? (
            <Dado icone="wallet-outline" rotulo="Pagamento" fio>
              <Text style={{ color: t.texto, fontSize: 14 }}>
                {textoSinal(pag.sinal_pct)} por PIX ao marcar{pag.modo === 'opcional' ? ' (opcional)' : ''}.
              </Text>
              {politica ? (
                <Text style={{ color: t.texto2, fontSize: 13 }}>
                  Cancelamento {politica.rotulo.toLowerCase()}: devolve até {politica.horas} h antes.
                </Text>
              ) : null}
            </Dado>
          ) : null}
          {zap || s.telefone ? (
            <Dado icone="call-outline" rotulo="Contato" fio>
              {zap ? (
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 14 }} onPress={() => abrirLink(zap)}>
                  WhatsApp {s.whatsapp}
                </Text>
              ) : null}
              {s.telefone && s.telefone !== s.whatsapp ? (
                <Text style={{ color: t.texto2, fontSize: 13.5 }} onPress={() => abrirLink(`tel:${String(s.telefone).replace(/\D/g, '')}`)}>
                  Telefone {s.telefone}
                </Text>
              ) : null}
            </Dado>
          ) : null}
        </View>
      </View>

      {/* ---- o rodapé: a MIMO e o guia ---- */}
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 6 }}>
        <Text style={{ color: t.texto2, fontSize: 12.5 }}>
          {s.nome} agenda pela <Text style={{ fontWeight: '800', color: t.texto }}>MIMO</Text>
        </Text>
        <Pressable onPress={() => router.push('/guia')} style={[e.guia, { backgroundColor: t.superficie, borderColor: t.fio }]}>
          <Ionicons name="compass-outline" size={15} color={t.acento} />
          <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Procurando outro serviço? Veja o guia</Text>
        </Pressable>
      </View>
    </Tela>
  )
}

function Titulo({ icone, texto, conta }: { icone: React.ComponentProps<typeof Ionicons>['name']; texto: string; conta?: number | null }) {
  const t = useTema()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Ionicons name={icone} size={17} color={t.acento} />
      <Text style={[e.secao, { color: t.texto }]}>{texto}</Text>
      {conta ? (
        <View style={[e.conta, { backgroundColor: t.superficie2 }]}>
          <Text style={{ color: t.texto2, fontSize: 11.5, fontWeight: '700' }}>{conta}</Text>
        </View>
      ) : null}
    </View>
  )
}

function Acao({ icone, texto, onPress }: { icone: React.ComponentProps<typeof Ionicons>['name']; texto: string; onPress: () => void }) {
  const t = useTema()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={texto} style={({ pressed }) => [e.acao, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={[e.acaoIcone, { backgroundColor: t.veu }]}>
        <Ionicons name={icone} size={20} color={t.acento} />
      </View>
      <Text style={{ color: t.texto2, fontSize: 11.5 }} numberOfLines={1}>
        {texto}
      </Text>
    </Pressable>
  )
}

function Estrelas({ n, tamanho }: { n: number; tamanho: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={`${n} de 5`}>
      {[1, 2, 3, 4, 5].map((k) => (
        <Ionicons key={k} name={k <= n ? 'star' : 'star-outline'} size={tamanho} color="#f5a623" />
      ))}
    </View>
  )
}

// o cartão de uma categoria, estilo capa de revista (a tela da categoria e quem mais usar)
export function CategoriaCard({ nome, imagens, quantos, onPress, indice }: { nome: string; imagens: string[] | null; quantos: number; onPress: () => void; indice: number }) {
  const [a, b] = tomDe(nome)
  const capa = imagens?.[0]
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${nome}: ver serviços`} style={({ pressed }) => [e.cat, { opacity: pressed ? 0.9 : 1 }]}>
      {capa ? <Image source={{ uri: capa }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.35 }} end={{ x: 0, y: 1 }} />
      <Text style={e.catNum}>{String(indice + 1).padStart(2, '0')}</Text>
      <View style={e.catRotulo}>
        <Text style={e.catNome}>{nome}</Text>
        <Text style={e.catConta}>
          {quantos} {quantos === 1 ? 'serviço' : 'serviços'}
        </Text>
      </View>
      <View style={e.catIr}>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </View>
    </Pressable>
  )
}

function Dado({ icone, rotulo, children, fio = false }: { icone: React.ComponentProps<typeof Ionicons>['name']; rotulo: string; children: React.ReactNode; fio?: boolean }) {
  const t = useTema()
  return (
    <View style={[{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12 }, fio && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.fio }]}>
      <Ionicons name={icone} size={18} color={t.acento} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[e.rotulo, { color: t.texto2 }]}>{rotulo}</Text>
        {children}
      </View>
    </View>
  )
}

const e = StyleSheet.create({
  centro: { alignItems: 'center', justifyContent: 'center' },
  capa: { height: 240, borderRadius: 22, overflow: 'hidden', backgroundColor: '#eee' },
  pontos: { position: 'absolute', bottom: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  ponto: { height: 7, borderRadius: 4 },
  id: { marginTop: -60, marginHorizontal: 10, borderRadius: 22, padding: 16, gap: 12, shadowColor: '#1f2026', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  logo: { width: 62, height: 62, borderRadius: 18, overflow: 'hidden', borderWidth: 3, marginTop: -38, backgroundColor: '#fff' },
  nome: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selo: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  seloTexto: { fontSize: 12.5, fontWeight: '700' },
  bolinha: { width: 7, height: 7, borderRadius: 4 },
  acoes: { flexDirection: 'row', justifyContent: 'space-around' },
  acao: { alignItems: 'center', gap: 5, minWidth: 64 },
  acaoIcone: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pe: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secao: { fontSize: 16.5, fontWeight: '800' },
  conta: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  sangria: { marginHorizontal: -ESPACO },
  fileira: { paddingHorizontal: ESPACO, gap: 10 },
  promo: { width: 260, height: 130, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  promoSelo: { position: 'absolute', top: 10, right: 10, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  promoSeloTexto: { color: MARCA.rosaEscuro, fontSize: 12, fontWeight: '800' },
  promoTitulo: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 19 },
  promoSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5 },
  dest: { width: 156, borderRadius: 18, padding: 8, gap: 5, borderWidth: StyleSheet.hairlineWidth },
  destFoto: { height: 108, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  destSelo: { position: 'absolute', top: 6, left: 6, backgroundColor: MARCA.rosa, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  destSeloTexto: { color: '#fff', fontSize: 11, fontWeight: '800' },
  destNome: { fontSize: 14, fontWeight: '700', lineHeight: 18, paddingHorizontal: 2 },
  catNomeLista: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  lista: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  itemFoto: { width: 56, height: 56, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  itemNome: { fontSize: 15, fontWeight: '700', lineHeight: 19 },
  descSelo: { backgroundColor: MARCA.rosa, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  descSeloTexto: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  mais: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 11, alignItems: 'center' },
  prof: { width: 140, borderRadius: 18, borderWidth: 2, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', gap: 4 },
  profNome: { fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  estrela: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  notaCaixa: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  notaGrande: { fontSize: 36, fontWeight: '800', letterSpacing: -1 },
  aval: { padding: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  avalIni: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dados: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 2 },
  forte: { fontSize: 15, fontWeight: '700' },
  rotulo: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  guia: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  cat: { height: 150, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  catNum: { position: 'absolute', top: 12, left: 14, color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  catRotulo: { padding: 14, gap: 2 },
  catNome: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  catConta: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  catIr: { position: 'absolute', right: 12, bottom: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
})
