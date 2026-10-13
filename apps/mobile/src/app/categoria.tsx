import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { labelDuracao } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Carregando, Cartao, Chip, Selo, Vazio } from '@/components/ui'
import { useCategorias } from '@/lib/agendar'
import { formatPreco, primeiroNome } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { ESPACO, MARCA, useTema } from '@/lib/tema'
import { tomDe, type PaginaDoSalao, type ServicoDoSalao } from './salao/[id]'

// A página de uma categoria do salão (a mesma da web, ClienteCategoria): a
// capa no topo e os serviços dela embaixo. Quando mais de uma profissional
// faz o mesmo serviço, mostra quem, e a preferida já vai marcada.
type Desconto = { service_id: string; desconto_pct: number; preco_com_desconto_cents: number }

export default function Categoria() {
  const t = useTema()
  const router = useRouter()
  const { salao, cat } = useLocalSearchParams<{ salao: string; cat: string }>()
  const cats = useCategorias()
  const [pg, setPg] = useState<PaginaDoSalao | null | undefined>(undefined)
  const [descontos, setDescontos] = useState<Record<string, Desconto>>({})
  const [escolhida, setEscolhida] = useState('')

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      supabase.rpc('pagina_do_salao', { salao }).then(async ({ data }) => {
        if (!vivo) return
        const p = (data as PaginaDoSalao | null) ?? null
        setPg(p)
        const ids = (p?.servicos ?? []).map((s) => s.id)
        if (ids.length) {
          const { data: d } = await supabase.rpc('descontos_para_mim', { servicos: ids })
          if (vivo) setDescontos(Object.fromEntries(((d ?? []) as Desconto[]).map((x) => [x.service_id, x])))
        }
      })
      return () => {
        vivo = false
      }
    }, [salao]),
  )

  if (pg === undefined) {
    return (
      <Tela titulo="Categoria">
        <Carregando />
      </Tela>
    )
  }
  const categoria = cat === 'outros' ? { id: '', nome: 'Outros' } : cats.find((c) => c.id === cat)
  if (!pg || !categoria) {
    return (
      <Tela titulo="Categoria">
        {cats.length ? <Vazio mostrarMel={false} titulo="Categoria não encontrada." /> : <Carregando />}
      </Tela>
    )
  }

  // só o que alguém faz (o resto não dá para marcar), da categoria pedida
  const servicos = (pg.servicos ?? []).filter((s) => (s.quem ?? []).length > 0).filter((s) => (cat === 'outros' ? !s.categoria_id || !cats.some((c) => c.id === s.categoria_id) : s.categoria_id === cat))
  const capa = cat !== 'outros' ? pg.capas?.[cat]?.[0] : undefined
  const [a, b] = tomDe(categoria.nome)
  const equipe = pg.equipe ?? []
  const preferida = pg.preferida ? equipe.find((p) => p.id === pg.preferida) : null
  const quemFaz = equipe.filter((p) => servicos.some((s) => (s.quem ?? []).some((q) => q.id === p.id)))
  const filtro = escolhida
  const visiveis = filtro ? servicos.filter((s) => (s.quem ?? []).some((q) => q.id === filtro)) : servicos

  // para onde o toque leva: a escolhida desta visita, senão a preferida (se ela faz), senão a única que faz
  const profPara = (sv: ServicoDoSalao) => {
    const quem = sv.quem ?? []
    if (filtro && quem.some((q) => q.id === filtro)) return filtro
    if (preferida && quem.some((q) => q.id === preferida.id)) return preferida.id
    if (quem.length === 1) return quem[0]!.id
    return ''
  }
  async function marcarPreferida(profId: string) {
    setPg((x) => (x ? { ...x, preferida: profId } : x))
    await supabase.rpc('escolher_preferida', { salao, prof: profId })
  }
  const nomeDe = (id: string) => primeiroNome(quemFaz.find((p) => p.id === id)?.nome)

  return (
    <Tela titulo={categoria.nome}>
      <View style={e.capa}>
        {capa ? <Image source={{ uri: capa }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0.35 }} end={{ x: 0, y: 1 }} />
        <View style={{ padding: 14, gap: 2 }}>
          <Text style={e.capaNome}>{categoria.nome}</Text>
          <Text style={e.capaConta}>
            {servicos.length} {servicos.length === 1 ? 'serviço' : 'serviços'} · {pg.salao?.nome}
          </Text>
        </View>
      </View>

      {quemFaz.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Text style={[e.rotulo, { color: t.texto2 }]}>Com quem?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.fileira}>
            <Chip texto={preferida ? 'Tanto faz' : 'Qualquer uma'} ativo={!filtro} onPress={() => setEscolhida('')} />
            {quemFaz.map((p) => (
              <Pressable key={p.id} onPress={() => setEscolhida(filtro === p.id ? '' : p.id)} style={[e.chipProf, { backgroundColor: filtro === p.id ? t.acento : t.superficie, borderColor: filtro === p.id ? t.acento : t.fio }]}>
                <Avatar url={p.foto} nome={p.nome} tamanho={24} />
                <Text style={{ color: filtro === p.id ? t.acentoTexto : t.texto, fontWeight: '600', fontSize: 13.5 }}>
                  {primeiroNome(p.nome)}
                  {preferida?.id === p.id ? ' ★' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {preferida ? (
            <Text style={{ color: t.texto2, fontSize: 13 }}>
              ★ Sua preferida é {primeiroNome(preferida.nome)}: o toque já vai para ela.
              {filtro && filtro !== preferida.id ? (
                <Text style={{ color: t.acento, fontWeight: '700' }} onPress={() => marcarPreferida(filtro)}>
                  {' '}
                  Tornar {nomeDe(filtro)} a preferida
                </Text>
              ) : null}
            </Text>
          ) : filtro ? (
            <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }} onPress={() => marcarPreferida(filtro)}>
              ★ Marcar {nomeDe(filtro)} como minha preferida neste salão
            </Text>
          ) : null}
        </View>
      ) : null}

      {visiveis.length === 0 ? <Vazio mostrarMel={false} titulo={`Nada nesta categoria${filtro ? ' com ela' : ''}.`} /> : null}
      {visiveis.map((sv) => {
        const prof = profPara(sv)
        const quem = sv.quem ?? []
        const d = descontos[sv.id]
        return (
          <Cartao key={sv.id} onPress={() => router.push({ pathname: '/servico/[id]', params: { id: sv.id, ...(prof ? { prof } : {}) } })} estilo={e.linha}>
            <View style={e.foto}>{sv.images?.[0] ? <Image source={{ uri: sv.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={20} color={MARCA.rosa} />}</View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={[e.nome, { color: t.texto }]}>{sv.name}</Text>
                {sv.is_combo ? <Selo texto="combo" /> : null}
                {d ? <Selo texto={`-${d.desconto_pct}%`} tom="acento" /> : null}
              </View>
              <Text style={{ color: t.texto2, fontSize: 13 }}>
                {d ? (
                  <>
                    <Text style={{ color: t.texto, fontWeight: '800' }}>{formatPreco(d.preco_com_desconto_cents / 100)}</Text> <Text style={{ textDecorationLine: 'line-through' }}>{formatPreco(sv.price)}</Text>
                  </>
                ) : (
                  formatPreco(sv.price)
                )}{' '}
                · {labelDuracao(sv)}
              </Text>
              {quem.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flexDirection: 'row' }}>
                    {quem.slice(0, 4).map((q, i) => (
                      <View key={q.id} style={[e.avatarMini, { borderColor: t.superficie, marginLeft: i ? -7 : 0 }]}>
                        <Avatar url={q.foto} nome={q.nome} tamanho={22} />
                      </View>
                    ))}
                  </View>
                  <Text style={{ color: t.texto2, fontSize: 12.5 }} numberOfLines={1}>
                    {quem.length === 1 ? `com ${primeiroNome(quem[0]!.nome)}` : prof ? `com ${primeiroNome(quem.find((q) => q.id === prof)?.nome)}${preferida?.id === prof ? ' ★' : ''} · +${quem.length - 1}` : `${quem.length} profissionais`}
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.texto3} />
          </Cartao>
        )
      })}
    </Tela>
  )
}

const e = StyleSheet.create({
  capa: { height: 170, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#3d0c4e' },
  capaNome: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  capaConta: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600' },
  rotulo: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sangria: { marginHorizontal: -ESPACO },
  fileira: { paddingHorizontal: ESPACO, gap: 8 },
  chipProf: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 5, paddingRight: 12, minHeight: 36, borderRadius: 999, borderWidth: 1 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  foto: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,45,122,0.08)', alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 15, fontWeight: '700' },
  avatarMini: { borderRadius: 999, borderWidth: 2 },
})
