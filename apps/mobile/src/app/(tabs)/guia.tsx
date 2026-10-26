import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SLUGS_CATEGORIA, categoriaDoGuia, miniatura, semAcento, slugificar } from '@mimo/core/guia.js'
import { Folha } from '@/components/Folha'
import { Botao, Carregando, Entrada, Selo, Vazio } from '@/components/ui'
import { carregarCidade, carregarCidades, carregarListaInteira, carregarParte, carregarRegioes, cidadeLembrada, cidadePelaConexao, lembrarCidade, type Cartao, type Cidade, type CidadeDados, type Regiao } from '@/lib/guia'
import { ordenar, type Ordenado, type Ordenavel } from '@/lib/guiaOrdem'
import { abrirAjustes, cidadePelaPosicao, distanciaTexto, pedirPermissao, permissaoAtual, posicaoAtual, type Permissao, type Posicao } from '@/lib/localizacao'
import { ESPACO, useTema } from '@/lib/tema'

// O guia de salões dentro do app (3.64): a cliente descobre os salões da região, os que já agendam pela
// MIMO ela entra com um toque. A cidade fica lembrada no aparelho; na primeira vez vem pela conexão. A
// busca por nome ou bairro usa a lista inteira da cidade (um arquivo só); a lista comum vem por partes.
//
// 3.69: explorar livre. A folha "Onde você quer procurar?" lista as regiões e as cidades (com busca) e
// "Usar minha localização"; a região abre as cidades dela em cartões, as categorias somadas e os salões das
// cidades mesclados. As categorias são cartões com foto (os mesmos blocos do site). "Perto de você" é um
// interruptor e respeita a hierarquia do guia (lib/guiaOrdem.ts): agenda pela MIMO, Seleção, foto + nota.

const semAc = (s: unknown) => semAcento(String(s ?? '')).toLowerCase()
type Alvo = { tipo: 'cidade'; slug: string } | { tipo: 'regiao'; slug: string }
type Resultado = { chave: string; dados: CidadeDados | null; extra: Cartao[]; parte: number; inteira: Cartao[] | null; erro: string }
type CategoriaItem = { categoria: string; total: number; foto?: string | null }
type ResultadoRegiao = { chave: string; cartoes: Ordenavel[]; categorias: CategoriaItem[]; erro: string }

export default function Guia() {
  const t = useTema()
  const router = useRouter()
  const { cidade: cidadeParam, categoria: categoriaParam } = useLocalSearchParams<{ cidade?: string; categoria?: string }>()
  const [cidades, setCidades] = useState<Cidade[] | null>(null)
  const [regioes, setRegioes] = useState<Regiao[]>([])
  const [alvo, setAlvo] = useState<Alvo | null>(null)
  const [categoria, setCategoria] = useState('')
  const [busca, setBusca] = useState('')
  // o resultado da cidade e categoria pedidas: a chave diz de quem é (muda a cidade, o resto some junto)
  const [res, setRes] = useState<Resultado | null>(null)
  const [resRegiao, setResRegiao] = useState<ResultadoRegiao | null>(null)
  const [maisIndo, setMaisIndo] = useState(false)
  const [escolhendo, setEscolhendo] = useState(false)
  const [filtroLugar, setFiltroLugar] = useState('')
  const [erro, setErro] = useState('')
  // a localização (3.66): com a permissão, a posição ordena a lista e mostra a distância; 3.69: um interruptor
  const [permissao, setPermissao] = useState<Permissao | null>(null)
  const [posicao, setPosicao] = useState<Posicao | null>(null)
  const [perto, setPerto] = useState(true)
  const [tentativa, setTentativa] = useState(0) // "Tentar de novo" refaz os pedidos (o cache solta o que falhou)
  const pedido = useRef(0)
  const cidade = alvo?.tipo === 'cidade' ? alvo.slug : null
  const regiao = useMemo(() => (alvo?.tipo === 'regiao' ? regioes.find((r) => r.slug === alvo.slug) ?? null : null), [alvo, regioes])
  const chave = `${alvo?.tipo ?? ''}:${alvo?.slug ?? ''}/${categoria}`
  const atual = res && res.chave === chave ? res : null
  const atualRegiao = resRegiao && resRegiao.chave === chave ? resRegiao : null
  const dados = atual ? atual.dados : undefined
  const lista = useMemo<Ordenavel[]>(() => (regiao ? (atualRegiao?.cartoes ?? []) : atual ? [...(atual.dados?.lugares ?? []), ...atual.extra] : []), [regiao, atualRegiao, atual])
  const parte = atual?.parte ?? 1
  const inteira = atual ? atual.inteira : null

  useEffect(() => {
    let vivo = true
    permissaoAtual().then(async (p) => {
      if (!vivo) return
      setPermissao(p)
      if (p === 'ok') { const pos = await posicaoAtual(); if (vivo) setPosicao(pos) }
    })
    return () => { vivo = false }
  }, [])

  // as cidades e as regiões do guia e a cidade de partida (o link, a lembrada, a da posição, a da conexão, a primeira)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [cs, rs] = await Promise.all([carregarCidades(), carregarRegioes().catch(() => [] as Regiao[])])
        if (!vivo) return
        setCidades(cs)
        setRegioes(rs)
        if (!cs.length) return
        const slugs = new Set(cs.map((c) => c.cidade_slug))
        let escolhida = cidadeParam && slugs.has(String(cidadeParam)) ? String(cidadeParam) : null
        if (!escolhida) { const l = await cidadeLembrada(); if (l && slugs.has(l)) escolhida = l }
        if (!escolhida) { const pos = await posicaoAtual(); if (pos) escolhida = await cidadePelaPosicao(pos, slugs) }
        if (!escolhida) { const c = await cidadePelaConexao(); const s = c ? slugificar(c.cidade) : ''; if (s && slugs.has(s)) escolhida = s }
        if (!vivo) return
        if (categoriaParam && (SLUGS_CATEGORIA as string[]).includes(String(categoriaParam))) setCategoria(String(categoriaParam))
        setAlvo({ tipo: 'cidade', slug: escolhida ?? cs[0]!.cidade_slug })
      } catch { if (vivo) setErro('Não deu para carregar o guia. Confira a internet e tente de novo.') }
    })()
    return () => { vivo = false }
  }, [cidadeParam, categoriaParam, tentativa])

  // a cidade (ou a categoria) muda: a primeira parte da lista
  useEffect(() => {
    if (!cidade) return
    const n = ++pedido.current
    const minha = `cidade:${cidade}/${categoria}`
    carregarCidade(cidade, categoria)
      .then((d) => { if (n === pedido.current) setRes({ chave: minha, dados: d, extra: [], parte: 1, inteira: null, erro: '' }) })
      .catch(() => { if (n === pedido.current) setRes({ chave: minha, dados: null, extra: [], parte: 1, inteira: null, erro: 'Não deu para carregar os salões. Confira a internet e tente de novo.' }) })
  }, [cidade, categoria, tentativa])

  // a região: a primeira parte de cada cidade dela, mescladas na ordem do guia; as categorias somadas
  useEffect(() => {
    if (!regiao) return
    const n = ++pedido.current
    const minha = `regiao:${regiao.slug}/${categoria}`
    const slugs = regiao.cidades
    Promise.all(slugs.map((s) => carregarCidade(s, categoria).catch(() => null))).then((ds) => {
      if (n !== pedido.current) return
      const cartoes: Ordenavel[] = ds.flatMap((d, i) => (d?.lugares ?? []).map((l, rank) => ({ ...l, cidade_slug: l.cidade_slug || slugs[i]!, cidade: l.cidade ?? d?.cidade, rank })))
      const soma = new Map<string, CategoriaItem>()
      for (const d of ds) for (const c of d?.categorias ?? []) {
        const g = soma.get(c.categoria) ?? { categoria: c.categoria, total: 0, foto: null }
        g.total += Number(c.total) || 0
        if (!g.foto && c.foto) g.foto = c.foto
        soma.set(c.categoria, g)
      }
      const categorias = [...soma.values()].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria))
      setResRegiao({ chave: minha, cartoes, categorias, erro: slugs.length && ds.every((d) => !d) ? 'Não deu para carregar os salões da região. Confira a internet e tente de novo.' : '' })
    })
  }, [regiao, categoria, tentativa])

  // a busca por nome ou bairro: a lista inteira, uma vez por cidade e categoria
  const buscando = busca.trim().length >= 2
  useEffect(() => {
    if (!buscando || !cidade || !atual || atual.inteira) return
    let vivo = true
    const minha = atual.chave
    carregarListaInteira(cidade, categoria).catch(() => null).then((l) => { if (vivo) setRes((r) => (r && r.chave === minha ? { ...r, inteira: l ?? [] } : r)) })
    return () => { vivo = false }
  }, [buscando, cidade, categoria, atual])

  const mostrados = useMemo<Ordenado[]>(() => {
    let base: Ordenavel[] = lista
    if (buscando) {
      const q = semAc(busca.trim())
      base = (regiao ? lista : (inteira ?? lista)).filter((l) => semAc(l.nome).includes(q) || semAc(l.bairro).includes(q))
    }
    return ordenar(base, posicao, perto)
  }, [buscando, busca, lista, inteira, posicao, perto, regiao])

  const totalPartes = dados?.lista?.partes ?? 1
  const temMais = !buscando && !regiao && parte < totalPartes
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

  // escolher na folha: a cidade ou a região; "perto de você" é da posição dela, então sai ao explorar outro lugar
  function escolherCidade(slug: string, { pela_posicao = false } = {}) {
    setEscolhendo(false); setFiltroLugar('')
    setPerto(pela_posicao)
    if (alvo?.tipo === 'cidade' && slug === alvo.slug) return
    setCategoria(''); setBusca('')
    setAlvo({ tipo: 'cidade', slug })
    void lembrarCidade(slug)
  }
  function escolherRegiao(slug: string) {
    setEscolhendo(false); setFiltroLugar('')
    setPerto(false)
    if (alvo?.tipo === 'regiao' && slug === alvo.slug) return
    setCategoria(''); setBusca('')
    setAlvo({ tipo: 'regiao', slug })
  }
  async function usarMinhaLocalizacao() {
    let p = permissao
    if (p !== 'ok') { const ok = await pedirPermissao(); p = ok ? 'ok' : await permissaoAtual(); setPermissao(p) }
    if (p === 'negada') { setEscolhendo(false); return abrirAjustes() }
    if (p !== 'ok') return
    const pos = await posicaoAtual()
    setPosicao(pos)
    const slugs = new Set((cidades ?? []).map((c) => c.cidade_slug))
    const perto_ = pos ? await cidadePelaPosicao(pos, slugs) : null
    if (perto_) escolherCidade(perto_, { pela_posicao: true })
    else { setEscolhendo(false); setPerto(Boolean(pos)) }
  }

  const nomeCidade = dados?.cidade ?? cidades?.find((c) => c.cidade_slug === cidade)?.cidade ?? ''
  const nomeDoLugar = regiao ? regiao.nome : nomeCidade
  const cidadesDaRegiao = useMemo(() => (regiao ? regiao.cidades.map((s) => cidades?.find((c) => c.cidade_slug === s)).filter((c): c is Cidade => Boolean(c)) : []), [regiao, cidades])
  const totalDoLugar = regiao ? cidadesDaRegiao.reduce((n, c) => n + (Number(c.total) || 0), 0) : dados?.total ?? 0
  const categorias: CategoriaItem[] = regiao ? (atualRegiao?.categorias ?? []) : (dados?.categorias ?? [])
  const totalTodos = regiao ? totalDoLugar : (categoria ? (atual?.dados?.categorias?.reduce((n, c) => n + (Number(c.total) || 0), 0) || dados?.total) : dados?.total) ?? 0
  const carregando = (regiao ? atualRegiao === null && !erro : dados === undefined && !erro && (cidade || cidades === null))
  const erroAtual = erro || atual?.erro || atualRegiao?.erro || ''

  // a folha: as regiões com as cidades de cada uma, e as cidades fora de região; a busca filtra pelo nome
  const grupos = useMemo(() => {
    const q = semAc(filtroLugar.trim())
    const todas = cidades ?? []
    const emRegiao = new Set<string>()
    const gs: { regiao: Regiao | null; cidades: Cidade[]; total: number }[] = []
    for (const r of regioes) {
      const cs = r.cidades.map((s) => todas.find((c) => c.cidade_slug === s)).filter((c): c is Cidade => Boolean(c))
      cs.forEach((c) => emRegiao.add(c.cidade_slug))
      const bate = !q || semAc(r.nome).includes(q)
      const vis = bate ? cs : cs.filter((c) => semAc(c.cidade).includes(q))
      if (vis.length || bate) gs.push({ regiao: r, cidades: vis, total: cs.reduce((n, c) => n + (Number(c.total) || 0), 0) })
    }
    const soltas = todas.filter((c) => !emRegiao.has(c.cidade_slug) && (!q || semAc(c.cidade).includes(q)))
    if (soltas.length) gs.push({ regiao: null, cidades: soltas, total: soltas.reduce((n, c) => n + (Number(c.total) || 0), 0) })
    return gs
  }, [cidades, regioes, filtroLugar])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <FlatList
        data={mostrados}
        keyExtractor={(l) => `${l.cidade_slug ?? cidade ?? ''}/${l.slug}`}
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
              <Ionicons name={regiao ? 'map-outline' : 'location-outline'} size={18} color={t.acento} />
              <Text style={[e.cidadeNome, { color: t.texto }]} numberOfLines={1}>{nomeDoLugar || 'Escolha a cidade'}</Text>
              {totalDoLugar ? <Text style={{ color: t.texto3, fontSize: 13 }}>{totalDoLugar} {totalDoLugar === 1 ? 'salão' : 'salões'}</Text> : null}
              <Ionicons name="chevron-down" size={18} color={t.texto3} />
            </Pressable>
            <Entrada value={busca} onChangeText={setBusca} placeholder={regiao ? 'Buscar por nome ou bairro na região' : 'Buscar por nome ou bairro'} autoCorrect={false} returnKeyType="search" testID="guia-busca" />
            {permissao === 'ok' ? (
              <Pressable
                onPress={() => setPerto((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: perto }}
                style={({ pressed }) => [e.perto, { backgroundColor: perto ? t.veu : t.superficie, borderWidth: perto ? 0 : 1, borderColor: t.fio, opacity: pressed ? 0.8 : 1 }]}
                testID="guia-perto-toggle"
              >
                <Ionicons name={perto ? 'navigate' : 'navigate-outline'} size={18} color={t.acento} />
                <Text style={{ color: t.texto, fontSize: 13.5, flex: 1 }}>{perto ? 'Perto de você: os mais perto primeiro, na ordem do guia.' : 'Perto de você desligado: a ordem do guia.'}</Text>
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>{perto ? 'Desligar' : 'Ligar'}</Text>
              </Pressable>
            ) : permissao === 'nunca' || permissao === 'negada' ? (
              <Pressable
                onPress={async () => {
                  if (permissao === 'negada') return abrirAjustes()
                  const ok = await pedirPermissao()
                  setPermissao(ok ? 'ok' : await permissaoAtual())
                  if (ok) { setPosicao(await posicaoAtual()); setPerto(true) }
                }}
                accessibilityRole="button"
                style={({ pressed }) => [e.perto, { backgroundColor: t.veu, opacity: pressed ? 0.8 : 1 }]}
                testID="guia-perto"
              >
                <Ionicons name="navigate-outline" size={18} color={t.acento} />
                <Text style={{ color: t.texto, fontSize: 13.5, flex: 1 }}>{permissao === 'negada' ? 'A localização está desligada. Ligue nos ajustes para ver os salões mais perto.' : 'Ative a localização para ver primeiro os salões mais perto de você.'}</Text>
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>{permissao === 'negada' ? 'Ajustes' : 'Ativar'}</Text>
              </Pressable>
            ) : null}

            {regiao ? (
              <View style={{ gap: 8 }}>
                {regiao.chamada ? <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>{regiao.chamada}</Text> : null}
                <Text style={[e.secao, { color: t.texto }]}>Cidades da região</Text>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={cidadesDaRegiao}
                  keyExtractor={(c) => c.cidade_slug}
                  contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
                  renderItem={({ item: c }) => (
                    <Pressable onPress={() => escolherCidade(c.cidade_slug)} accessibilityRole="button" style={({ pressed }) => [e.cartaoLugar, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.85 : 1 }]} testID="guia-regiao-cidade">
                      {c.foto ? <Image source={{ uri: miniatura(c.foto) }} style={e.cartaoFoto} contentFit="cover" transition={150} /> : <View style={[e.cartaoFoto, e.centro, { backgroundColor: t.veu }]}><Ionicons name="business-outline" size={22} color={t.acento} /></View>}
                      <Text style={[e.cartaoNome, { color: t.texto }]} numberOfLines={1}>{c.cidade}</Text>
                      <Text style={{ color: t.texto3, fontSize: 12 }}>{c.total} {c.total === 1 ? 'salão' : 'salões'}</Text>
                    </Pressable>
                  )}
                />
              </View>
            ) : null}

            {categorias.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={[e.secao, { color: t.texto }]}>{regiao ? `Categorias na ${regiao.nome}` : 'Categorias'}</Text>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={[{ categoria: '', total: totalTodos, foto: null } as CategoriaItem, ...categorias]}
                  keyExtractor={(c) => c.categoria || 'todas'}
                  contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
                  renderItem={({ item: c }) => {
                    const ativa = categoria === c.categoria
                    return (
                      <Pressable onPress={() => { setBusca(''); setCategoria(c.categoria) }} accessibilityRole="button" accessibilityState={{ selected: ativa }} style={({ pressed }) => [e.cartaoLugar, { backgroundColor: t.superficie, borderColor: ativa ? t.acento : t.fio, borderWidth: ativa ? 2 : 1, opacity: pressed ? 0.85 : 1 }]} testID="guia-categoria">
                        {c.foto ? <Image source={{ uri: miniatura(c.foto) }} style={e.cartaoFoto} contentFit="cover" transition={150} /> : <View style={[e.cartaoFoto, e.centro, { backgroundColor: ativa ? t.acento : t.veu }]}><Ionicons name={c.categoria ? 'sparkles-outline' : 'grid-outline'} size={22} color={ativa ? t.acentoTexto : t.acento} /></View>}
                        <Text style={[e.cartaoNome, { color: ativa ? t.acento : t.texto }]} numberOfLines={1}>{c.categoria ? categoriaDoGuia(c.categoria).curto : 'Todos'}</Text>
                        <Text style={{ color: t.texto3, fontSize: 12 }}>{c.total} {c.total === 1 ? 'salão' : 'salões'}</Text>
                      </Pressable>
                    )
                  }}
                />
              </View>
            ) : null}

            {!carregando && !erroAtual && (categoria || regiao) ? (
              <View style={{ gap: 2 }}>
                <Text style={[e.secao, { color: t.texto }]} testID="guia-lista-titulo">{categoria ? `${categoriaDoGuia(categoria).rotulo} em ${nomeDoLugar}` : `Salões na ${nomeDoLugar}`}</Text>
                {regiao ? <Text style={{ color: t.texto3, fontSize: 12.5 }}>Os primeiros de cada cidade. Para ver todos, escolha a cidade.</Text> : null}
              </View>
            ) : null}
            {erroAtual ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.erro, fontSize: 13.5 }}>{erroAtual}</Text>
                <Botao titulo="Tentar de novo" tipo="fantasma" onPress={() => { setErro(''); setTentativa((x) => x + 1) }} />
              </View>
            ) : null}
            {carregando ? <Carregando texto="Buscando os salões…" /> : null}
            {buscando && !regiao && inteira === null ? <Carregando texto="Procurando…" /> : null}
          </View>
        }
        renderItem={({ item: l }) => <CartaoLugar l={l} km={perto ? l.km : null} cidade={regiao ? String(l.cidade ?? '') : ''} onPress={() => router.push({ pathname: '/guia/[cidade]/[slug]', params: { cidade: l.cidade_slug || cidade || '', slug: l.slug } })} />}
        ListEmptyComponent={
          carregando || (buscando && !regiao && inteira === null) ? null : (
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
      <Folha aberta={escolhendo} onFechar={() => { setEscolhendo(false); setFiltroLugar('') }}>
        <Text style={[e.folhaTitulo, { color: t.texto }]}>Onde você quer procurar?</Text>
        <Entrada value={filtroLugar} onChangeText={setFiltroLugar} placeholder="Cidade ou região" autoCorrect={false} testID="guia-filtro-lugar" />
        {permissao !== 'negada' ? (
          <Pressable onPress={() => { void usarMinhaLocalizacao() }} accessibilityRole="button" style={({ pressed }) => [e.opcao, { borderColor: t.fio, opacity: pressed ? 0.7 : 1 }]} testID="guia-usar-local">
            <Ionicons name="navigate" size={20} color={t.acento} />
            <Text style={[e.opcaoTexto, { color: t.acento }]}>Usar minha localização</Text>
          </Pressable>
        ) : null}
        <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
          {grupos.map((g) => (
            <View key={g.regiao?.slug ?? 'soltas'}>
              {g.regiao ? (
                <Pressable onPress={() => escolherRegiao(g.regiao!.slug)} accessibilityRole="button" style={({ pressed }) => [e.opcaoRegiao, { backgroundColor: alvo?.tipo === 'regiao' && alvo.slug === g.regiao!.slug ? t.veu : 'transparent', opacity: pressed ? 0.7 : 1 }]} testID="guia-opcao-regiao">
                  <Ionicons name="map-outline" size={18} color={t.acento} />
                  <View style={{ flex: 1 }}>
                    <Text style={[e.opcaoTexto, { color: t.texto }]}>{g.regiao.nome}</Text>
                    <Text style={{ color: t.texto3, fontSize: 12.5 }}>{g.cidades.length} {g.cidades.length === 1 ? 'cidade' : 'cidades'} · {g.total} salões</Text>
                  </View>
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ver a região</Text>
                </Pressable>
              ) : (
                <Text style={[e.opcaoGrupo, { color: t.texto3 }]}>Outras cidades</Text>
              )}
              {g.cidades.map((c) => (
                <Pressable key={c.cidade_slug} onPress={() => escolherCidade(c.cidade_slug)} accessibilityRole="button" style={({ pressed }) => [e.opcao, { borderColor: t.fio, paddingLeft: g.regiao ? 10 : 0, opacity: pressed ? 0.7 : 1 }]} testID="guia-opcao-cidade">
                  <Ionicons name={c.cidade_slug === cidade ? 'radio-button-on' : 'radio-button-off'} size={20} color={c.cidade_slug === cidade ? t.acento : t.texto3} />
                  <Text style={[e.opcaoTexto, { color: t.texto }]}>{c.cidade}, {c.uf}</Text>
                  <Text style={{ color: t.texto3, fontSize: 13 }}>{c.total}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {grupos.length === 0 ? <Text style={{ color: t.texto3, paddingVertical: 12 }}>Nenhuma cidade ou região com esse nome.</Text> : null}
        </ScrollView>
      </Folha>
    </SafeAreaView>
  )
}

// um salão na lista: foto, nome, categoria e bairro (e a cidade, na região), os selos
function CartaoLugar({ l, km, cidade, onPress }: { l: Cartao; km: number | null; cidade: string; onPress: () => void }) {
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
        <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>{[cat.curto, l.bairro, cidade || null, km != null ? distanciaTexto(km) : null].filter(Boolean).join(' · ')}</Text>
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
  secao: { fontSize: 15.5, fontWeight: '800' },
  cidade: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: 46 },
  cidadeNome: { flex: 1, fontSize: 15.5, fontWeight: '700' },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 10 },
  foto: { width: 68, height: 68, borderRadius: 12 },
  centro: { alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 15.5, fontWeight: '700' },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  cartaoLugar: { width: 124, borderWidth: 1, borderRadius: 14, padding: 6, gap: 3 },
  cartaoFoto: { width: '100%', height: 70, borderRadius: 10 },
  cartaoNome: { fontSize: 13.5, fontWeight: '700' },
  perto: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  folhaTitulo: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  opcaoRegiao: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, marginTop: 8, borderRadius: 12 },
  opcaoGrupo: { fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 14, marginBottom: 2 },
  opcaoTexto: { flex: 1, fontSize: 15.5, fontWeight: '600' },
})
