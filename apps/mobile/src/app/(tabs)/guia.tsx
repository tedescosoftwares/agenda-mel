import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SLUGS_CATEGORIA, categoriaDoGuia, miniatura, semAcento, slugificar } from '@mimo/core/guia.js'
import { Folha } from '@/components/Folha'
import { Botao, Carregando, Chip, Entrada, Selo, Vazio } from '@/components/ui'
import { carregarCidade, carregarCidades, carregarListaInteira, carregarParte, cidadeLembrada, cidadePelaConexao, lembrarCidade, type Cartao, type Cidade, type CidadeDados } from '@/lib/guia'
import { ESPACO, useTema } from '@/lib/tema'

// O guia de salões dentro do app (3.64): a cliente descobre os salões da região, os que já agendam pela
// MIMO ela entra com um toque. A cidade fica lembrada no aparelho; na primeira vez vem pela conexão. A
// busca por nome ou bairro usa a lista inteira da cidade (um arquivo só); a lista comum vem por partes.

const semAc = (s: unknown) => semAcento(String(s ?? '')).toLowerCase()
type Resultado = { chave: string; dados: CidadeDados | null; extra: Cartao[]; parte: number; inteira: Cartao[] | null; erro: string }

export default function Guia() {
  const t = useTema()
  const router = useRouter()
  const { cidade: cidadeParam, categoria: categoriaParam } = useLocalSearchParams<{ cidade?: string; categoria?: string }>()
  const [cidades, setCidades] = useState<Cidade[] | null>(null)
  const [cidade, setCidade] = useState<string | null>(null)
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  // o resultado da cidade e categoria pedidas: a chave diz de quem é (muda a cidade, o resto some junto)
  const [res, setRes] = useState<Resultado | null>(null)
  const [maisIndo, setMaisIndo] = useState(false)
  const [escolhendo, setEscolhendo] = useState(false)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0) // "Tentar de novo" refaz os pedidos (o cache solta o que falhou)
  const pedido = useRef(0)
  const chave = `${cidade ?? ''}/${categoria}`
  const atual = res && res.chave === chave ? res : null
  const dados = atual ? atual.dados : undefined
  const lista = useMemo(() => (atual ? [...(atual.dados?.lugares ?? []), ...atual.extra] : []), [atual])
  const parte = atual?.parte ?? 1
  const inteira = atual ? atual.inteira : null

  // as cidades do guia e a cidade de partida (o link, a lembrada, a da conexão, a primeira)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const cs = await carregarCidades()
        if (!vivo) return
        setCidades(cs)
        if (!cs.length) return
        const slugs = new Set(cs.map((c) => c.cidade_slug))
        let escolhida = cidadeParam && slugs.has(String(cidadeParam)) ? String(cidadeParam) : null
        if (!escolhida) { const l = await cidadeLembrada(); if (l && slugs.has(l)) escolhida = l }
        if (!escolhida) { const c = await cidadePelaConexao(); const s = c ? slugificar(c.cidade) : ''; if (s && slugs.has(s)) escolhida = s }
        if (!vivo) return
        if (categoriaParam && (SLUGS_CATEGORIA as string[]).includes(String(categoriaParam))) setCategoria(String(categoriaParam))
        setCidade(escolhida ?? cs[0]!.cidade_slug)
      } catch { if (vivo) setErro('Não deu para carregar o guia. Confira a internet e tente de novo.') }
    })()
    return () => { vivo = false }
  }, [cidadeParam, categoriaParam, tentativa])

  // a cidade (ou a categoria) muda: a primeira parte da lista
  useEffect(() => {
    if (!cidade) return
    const n = ++pedido.current
    const minha = `${cidade}/${categoria}`
    carregarCidade(cidade, categoria)
      .then((d) => { if (n === pedido.current) setRes({ chave: minha, dados: d, extra: [], parte: 1, inteira: null, erro: '' }) })
      .catch(() => { if (n === pedido.current) setRes({ chave: minha, dados: null, extra: [], parte: 1, inteira: null, erro: 'Não deu para carregar os salões. Confira a internet e tente de novo.' }) })
  }, [cidade, categoria, tentativa])

  // a busca por nome ou bairro: a lista inteira, uma vez por cidade e categoria
  const buscando = busca.trim().length >= 2
  useEffect(() => {
    if (!buscando || !cidade || !atual || atual.inteira) return
    let vivo = true
    const minha = atual.chave
    carregarListaInteira(cidade, categoria).catch(() => null).then((l) => { if (vivo) setRes((r) => (r && r.chave === minha ? { ...r, inteira: l ?? [] } : r)) })
    return () => { vivo = false }
  }, [buscando, cidade, categoria, atual])

  const mostrados = useMemo(() => {
    if (!buscando) return lista
    const q = semAc(busca.trim())
    return (inteira ?? lista).filter((l) => semAc(l.nome).includes(q) || semAc(l.bairro).includes(q))
  }, [buscando, busca, lista, inteira])

  const totalPartes = dados?.lista?.partes ?? 1
  const temMais = !buscando && parte < totalPartes
  const mais = useCallback(async () => {
    if (!cidade || maisIndo || !temMais) return
    setMaisIndo(true)
    const minha = chave
    const p = await carregarParte(cidade, categoria, parte + 1).catch(() => null)
    setMaisIndo(false)
    if (!p) return
    setRes((r) => {
      if (!r || r.chave !== minha) return r
      const vistos = new Set([...(r.dados?.lugares ?? []), ...r.extra].map((x) => x.slug))
      return { ...r, parte: r.parte + 1, extra: [...r.extra, ...p.filter((x) => !vistos.has(x.slug))] }
    })
  }, [cidade, categoria, chave, parte, maisIndo, temMais])

  function escolherCidade(slug: string) {
    setEscolhendo(false)
    if (slug === cidade) return
    setCategoria(''); setBusca('')
    setCidade(slug)
    void lembrarCidade(slug)
  }

  const nomeCidade = dados?.cidade ?? cidades?.find((c) => c.cidade_slug === cidade)?.cidade ?? ''
  const categorias = dados?.categorias ?? []

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <FlatList
        data={mostrados}
        keyExtractor={(l) => `${l.cidade_slug}/${l.slug}`}
        contentContainerStyle={e.conteudo}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.6}
        onEndReached={() => { void mais() }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={e.topo}>
              <View style={{ flex: 1 }}>
                <Text style={[e.titulo, { color: t.texto }]}>Guia de salões</Text>
                <Text style={{ color: t.texto2, fontSize: 13.5 }}>Descubra onde se cuidar e marque sem sair daqui.</Text>
              </View>
            </View>
            <Pressable onPress={() => setEscolhendo(true)} accessibilityRole="button" style={({ pressed }) => [e.cidade, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.8 : 1 }]} testID="guia-cidade">
              <Ionicons name="location-outline" size={18} color={t.acento} />
              <Text style={[e.cidadeNome, { color: t.texto }]} numberOfLines={1}>{nomeCidade || 'Escolha a cidade'}</Text>
              {dados?.total ? <Text style={{ color: t.texto3, fontSize: 13 }}>{dados.total} {dados.total === 1 ? 'salão' : 'salões'}</Text> : null}
              <Ionicons name="chevron-down" size={18} color={t.texto3} />
            </Pressable>
            <Entrada value={busca} onChangeText={setBusca} placeholder="Buscar por nome ou bairro" autoCorrect={false} returnKeyType="search" testID="guia-busca" />
            {categorias.length > 1 ? (
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[{ categoria: '', total: dados?.total ?? 0 }, ...categorias]}
                keyExtractor={(c) => c.categoria || 'todas'}
                contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
                renderItem={({ item: c }) => (
                  <Chip texto={c.categoria ? `${categoriaDoGuia(c.categoria).curto} · ${c.total}` : `Todos · ${c.total}`} ativo={categoria === c.categoria} onPress={() => { setBusca(''); setCategoria(c.categoria) }} />
                )}
              />
            ) : null}
            {erro || atual?.erro ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.erro, fontSize: 13.5 }}>{erro || atual?.erro}</Text>
                <Botao titulo="Tentar de novo" tipo="fantasma" onPress={() => { setErro(''); setTentativa((x) => x + 1) }} />
              </View>
            ) : null}
            {dados === undefined && !erro && (cidade || cidades === null) ? <Carregando texto="Buscando os salões…" /> : null}
            {buscando && inteira === null ? <Carregando texto="Procurando…" /> : null}
          </View>
        }
        renderItem={({ item: l }) => <CartaoLugar l={l} onPress={() => router.push({ pathname: '/guia/[cidade]/[slug]', params: { cidade: l.cidade_slug, slug: l.slug } })} />}
        ListEmptyComponent={
          (dados === undefined && !erro && (cidade || cidades === null)) || (buscando && inteira === null) ? null : (
            <Vazio mostrarMel={false} titulo={buscando ? 'Nenhum salão com esse nome ou bairro.' : cidades && cidades.length === 0 ? 'O guia ainda não tem salões.' : 'Nenhum salão nessa categoria por aqui.'} />
          )
        }
        ListFooterComponent={
          temMais ? (
            <View style={{ paddingTop: 6 }}>
              <Botao titulo={maisIndo ? 'Carregando…' : 'Mostrar mais'} tipo="fantasma" onPress={() => { void mais() }} desabilitado={maisIndo} />
            </View>
          ) : null
        }
      />
      <Folha aberta={escolhendo} onFechar={() => setEscolhendo(false)}>
        <Text style={[e.folhaTitulo, { color: t.texto }]}>Em que cidade?</Text>
        {(cidades ?? []).map((c) => (
          <Pressable key={c.cidade_slug} onPress={() => escolherCidade(c.cidade_slug)} accessibilityRole="button" style={({ pressed }) => [e.opcao, { borderColor: t.fio, opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name={c.cidade_slug === cidade ? 'radio-button-on' : 'radio-button-off'} size={20} color={c.cidade_slug === cidade ? t.acento : t.texto3} />
            <Text style={[e.opcaoTexto, { color: t.texto }]}>{c.cidade}, {c.uf}</Text>
            <Text style={{ color: t.texto3, fontSize: 13 }}>{c.total}</Text>
          </Pressable>
        ))}
      </Folha>
    </SafeAreaView>
  )
}

// um salão na lista: foto, nome, categoria e bairro, os selos
function CartaoLugar({ l, onPress }: { l: Cartao; onPress: () => void }) {
  const t = useTema()
  const foto = l.foto ?? (Array.isArray(l.fotos) ? l.fotos[0] : null)
  const cat = categoriaDoGuia(l.categoria)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [e.cartao, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.85 : 1 }]} testID="guia-salao">
      {foto ? (
        <Image source={{ uri: miniatura(foto) }} style={e.foto} contentFit="cover" transition={150} />
      ) : (
        <View style={[e.foto, e.centro, { backgroundColor: t.superficie2 }]}>
          <Ionicons name="storefront-outline" size={26} color={t.texto3} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[e.nome, { color: t.texto }]} numberOfLines={1}>{l.nome}</Text>
        <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>{[cat.curto, l.bairro].filter(Boolean).join(' · ')}</Text>
        {l.na_mimo || l.selecao ? (
          <View style={e.selos}>
            {l.na_mimo ? <Selo texto="Agenda pela MIMO" tom="acento" /> : null}
            {l.selecao ? <Selo texto="Seleção MIMO" tom="ok" /> : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.texto3} />
    </Pressable>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 10, paddingBottom: 32 },
  topo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titulo: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  cidade: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: 46 },
  cidadeNome: { flex: 1, fontSize: 15.5, fontWeight: '700' },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 10 },
  foto: { width: 68, height: 68, borderRadius: 12 },
  centro: { alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 15.5, fontWeight: '700' },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  folhaTitulo: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  opcaoTexto: { flex: 1, fontSize: 15.5, fontWeight: '600' },
})
