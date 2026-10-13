import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { MODOS, POLITICAS, agruparPorCategoria, linksDeRota, textoSinal } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Carregando, Cartao, Chip, Selo, Vazio } from '@/components/ui'
import { useCategorias } from '@/lib/agendar'
import { hora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// A página do salão (a mesma da web, ClienteSalao): fotos, descrição,
// contatos, horário, a equipe, os serviços por categoria e as promoções da
// casa. Tudo leva a marcar com alguém.
export type Equipe = { id: string; nome: string; foto: string | null; bio: string | null; faz: string[] | null; nota: number | null }
export type ServicoDoSalao = { id: string; name: string; price: number; duration_minutes: number; images: string[] | null; description: string | null; is_combo: boolean; categoria_id: string | null; destaque: boolean; a_partir: boolean | null; quem: { id: string; nome: string; foto: string | null; preco_cents: number | null; duracao_minutos: number | null }[] | null }
export type PaginaDoSalao = {
  salao: { id: string; nome: string; tipo: string | null; descricao: string | null; fotos: string[] | null; logo_url: string | null; endereco: string | null; cidade: string | null; lat: number | null; lng: number | null; telefone: string | null; whatsapp: string | null; instagram: string | null; pagamento: { modo: string; sinal_pct: number; politica: string | null } | null; aceita: boolean | null } | null
  horarios: { weekday: number; open: boolean; start_time: string; end_time: string }[] | null
  nota: { media: number | null; quantas: number } | null
  equipe: Equipe[] | null
  servicos: ServicoDoSalao[] | null
  capas: Record<string, string[]> | null
  preferida: string | null
  promocoes: { id: string; titulo: string; texto: string | null; imagem_url: string | null; service_id: string | null; professional_id: string | null; desconto_pct: number | null }[] | null
}
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
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

export default function Salao() {
  const t = useTema()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { id } = useLocalSearchParams<{ id: string }>()
  const cats = useCategorias()
  const [pg, setPg] = useState<PaginaDoSalao | null | undefined>(undefined)
  const [foto, setFoto] = useState(0)
  const [aba, setAba] = useState<'servicos' | 'equipe' | 'sobre'>('servicos')
  const [descAberta, setDescAberta] = useState(false)

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
  const endereco = [s.endereco, s.cidade].filter(Boolean).join(' · ')
  const rotas = linksDeRota({ lat: s.lat, lng: s.lng, nome: s.nome, endereco: s.endereco, cidade: s.cidade }) as { google: string; waze: string; apple: string | null } | null
  const zap = s.whatsapp ? 'https://wa.me/55' + String(s.whatsapp).replace(/\D/g, '').replace(/^55/, '') : null
  const insta = s.instagram ? 'https://instagram.com/' + String(s.instagram).replace(/^@/, '') : null
  const hoje = new Date().getDay()
  const horarios = pg.horarios ?? []
  const equipe = pg.equipe ?? []
  // o que ninguém faz não dá para marcar: fica fora da vitrine
  const servicos = (pg.servicos ?? []).filter((x) => (x.quem ?? []).length > 0)
  const promos = pg.promocoes ?? []
  const preferida = pg.preferida ? equipe.find((p) => p.id === pg.preferida) : null
  const grupos = agruparPorCategoria(servicos, cats) as { id: string; nome: string; itens: ServicoDoSalao[] }[]
  const pag = s.pagamento
  const abrirLink = (u: string) => Linking.openURL(u).catch(() => {})
  const aoRolar = (ev: NativeSyntheticEvent<NativeScrollEvent>) => setFoto(Math.round(ev.nativeEvent.contentOffset.x / largura))

  return (
    <Tela titulo={s.nome}>
      <View style={e.capa}>
        {fotos.length ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={aoRolar} scrollEventThrottle={32}>
            {fotos.map((f) => (
              <Image key={f} source={{ uri: f }} style={{ width: largura, height: 210 }} contentFit="cover" transition={200} />
            ))}
          </ScrollView>
        ) : (
          <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={[StyleSheet.absoluteFill, e.centro]}>
            <Ionicons name="storefront-outline" size={56} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        )}
        {fotos.length > 1 ? (
          <View style={e.pontos}>
            {fotos.map((f, i) => (
              <View key={f} style={[e.ponto, { backgroundColor: i === foto ? '#fff' : 'rgba(255,255,255,0.5)', width: i === foto ? 16 : 6 }]} />
            ))}
          </View>
        ) : null}
        {s.logo_url ? <Image source={{ uri: s.logo_url }} style={[e.logo, { borderColor: t.superficie }]} contentFit="cover" /> : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[e.nome, { color: t.texto }]}>{s.nome}</Text>
        {s.aceita === false ? <Text style={{ color: t.aviso, fontSize: 13.5, lineHeight: 19 }}>Este salão não está recebendo agendamentos novos pelo app no momento. Os horários já marcados continuam valendo.</Text> : null}
        {pag && pag.modo !== 'nao' ? (
          <View style={{ gap: 4 }}>
            <Selo texto={MODOS[pag.modo as keyof typeof MODOS]?.curto ?? 'Paga pelo app'} tom="acento" />
            <Text style={{ color: t.texto2, fontSize: 13 }}>
              {textoSinal(pag.sinal_pct)} por PIX ao marcar
              {pag.politica && POLITICAS[pag.politica as keyof typeof POLITICAS] ? ` · cancelamento ${POLITICAS[pag.politica as keyof typeof POLITICAS]!.rotulo.toLowerCase()}: devolve até ${POLITICAS[pag.politica as keyof typeof POLITICAS]!.horas} h antes` : ''}
            </Text>
          </View>
        ) : null}
        {endereco ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="location-outline" size={14} color={t.texto3} />
            <Text style={{ color: t.texto2, fontSize: 13.5, flex: 1 }}>{endereco}</Text>
          </View>
        ) : null}
        {rotas ? (
          <View style={e.chips}>
            <Chip texto="Google Maps" onPress={() => abrirLink(rotas.google)} />
            <Chip texto="Waze" onPress={() => abrirLink(rotas.waze)} />
            {rotas.apple && Platform.OS === 'ios' ? <Chip texto="Apple Maps" onPress={() => abrirLink(rotas.apple!)} /> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="star" size={14} color="#f5a623" />
          {nota ? (
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>
              <Text style={{ color: t.texto, fontWeight: '800' }}>{Number(nota.media).toFixed(1)}</Text> ({nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'} da equipe)
            </Text>
          ) : (
            <Text style={{ color: t.texto3, fontSize: 13.5 }}>Ainda sem avaliações</Text>
          )}
        </View>
        <View style={e.chips}>
          {zap ? <Chip texto="WhatsApp" onPress={() => abrirLink(zap)} /> : null}
          {s.telefone && !zap ? <Chip texto="Ligar" onPress={() => abrirLink(`tel:${String(s.telefone).replace(/\D/g, '')}`)} /> : null}
          {insta ? <Chip texto={`@${String(s.instagram).replace(/^@/, '')}`} onPress={() => abrirLink(insta)} /> : null}
        </View>
      </View>

      {s.descricao ? (
        <Cartao>
          <Text style={{ color: t.texto, lineHeight: 21 }} numberOfLines={descAberta ? undefined : 4}>
            {s.descricao}
          </Text>
          {s.descricao.length > 180 ? (
            <Pressable onPress={() => setDescAberta((v) => !v)} hitSlop={6}>
              <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>{descAberta ? 'Mostrar menos' : 'Continuar lendo'}</Text>
            </Pressable>
          ) : null}
        </Cartao>
      ) : null}

      {promos.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[e.secao, { color: t.texto }]}>Promoções da casa</Text>
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
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.3 }} end={{ x: 0, y: 1 }} />
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

      <View style={[e.abas, { backgroundColor: t.superficie2 }]}>
        {(
          [
            ['servicos', 'Serviços'],
            ['equipe', 'Equipe'],
            ['sobre', 'Sobre'],
          ] as const
        ).map(([k, r]) => (
          <Pressable key={k} onPress={() => setAba(k)} accessibilityRole="button" accessibilityState={{ selected: aba === k }} style={[e.segmento, aba === k && { backgroundColor: t.superficie }]}>
            <Text style={[e.segmentoTexto, { color: aba === k ? t.texto : t.texto2 }]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      {aba === 'servicos' ? (
        <View style={{ gap: 12 }}>
          {servicos.length === 0 ? <Vazio mostrarMel={false} titulo="O salão ainda não cadastrou serviços." /> : null}
          {preferida ? (
            <Text style={{ color: t.texto2, fontSize: 13 }}>
              ★ Sua preferida aqui é <Text style={{ fontWeight: '700', color: t.texto }}>{preferida.nome}</Text>.{' '}
              <Text style={{ color: t.acento, fontWeight: '700' }} onPress={() => setAba('equipe')}>
                Trocar
              </Text>
            </Text>
          ) : null}
          {grupos.map((g, k) => (
            <CategoriaCard key={g.id || 'outros'} indice={k} nome={g.nome} imagens={pg.capas?.[g.id] ?? null} quantos={g.itens.length} onPress={() => router.push({ pathname: '/categoria', params: { salao: id, cat: g.id || 'outros' } })} />
          ))}
        </View>
      ) : null}

      {aba === 'equipe' ? (
        <View style={{ gap: 10 }}>
          {equipe.length === 0 ? <Vazio mostrarMel={false} titulo="Ninguém atendendo por aqui ainda." /> : null}
          {equipe.length > 1 ? <Text style={{ color: t.texto2, fontSize: 13, lineHeight: 18 }}>Tem alguém de preferência? Marque a estrela: quando mais de uma faz o mesmo serviço, o app já leva para ela.</Text> : null}
          {equipe.map((p) => (
            <Cartao key={p.id} onPress={() => router.push({ pathname: '/profissional/[id]', params: { id: p.id } })} estilo={[e.linha, pg.preferida === p.id ? { borderColor: t.acento } : null]}>
              <Avatar url={p.foto} nome={p.nome} tamanho={46} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[e.forte, { color: t.texto }]} numberOfLines={1}>
                    {p.nome}
                  </Text>
                  {p.nota ? (
                    <Text style={{ color: t.texto2, fontSize: 12.5 }}>
                      <Ionicons name="star" size={11} color="#f5a623" /> {Number(p.nota).toFixed(1)}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>
                  {pg.preferida === p.id ? 'Sua preferida · ' : ''}
                  {(p.faz ?? []).slice(0, 3).join(' · ') || p.bio || ''}
                </Text>
              </View>
              {equipe.length > 1 ? (
                <Pressable onPress={() => escolherPreferida(pg.preferida === p.id ? null : p.id)} hitSlop={8} accessibilityLabel={pg.preferida === p.id ? 'Tirar a preferência' : `Marcar ${p.nome} como preferida`}>
                  <Ionicons name={pg.preferida === p.id ? 'star' : 'star-outline'} size={22} color={pg.preferida === p.id ? '#f5a623' : t.texto3} />
                </Pressable>
              ) : null}
            </Cartao>
          ))}
        </View>
      ) : null}

      {aba === 'sobre' ? (
        <Cartao estilo={{ gap: 14 }}>
          {endereco ? (
            <Dado icone="location-outline" rotulo="Onde">
              <Text style={[e.forte, { color: t.texto }]}>{s.endereco}</Text>
              {s.cidade ? <Text style={{ color: t.texto2, fontSize: 13.5 }}>{s.cidade}</Text> : null}
            </Dado>
          ) : null}
          {s.telefone || s.whatsapp ? (
            <Dado icone="call-outline" rotulo="Contato">
              {s.telefone ? <Text style={[e.forte, { color: t.texto }]}>{s.telefone}</Text> : null}
              {s.whatsapp && s.whatsapp !== s.telefone ? <Text style={{ color: t.texto2, fontSize: 13.5 }}>WhatsApp {s.whatsapp}</Text> : null}
            </Dado>
          ) : null}
          <Dado icone="time-outline" rotulo="Horário">
            {horarios.length === 0 ? (
              <Text style={{ color: t.texto2, fontSize: 13.5 }}>Cada profissional tem o seu horário.</Text>
            ) : (
              horarios.map((h) => (
                <View key={h.weekday} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: h.weekday === hoje ? t.acento : t.texto, fontWeight: h.weekday === hoje ? '800' : '500' }}>{DIAS[h.weekday]}</Text>
                  <Text style={{ color: h.weekday === hoje ? t.acento : t.texto2, fontWeight: h.weekday === hoje ? '700' : '500' }}>{h.open ? `${hora(h.start_time)} – ${hora(h.end_time)}` : 'fechado'}</Text>
                </View>
              ))
            )}
          </Dado>
        </Cartao>
      ) : null}
    </Tela>
  )
}

// o cartão de uma categoria, estilo capa de revista: a foto de ponta a ponta, o nome grande
export function CategoriaCard({ nome, imagens, quantos, onPress, indice }: { nome: string; imagens: string[] | null; quantos: number; onPress: () => void; indice: number }) {
  const [a, b] = tomDe(nome)
  const foto = imagens?.[0]
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${nome}: ver serviços`} style={({ pressed }) => [e.cat, { opacity: pressed ? 0.9 : 1 }]}>
      {foto ? <Image source={{ uri: foto }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
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

function Dado({ icone, rotulo, children }: { icone: React.ComponentProps<typeof Ionicons>['name']; rotulo: string; children: React.ReactNode }) {
  const t = useTema()
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
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
  capa: { height: 210, borderRadius: 22, overflow: 'hidden', backgroundColor: '#eee' },
  pontos: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  ponto: { height: 6, borderRadius: 3 },
  logo: { position: 'absolute', right: 12, bottom: 12, width: 48, height: 48, borderRadius: 14, borderWidth: 2, backgroundColor: '#fff' },
  nome: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secao: { fontSize: 16, fontWeight: '800' },
  sangria: { marginHorizontal: -ESPACO },
  fileira: { paddingHorizontal: ESPACO, gap: 10 },
  promo: { width: 240, height: 140, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  promoSelo: { position: 'absolute', top: 10, left: 10, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  promoSeloTexto: { color: MARCA.rosaEscuro, fontSize: 12, fontWeight: '800' },
  promoTitulo: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 19 },
  promoSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5 },
  abas: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 3 },
  segmento: { flex: 1, minHeight: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentoTexto: { fontSize: 14, fontWeight: '700' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  forte: { fontSize: 15.5, fontWeight: '700' },
  rotulo: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  cat: { height: 150, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  catNum: { position: 'absolute', top: 12, left: 14, color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  catRotulo: { padding: 14, gap: 2 },
  catNome: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  catConta: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  catIr: { position: 'absolute', right: 12, bottom: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
})
