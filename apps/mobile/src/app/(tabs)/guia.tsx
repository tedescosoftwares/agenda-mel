import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SLUGS_CATEGORIA, categoriaDoGuia, miniatura, semAcento, slugificar } from '@mimo/core/guia.js'
import { preposicaoDaRegiao } from '@mimo/core/guiaRegioes.js'
import { Folha } from '@/components/Folha'
import { Botao, Carregando, Entrada, Selo, Vazio, type Icone } from '@/components/ui'
import { carregarCidade, carregarCidades, carregarListaInteira, carregarParte, carregarRegioes, cidadeLembrada, cidadePelaConexao, lembrarCidade, type Cartao, type Cidade, type CidadeDados, type Regiao } from '@/lib/guia'
import { ordenar, type Ordenado, type Ordenavel } from '@/lib/guiaOrdem'
import { abrirAjustes, cidadePelaPosicao, distanciaTexto, pedirPermissao, permissaoAtual, posicaoAtual, type Permissao, type Posicao } from '@/lib/localizacao'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// O guia de salões dentro do app (3.64): a cliente descobre os salões da região, os que já agendam pela
// MIMO ela entra com um toque. A cidade fica lembrada no aparelho; na primeira vez vem pela conexão.
//
// 3.69: explorar livre (a folha com as regiões e as cidades, "Usar minha localização"), a região com as
// cidades dela e os salões mesclados, as categorias em cartões e "perto de você" como interruptor que
// respeita a hierarquia do guia (lib/guiaOrdem.ts).
//
// 3.70: as categorias com ícone e cor, a faixa da categoria ativa, a folha com os cartões das regiões e
// depois as cidades, a paginação na tela (30 por vez; o servidor manda partes de 48 e, com "perto de
// você" ligado ou na busca, a lista inteira da cidade entra de uma vez para a ordem valer para todos)
// e os cartões dos salões com o resumo e os serviços.

const semAc = (s: unknown) => semAcento(String(s ?? '')).toLowerCase()
const POR_TELA = 30
type Alvo = { tipo: 'cidade'; slug: string } | { tipo: 'regiao'; slug: string }
type Resultado = { chave: string; dados: CidadeDados | null; extra: Cartao[]; parte: number; inteira: Cartao[] | null; erro: string }
type CategoriaItem = { categoria: string; total: number; foto?: string | null }
type ResultadoRegiao = { chave: string; cartoes: Ordenavel[]; categorias: CategoriaItem[]; erro: string }

// cada categoria com o seu ícone e a sua cor, para bater o olho e saber onde está
const VISUAL: Record<string, { icone: Icone; cor: string }> = {
  beleza: { icone: 'sparkles', cor: '#ff2d7a' },
  cabelo: { icone: 'cut', cor: '#7a3cff' },
  unhas: { icone: 'color-palette', cor: '#ff6a3d' },
  cilios: { icone: 'eye', cor: '#4c2a85' },
  sobrancelhas: { icone: 'brush', cor: '#0c7a50' },
  barbearia: { icone: 'man', cor: '#1f3a5f' },
  estetica: { icone: 'leaf', cor: '#14b8a6' },
  maquiagem: { icone: 'color-wand', cor: '#c8135c' },
}
const visualDe = (slug: string) => (slug ? VISUAL[slug] ?? { icone: 'sparkles-outline' as Icone, cor: MARCA.rosa } : { icone: 'grid' as Icone, cor: MARCA.roxo })
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

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
  const [regiaoNaFolha, setRegiaoNaFolha] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  // a localização (3.66): com a permissão, a posição ordena a lista e mostra a distância; 3.69: um interruptor
  const [permissao, setPermissao] = useState<Permissao | null>(null)
  const [posicao, setPosicao] = useState<Posicao | null>(null)
  const [perto, setPerto] = useState(true)
  // 3.70: quantos cartões estão na tela (a chave diz de que lista é: muda a lista, volta ao começo)
  const [vis, setVis] = useState<{ chave: string; n: number }>({ chave: '', n: POR_TELA })
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
  const pertoLigado = perto && Boolean(posicao)

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

  // a lista inteira da cidade (um arquivo só): na busca por nome ou bairro e com "perto de você" ligado
  // (a ordem pelos mais perto tem que olhar todos os salões, não só a primeira parte)
  const buscando = busca.trim().length >= 2
  const usaInteira = Boolean(cidade) && (buscando || pertoLigado)
  useEffect(() => {
    if (!usaInteira || !cidade || !atual || atual.inteira) return
    let vivo = true
    const minha = atual.chave
    carregarListaInteira(cidade, categoria).catch(() => null).then((l) => { if (vivo) setRes((r) => (r && r.chave === minha ? { ...r, inteira: l ?? [] } : r)) })
    return () => { vivo = false }
  }, [usaInteira, cidade, categoria, atual])

  const mostrados = useMemo<Ordenado[]>(() => {
    let base: Ordenavel[] = regiao ? lista : usaInteira && inteira ? inteira : lista
    if (buscando) {
      const q = semAc(busca.trim())
      base = base.filter((l) => semAc(l.nome).includes(q) || semAc(l.bairro).includes(q))
    }
    return ordenar(base, posicao, perto)
  }, [buscando, busca, lista, inteira, usaInteira, posicao, perto, regiao])

  // a paginação na tela: 30 por vez; acabando o que está na memória, a próxima parte do servidor
  const chaveLista = `${chave}|${busca.trim()}|${pertoLigado ? 'perto' : ''}`
  const visiveis = vis.chave === chaveLista ? vis.n : POR_TELA
  const naTela = useMemo(() => mostrados.slice(0, visiveis), [mostrados, visiveis])
  const faltamNaMemoria = mostrados.length > visiveis
  const totalPartes = dados?.lista?.partes ?? 1
  const temMaisNoServidor = Boolean(cidade) && !regiao && !usaInteira && parte < totalPartes
  const totalDaLista = regiao || buscando ? mostrados.length : usaInteira && inteira ? inteira.length : (dados?.lista?.total ?? mostrados.length)
  const mais = useCallback(async () => {
    if (faltamNaMemoria) { setVis({ chave: chaveLista, n: visiveis + POR_TELA }); return }
    if (!cidade || maisIndo || !temMaisNoServidor) return
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
    setVis({ chave: chaveLista, n: visiveis + POR_TELA })
  }, [faltamNaMemoria, chaveLista, visiveis, cidade, categoria, chave, parte, maisIndo, temMaisNoServidor])

  // escolher na folha: a cidade ou a região; "perto de você" é da posição dela, então sai ao explorar outro lugar
  function fecharFolha() { setEscolhendo(false); setFiltroLugar(''); setRegiaoNaFolha(null) }
  function escolherCidade(slug: string, { pela_posicao = false } = {}) {
    fecharFolha()
    setPerto(pela_posicao)
    if (alvo?.tipo === 'cidade' && slug === alvo.slug) return
    setCategoria(''); setBusca('')
    setAlvo({ tipo: 'cidade', slug })
    void lembrarCidade(slug)
  }
  function escolherRegiao(slug: string) {
    fecharFolha()
    setPerto(false)
    if (alvo?.tipo === 'regiao' && slug === alvo.slug) return
    setCategoria(''); setBusca('')
    setAlvo({ tipo: 'regiao', slug })
  }
  async function usarMinhaLocalizacao() {
    let p = permissao
    if (p !== 'ok') { const ok = await pedirPermissao(); p = ok ? 'ok' : await permissaoAtual(); setPermissao(p) }
    if (p === 'negada') { fecharFolha(); return abrirAjustes() }
    if (p !== 'ok') return
    const pos = await posicaoAtual()
    setPosicao(pos)
    const slugs = new Set((cidades ?? []).map((c) => c.cidade_slug))
    const perto_ = pos ? await cidadePelaPosicao(pos, slugs) : null
    if (perto_) escolherCidade(perto_, { pela_posicao: true })
    else { fecharFolha(); setPerto(Boolean(pos)) }
  }

  const nomeCidade = dados?.cidade ?? cidades?.find((c) => c.cidade_slug === cidade)?.cidade ?? ''
  const nomeDoLugar = regiao ? regiao.nome : nomeCidade
  const cidadesDe = useCallback((r: Regiao) => r.cidades.map((s) => cidades?.find((c) => c.cidade_slug === s)).filter((c): c is Cidade => Boolean(c)), [cidades])
  const cidadesDaRegiao = useMemo(() => (regiao ? cidadesDe(regiao) : []), [regiao, cidadesDe])
  const totalDe = (cs: Cidade[]) => cs.reduce((n, c) => n + (Number(c.total) || 0), 0)
  const totalDoLugar = regiao ? totalDe(cidadesDaRegiao) : dados?.total ?? 0
  const categorias: CategoriaItem[] = regiao ? (atualRegiao?.categorias ?? []) : (dados?.categorias ?? [])
  const totalTodos = regiao ? totalDoLugar : (dados?.total ?? 0)
  const categoriaAtiva = categoria ? categorias.find((c) => c.categoria === categoria) ?? { categoria, total: totalDaLista, foto: null } : null
  const carregando = (regiao ? atualRegiao === null && !erro : dados === undefined && !erro && (cidade || cidades === null))
  const erroAtual = erro || atual?.erro || atualRegiao?.erro || ''

  // a folha: os cartões das regiões e, embaixo, as cidades (todas, por região; ou só as da região tocada)
  const grupos = useMemo(() => {
    const q = semAc(filtroLugar.trim())
    const todas = cidades ?? []
    const bate = (c: Cidade) => !q || semAc(c.cidade).includes(q)
    if (regiaoNaFolha) {
      const r = regioes.find((x) => x.slug === regiaoNaFolha)
      return r ? [{ regiao: r, cidades: cidadesDe(r).filter(bate) }] : []
    }
    const emRegiao = new Set<string>()
    const gs: { regiao: Regiao | null; cidades: Cidade[] }[] = []
    for (const r of regioes) {
      const cs = cidadesDe(r)
      cs.forEach((c) => emRegiao.add(c.cidade_slug))
      const vis_ = cs.filter(bate)
      if (vis_.length) gs.push({ regiao: r, cidades: vis_ })
    }
    const soltas = todas.filter((c) => !emRegiao.has(c.cidade_slug) && bate(c))
    if (soltas.length) gs.push({ regiao: null, cidades: soltas })
    return gs
  }, [cidades, regioes, filtroLugar, regiaoNaFolha, cidadesDe])
  const regiaoTocada = regiaoNaFolha ? regioes.find((r) => r.slug === regiaoNaFolha) ?? null : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <FlatList
        data={naTela}
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
              {totalDoLugar ? <Text style={{ color: t.texto3, fontSize: 13 }}>{plural(totalDoLugar, 'salão', 'salões')}</Text> : null}
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
                      <Text style={{ color: t.texto3, fontSize: 12 }}>{plural(c.total, 'salão', 'salões')}</Text>
                    </Pressable>
                  )}
                />
              </View>
            ) : null}

            {categorias.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={[e.secao, { color: t.texto }]}>{regiao ? `Categorias ${preposicaoDaRegiao(regiao.nome)} ${regiao.nome}` : 'Categorias'}</Text>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={[{ categoria: '', total: totalTodos, foto: null } as CategoriaItem, ...categorias]}
                  keyExtractor={(c) => c.categoria || 'todas'}
                  contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
                  extraData={categoria}
                  renderItem={({ item: c }) => <CategoriaCartao c={c} ativa={categoria === c.categoria} onPress={() => { setBusca(''); setCategoria(c.categoria) }} />}
                />
              </View>
            ) : null}

            {categoriaAtiva ? <FaixaCategoria c={categoriaAtiva} lugar={regiao ? `${preposicaoDaRegiao(regiao.nome)} ${regiao.nome}` : nomeDoLugar ? `em ${nomeDoLugar}` : ''} total={regiao ? mostrados.length : categoriaAtiva.total} onLimpar={() => setCategoria('')} /> : null}
            {!carregando && !erroAtual && regiao && !categoria ? (
              <View style={{ gap: 2 }}>
                <Text style={[e.secao, { color: t.texto }]} testID="guia-lista-titulo">Salões {preposicaoDaRegiao(regiao.nome)} {regiao.nome}</Text>
                <Text style={{ color: t.texto3, fontSize: 12.5 }}>Os primeiros de cada cidade. Para ver todos, escolha a cidade.</Text>
              </View>
            ) : null}
            {erroAtual ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: t.erro, fontSize: 13.5 }}>{erroAtual}</Text>
                <Botao titulo="Tentar de novo" tipo="fantasma" onPress={() => { setErro(''); setTentativa((x) => x + 1) }} />
              </View>
            ) : null}
            {carregando ? <Carregando texto="Buscando os salões…" /> : null}
            {buscando && usaInteira && inteira === null ? <Carregando texto="Procurando…" /> : null}
            {!buscando && usaInteira && inteira === null && !carregando ? <Text style={{ color: t.texto3, fontSize: 12.5 }}>Ordenando todos os salões pelos mais perto…</Text> : null}
          </View>
        }
        renderItem={({ item: l }) => <CartaoLugar l={l} km={perto ? l.km : null} cidade={regiao ? String(l.cidade ?? '') : ''} onPress={() => router.push({ pathname: '/guia/[cidade]/[slug]', params: { cidade: l.cidade_slug || cidade || '', slug: l.slug } })} />}
        ListEmptyComponent={
          carregando || (buscando && usaInteira && inteira === null) ? null : (
            <Vazio mostrarMel={false} titulo={buscando ? 'Nenhum salão com esse nome ou bairro.' : cidades && cidades.length === 0 ? 'O guia ainda não tem salões.' : 'Nenhum salão nessa categoria por aqui.'} />
          )
        }
        ListFooterComponent={
          naTela.length ? (
            <View style={{ paddingTop: 6, gap: 8, alignItems: 'center' }}>
              <Text style={{ color: t.texto3, fontSize: 12.5 }} testID="guia-contagem">{naTela.length} de {Math.max(totalDaLista, naTela.length)} {totalDaLista === 1 ? 'salão' : 'salões'}</Text>
              {faltamNaMemoria || temMaisNoServidor ? <Botao titulo={maisIndo ? 'Carregando…' : 'Mostrar mais'} tipo="fantasma" onPress={() => { void mais() }} desabilitado={maisIndo} estilo={{ alignSelf: 'stretch' }} testID="guia-mais" /> : null}
            </View>
          ) : null
        }
      />
      <Folha aberta={escolhendo} onFechar={fecharFolha}>
        <Text style={[e.folhaTitulo, { color: t.texto }]}>Onde você quer procurar?</Text>
        <Entrada value={filtroLugar} onChangeText={setFiltroLugar} placeholder="Buscar cidade" autoCorrect={false} testID="guia-filtro-lugar" />
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {permissao !== 'negada' ? (
            <Pressable onPress={() => { void usarMinhaLocalizacao() }} accessibilityRole="button" style={({ pressed }) => [e.opcao, { borderColor: t.fio, opacity: pressed ? 0.7 : 1 }]} testID="guia-usar-local">
              <Ionicons name="navigate" size={20} color={t.acento} />
              <Text style={[e.opcaoTexto, { color: t.acento }]}>Usar minha localização</Text>
            </Pressable>
          ) : null}
          {regioes.length ? (
            <View style={{ gap: 8, paddingTop: 12 }}>
              <Text style={[e.secao, { color: t.texto }]}>Regiões</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={regioes}
                keyExtractor={(r) => r.slug}
                contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
                extraData={regiaoNaFolha}
                renderItem={({ item: r }) => {
                  const cs = cidadesDe(r)
                  const marcada = regiaoNaFolha === r.slug
                  return (
                    <Pressable onPress={() => setRegiaoNaFolha(marcada ? null : r.slug)} accessibilityRole="button" accessibilityState={{ selected: marcada }} style={({ pressed }) => [e.regiaoCartao, { borderColor: marcada ? t.acento : 'transparent', opacity: pressed ? 0.85 : 1 }]} testID="guia-regiao-cartao">
                      {r.foto ? <Image source={{ uri: miniatura(r.foto) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <LinearGradient colors={[MARCA.roxo, MARCA.rosa]} style={StyleSheet.absoluteFill} />}
                      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
                      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 10, gap: 2 }}>
                        <Text style={e.regiaoNome} numberOfLines={1}>{r.nome}</Text>
                        <Text style={e.regiaoSub}>{plural(cs.length, 'cidade', 'cidades')} · {plural(totalDe(cs), 'salão', 'salões')}</Text>
                      </View>
                      {marcada ? <View style={e.marca}><Ionicons name="checkmark-circle" size={22} color="#fff" /></View> : null}
                    </Pressable>
                  )
                }}
              />
              {regiaoTocada ? <Botao titulo={`Ver toda a ${regiaoTocada.nome}`} icone="map-outline" tipo="fantasma" onPress={() => escolherRegiao(regiaoTocada.slug)} testID="guia-ver-regiao" /> : null}
            </View>
          ) : null}
          <Text style={[e.secao, { color: t.texto, paddingTop: 14 }]}>{regiaoTocada ? `Cidades da ${regiaoTocada.nome}` : 'Cidades'}</Text>
          {grupos.map((g) => (
            <View key={g.regiao?.slug ?? 'soltas'}>
              {!regiaoTocada ? <Text style={[e.opcaoGrupo, { color: t.texto3 }]}>{g.regiao ? g.regiao.nome : 'Outras cidades'}</Text> : null}
              {g.cidades.map((c) => (
                <Pressable key={c.cidade_slug} onPress={() => escolherCidade(c.cidade_slug)} accessibilityRole="button" style={({ pressed }) => [e.opcao, { borderColor: t.fio, opacity: pressed ? 0.7 : 1 }]} testID="guia-opcao-cidade">
                  <Ionicons name={c.cidade_slug === cidade ? 'radio-button-on' : 'radio-button-off'} size={20} color={c.cidade_slug === cidade ? t.acento : t.texto3} />
                  <Text style={[e.opcaoTexto, { color: t.texto }]}>{c.cidade}, {c.uf}</Text>
                  <Text style={{ color: t.texto3, fontSize: 13 }}>{c.total}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {grupos.length === 0 ? <Text style={{ color: t.texto3, paddingVertical: 12 }}>Nenhuma cidade com esse nome.</Text> : null}
        </ScrollView>
      </Folha>
    </SafeAreaView>
  )
}

// um cartão de categoria: a foto do melhor salão, o ícone e a cor da categoria; a ativa fica marcada
function CategoriaCartao({ c, ativa, onPress }: { c: CategoriaItem; ativa: boolean; onPress: () => void }) {
  const t = useTema()
  const v = visualDe(c.categoria)
  const nome = c.categoria ? categoriaDoGuia(c.categoria).curto : 'Todos'
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: ativa }} style={({ pressed }) => [e.cartaoLugar, { backgroundColor: ativa ? v.cor : t.superficie, borderColor: ativa ? v.cor : t.fio, opacity: pressed ? 0.85 : 1 }]} testID="guia-categoria">
      <View style={e.cartaoFoto}>
        {c.foto ? <Image source={{ uri: miniatura(c.foto) }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} contentFit="cover" transition={150} /> : <LinearGradient colors={[v.cor, MARCA.roxo]} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />}
        <View style={[e.icone, { backgroundColor: v.cor }]}><Ionicons name={v.icone} size={16} color="#fff" /></View>
        {ativa ? <View style={e.marcaCat}><Ionicons name="checkmark-circle" size={22} color="#fff" /></View> : null}
      </View>
      <Text style={[e.cartaoNome, { color: ativa ? '#fff' : t.texto }]} numberOfLines={1}>{nome}</Text>
      <Text style={{ color: ativa ? 'rgba(255,255,255,0.85)' : t.texto3, fontSize: 12 }}>{plural(c.total, 'salão', 'salões')}</Text>
    </Pressable>
  )
}

// a faixa da categoria ativa: a foto, o nome por extenso, o total e o botão de voltar a todos
function FaixaCategoria({ c, lugar, total, onLimpar }: { c: CategoriaItem; lugar: string; total: number; onLimpar: () => void }) {
  const v = visualDe(c.categoria)
  return (
    <View style={[e.faixa, { backgroundColor: v.cor }]} testID="guia-faixa-categoria">
      {c.foto ? <Image source={{ uri: miniatura(c.foto) }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
      <LinearGradient colors={[`${v.cor}f2`, `${v.cor}99`, 'rgba(0,0,0,0.55)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={v.icone} size={18} color="#fff" />
          <Text style={e.faixaTitulo} numberOfLines={1}>{categoriaDoGuia(c.categoria).rotulo}</Text>
        </View>
        <Text style={e.faixaSub} numberOfLines={1}>{plural(total, 'salão', 'salões')}{lugar ? ` ${lugar}` : ''}</Text>
      </View>
      <Pressable onPress={onLimpar} accessibilityRole="button" style={({ pressed }) => [e.faixaBotao, { opacity: pressed ? 0.7 : 1 }]} testID="guia-faixa-limpar">
        <Ionicons name="close" size={14} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12.5 }}>Todas</Text>
      </Pressable>
    </View>
  )
}

// um salão na lista: foto, nome, categoria e bairro (e a cidade, na região), o resumo, os serviços, os selos
function CartaoLugar({ l, km, cidade, onPress }: { l: Cartao; km: number | null; cidade: string; onPress: () => void }) {
  const t = useTema()
  const foto = l.foto ?? (Array.isArray(l.fotos) ? l.fotos[0] : null)
  const cat = categoriaDoGuia(l.categoria)
  const v = visualDe(l.categoria)
  const servicos = (Array.isArray(l.servicos) ? l.servicos : []).filter(Boolean)
  const resumo = typeof l.resumo === 'string' ? l.resumo.trim() : ''
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [e.cartao, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.85 : 1 }]} testID="guia-salao">
      <View style={e.cartaoLinha}>
        {foto ? (
          <Image source={{ uri: miniatura(foto) }} style={e.foto} contentFit="cover" transition={150} />
        ) : (
          <View style={[e.foto, e.centro, { backgroundColor: t.superficie2 }]}>
            <Ionicons name="storefront-outline" size={26} color={t.texto3} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[e.nome, { color: t.texto }]} numberOfLines={1}>{l.nome}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Ionicons name={v.icone} size={12} color={v.cor} />
            <Text style={{ color: t.texto2, fontSize: 13, flex: 1 }} numberOfLines={1}>{[cat.curto, l.bairro, cidade || null].filter(Boolean).join(' · ')}</Text>
          </View>
          {km != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="navigate-outline" size={12} color={t.acento} />
              <Text style={{ color: t.acento, fontSize: 12.5, fontWeight: '700' }}>a {distanciaTexto(km)} de você</Text>
            </View>
          ) : null}
          {resumo ? <Text style={{ color: t.texto2, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>{resumo}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.texto3} />
      </View>
      {servicos.length || l.na_mimo || l.selecao ? (
        <View style={e.selos}>
          {l.na_mimo ? <Selo texto="Agenda pela MIMO" tom="acento" /> : null}
          {l.selecao ? <Selo texto="Seleção MIMO" tom="ok" /> : null}
          {servicos.slice(0, 3).map((s) => <View key={s} style={[e.servico, { backgroundColor: t.superficie2 }]}><Text style={{ color: t.texto2, fontSize: 12 }} numberOfLines={1}>{s}</Text></View>)}
          {servicos.length > 3 ? <Text style={{ color: t.texto3, fontSize: 12, alignSelf: 'center' }}>+{servicos.length - 3}</Text> : null}
        </View>
      ) : null}
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
  cartao: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 8 },
  cartaoLinha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  foto: { width: 84, height: 84, borderRadius: 12 },
  centro: { alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 15.5, fontWeight: '700' },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  servico: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, maxWidth: 160 },
  cartaoLugar: { width: 128, borderWidth: 1, borderRadius: 14, padding: 6, gap: 3 },
  cartaoFoto: { width: '100%', height: 74, borderRadius: 10, overflow: 'hidden' },
  cartaoNome: { fontSize: 13.5, fontWeight: '700' },
  icone: { position: 'absolute', left: 6, bottom: 6, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  marcaCat: { position: 'absolute', right: 4, top: 4 },
  faixa: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, minHeight: 78, overflow: 'hidden' },
  faixaTitulo: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.2, flex: 1 },
  faixaSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  faixaBotao: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  perto: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  folhaTitulo: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  regiaoCartao: { width: 168, height: 100, borderRadius: 14, overflow: 'hidden', borderWidth: 2 },
  regiaoNome: { color: '#fff', fontSize: 15, fontWeight: '800' },
  regiaoSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },
  marca: { position: 'absolute', right: 8, top: 8 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  opcaoGrupo: { fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12, marginBottom: 2 },
  opcaoTexto: { flex: 1, fontSize: 15.5, fontWeight: '600' },
})
