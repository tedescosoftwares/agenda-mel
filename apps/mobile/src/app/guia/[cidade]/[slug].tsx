import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { abertoAgora, categoriaDoGuia, conteudoSeguro, fotosDoLugar, horariosResumo, linkInstagram, linkMapa, linkWhatsDoGuia, miniatura } from '@mimo/core/guia.js'
import { Tela } from '@/components/Tela'
import { Aviso, Botao, Cartao, Chip, Selo, Vazio } from '@/components/ui'
import { carregarContato, carregarPagina, entrarPeloGuia, type Cartao as CartaoGuia, type Contato, type Pagina } from '@/lib/guia'
import { distanciaKm, distanciaTexto, posicaoAtual, type Posicao } from '@/lib/localizacao'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// A página de um salão do guia, no app (3.64). Salão que agenda pela MIMO: "Agendar pela MIMO" entra na
// agenda dele (vincular_pelo_guia, com a origem registrada) e abre a página nativa do salão, onde ela marca.
// Salão fora da MIMO: "Quero marcar pela Mel" abre o WhatsApp da MIMO com o pedido pronto (a Mel anota e
// passa ao salão, 3.48); o telefone do salão só aparece quando a Mel está desligada.

const abrir = (url: string | null | undefined) => { if (url) Linking.openURL(url).catch(() => {}) }

export default function LugarDoGuia() {
  const t = useTema()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { cidade, slug } = useLocalSearchParams<{ cidade: string; slug: string }>()
  const [res, setRes] = useState<{ chave: string; pg: Pagina | null } | null>(null)
  const [contato, setContato] = useState<Contato>({ ligado: false })
  const chave = `${cidade ?? ''}/${slug ?? ''}`
  const pg = res && res.chave === chave ? res.pg : undefined
  const [foto, setFoto] = useState(0)
  const [entrando, setEntrando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [posicao, setPosicao] = useState<Posicao | null>(null)

  useEffect(() => {
    let vivo = true
    const minha = `${cidade ?? ''}/${slug ?? ''}`
    carregarPagina(String(cidade ?? ''), String(slug ?? '')).catch(() => null).then((p) => { if (vivo) setRes({ chave: minha, pg: p }) })
    carregarContato().then((c) => { if (vivo) setContato(c) })
    posicaoAtual().then((p) => { if (vivo) setPosicao(p) })
    return () => { vivo = false }
  }, [cidade, slug])

  if (pg === undefined) return <Tela titulo="Salão"><Text style={{ color: t.texto2, textAlign: 'center', paddingTop: 30 }}>Carregando…</Text></Tela>
  if (!pg?.lugar) return <Tela titulo="Salão"><Vazio mostrarMel={false} titulo="Essa página do guia não está mais no ar." /></Tela>

  const l = pg.lugar
  const cat = categoriaDoGuia(l.categoria)
  // as fotos passam pelo filtro do core (só URLs); na demonstração as capas são data: e entram como estão
  const fotos: string[] = fotosDoLugar(l).length ? fotosDoLugar(l) : (Array.isArray(l.fotos) ? l.fotos : l.foto ? [l.foto] : []).filter((f): f is string => typeof f === 'string' && f.startsWith('data:image/'))
  const largura = width - ESPACO * 2
  const c = conteudoSeguro(l.conteudo)
  const horas = horariosResumo(l.horarios ?? null) as { dias: string; horas: string }[]
  const agora = abertoAgora(l.horarios ?? null) as { aberto: boolean; texto: string } | null
  const endereco = [l.endereco, l.bairro, l.cidade ? `${l.cidade}-${l.uf ?? ''}` : null].filter(Boolean).join(' · ')
  const km = posicao ? distanciaKm(posicao, l) : null
  const naMimo = Boolean(l.mimo?.salao_id)
  const servicos = Array.isArray(l.servicos) ? l.servicos : []

  async function agendar() {
    if (!l.mimo?.salao_id || entrando) return
    setEntrando(true); setAviso('')
    const r = await entrarPeloGuia(l.mimo.salao_id, l.id)
    setEntrando(false)
    if (!r.ok) { setAviso(r.motivo ?? 'Não deu para entrar na agenda agora.'); return }
    router.push({ pathname: '/salao/[id]', params: { id: l.mimo.salao_id, de: 'guia' } })
  }

  const whatsSalao = !contato.ligado && l.whatsapp ? `https://wa.me/${String(l.whatsapp).replace(/\D/g, '').replace(/^(?!55)/, '55')}` : null

  return (
    <Tela
      titulo={l.nome}
      rodape={
        naMimo ? (
          <>
            <Botao titulo="Agendar pela MIMO" icone="calendar-outline" onPress={() => { void agendar() }} carregando={entrando} />
            <Text style={{ color: t.texto3, fontSize: 12.5, textAlign: 'center' }}>Você entra na agenda do salão e marca o horário aqui no app.</Text>
          </>
        ) : contato.ligado ? (
          <>
            <Botao titulo="Quero marcar pela Mel" icone="logo-whatsapp" onPress={() => abrir(linkWhatsDoGuia(contato, l))} />
            <Text style={{ color: t.texto3, fontSize: 12.5, textAlign: 'center' }}>A Mel, atendente da MIMO, anota o seu pedido pelo WhatsApp e passa ao salão.</Text>
          </>
        ) : whatsSalao ? (
          <Botao titulo="WhatsApp do salão" icone="logo-whatsapp" onPress={() => abrir(whatsSalao)} />
        ) : undefined
      }
    >
      <View style={e.capa}>
        {fotos.length ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={(ev) => setFoto(Math.round(ev.nativeEvent.contentOffset.x / Math.max(1, largura)))} scrollEventThrottle={32}>
            {fotos.map((f) => <Image key={f} source={{ uri: miniatura(f) }} style={{ width: largura, height: 210 }} contentFit="cover" transition={200} />)}
          </ScrollView>
        ) : (
          <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={[StyleSheet.absoluteFill, e.centro]}>
            <Ionicons name="storefront-outline" size={56} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        )}
        {fotos.length > 1 ? (
          <View style={e.pontos}>{fotos.map((f, i) => <View key={f} style={[e.ponto, { backgroundColor: i === foto ? '#fff' : 'rgba(255,255,255,0.5)', width: i === foto ? 16 : 6 }]} />)}</View>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[e.nome, { color: t.texto }]}>{l.nome}</Text>
        <View style={e.selos}>
          <Selo texto={cat.curto} />
          {naMimo ? <Selo texto="Agenda pela MIMO" tom="acento" /> : null}
          {l.selecao ? <Selo texto="Seleção MIMO" tom="ok" /> : null}
        </View>
        {c?.chamada ? <Text style={{ color: t.texto2, fontSize: 14.5, lineHeight: 20 }}>{c.chamada}</Text> : null}
        {agora ? <Text style={{ color: agora.aberto ? t.ok : t.texto2, fontSize: 13.5, fontWeight: '600' }}>{agora.texto}</Text> : null}
        {endereco ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name="location-outline" size={14} color={t.texto3} />
            <Text style={{ color: t.texto2, fontSize: 13.5, flex: 1 }}>{endereco}{km != null ? ` · a ${distanciaTexto(km)} de você` : ''}</Text>
          </View>
        ) : null}
        <View style={e.chips}>
          {l.endereco || l.bairro ? <Chip texto="Como chegar" onPress={() => abrir(linkMapa(l.nome, [l.endereco, l.bairro, l.cidade].filter(Boolean).join(', ')))} /> : null}
          {l.instagram ? <Chip texto="Instagram" onPress={() => abrir(linkInstagram(String(l.instagram)))} /> : null}
          {l.site ? <Chip texto="Site" onPress={() => { const u = String(l.site); abrir(/^https?:/.test(u) ? u : `https://${u}`) }} /> : null}
        </View>
        {aviso ? <Aviso tom="aviso" texto={aviso} /> : null}
      </View>

      {servicos.length ? (
        <Cartao>
          <Text style={[e.secao, { color: t.texto }]}>Serviços</Text>
          <View style={e.chips}>{servicos.slice(0, 14).map((s) => <Selo key={s} texto={s} />)}</View>
          {naMimo ? <Text style={{ color: t.texto3, fontSize: 12.5 }}>Preços, duração e quem faz cada um estão na agenda do salão.</Text> : null}
        </Cartao>
      ) : null}

      {horas.length ? (
        <Cartao>
          <Text style={[e.secao, { color: t.texto }]}>Horários</Text>
          {horas.map((h) => (
            <View key={h.dias} style={e.linhaHora}>
              <Text style={{ color: t.texto2, fontSize: 14 }}>{h.dias}</Text>
              <Text style={{ color: h.horas === 'Fechado' ? t.texto3 : t.texto, fontSize: 14, fontWeight: '600' }}>{h.horas}</Text>
            </View>
          ))}
        </Cartao>
      ) : null}

      {c && (c.sobre.length || c.destaques.length) ? (
        <Cartao>
          <Text style={[e.secao, { color: t.texto }]}>Sobre</Text>
          {c.sobre.map((p: string, i: number) => <Text key={i} style={{ color: t.texto2, fontSize: 14.5, lineHeight: 21 }}>{p}</Text>)}
          {c.destaques.map((d: { titulo: string; texto: string }) => (
            <View key={d.titulo} style={{ gap: 2 }}>
              <Text style={{ color: t.texto, fontWeight: '700', fontSize: 14 }}>{d.titulo}</Text>
              <Text style={{ color: t.texto2, fontSize: 14, lineHeight: 20 }}>{d.texto}</Text>
            </View>
          ))}
        </Cartao>
      ) : null}

      <Outros titulo="Perto daqui" lista={pg.vizinhos ?? []} cidade={l.cidade_slug || String(cidade ?? '')} />
      <Outros titulo={`Também em ${cat.rotulo.toLowerCase()}`} lista={(pg.mesma_categoria ?? []).filter((o) => o.slug !== l.slug)} cidade={l.cidade_slug || String(cidade ?? '')} />
    </Tela>
  )
}

// outros salões do guia (vizinhos, a mesma categoria): cartões pequenos, em linha
function Outros({ titulo, lista, cidade }: { titulo: string; lista: CartaoGuia[]; cidade: string }) {
  const t = useTema()
  const router = useRouter()
  if (!lista.length) return null
  return (
    <View style={{ gap: 8 }}>
      <Text style={[e.secao, { color: t.texto }]}>{titulo}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {lista.slice(0, 8).map((o) => {
          const f = o.foto ?? (Array.isArray(o.fotos) ? o.fotos[0] : null)
          return (
            <Pressable key={o.slug} onPress={() => router.push({ pathname: '/guia/[cidade]/[slug]', params: { cidade: o.cidade_slug || cidade, slug: o.slug } })} accessibilityRole="button" style={({ pressed }) => [e.mini, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.85 : 1 }]}>
              {f ? <Image source={{ uri: miniatura(f) }} style={e.miniFoto} contentFit="cover" /> : <View style={[e.miniFoto, e.centro, { backgroundColor: t.superficie2 }]}><Ionicons name="storefront-outline" size={22} color={t.texto3} /></View>}
              <Text style={{ color: t.texto, fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{o.nome}</Text>
              <Text style={{ color: t.texto3, fontSize: 12 }} numberOfLines={1}>{[categoriaDoGuia(o.categoria).curto, o.bairro].filter(Boolean).join(' · ')}</Text>
              {o.na_mimo ? <Selo texto="Na MIMO" tom="acento" /> : null}
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}

const e = StyleSheet.create({
  capa: { height: 210, borderRadius: 18, overflow: 'hidden', backgroundColor: '#ddd' },
  centro: { alignItems: 'center', justifyContent: 'center' },
  pontos: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 4 },
  ponto: { height: 6, borderRadius: 3 },
  nome: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  secao: { fontSize: 16, fontWeight: '800' },
  linhaHora: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  mini: { width: 150, borderWidth: 1, borderRadius: 14, padding: 8, gap: 4 },
  miniFoto: { width: '100%', height: 90, borderRadius: 10 },
})
