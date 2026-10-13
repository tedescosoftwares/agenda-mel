import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { agruparPorCategoria, bate, labelDuracao } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Trilha } from '@/components/Trilha'
import { Aviso, Botao, Carregando, Chip, Entrada, Selo } from '@/components/ui'
import { paramsDe, useCategorias, useEscolhas, type Servico } from '@/lib/agendar'
import { formatDuracao, formatPreco } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { ESPACO, MARCA, useTema } from '@/lib/tema'

// Passo 1: os serviços da profissional. Vários entram no mesmo horário
// (até 6). As regras são as da web (AgendarServicos).
type Prof = { id: string; name: string; salon_id: string | null }
type Desconto = { service_id: string; desconto_pct: number; preco_cents: number; preco_com_desconto_cents: number }
type Grupo = { id: string; nome: string; ordem: number; itens: Servico[] }

export default function Servicos() {
  const t = useTema()
  const router = useRouter()
  const esc = useEscolhas()
  const cats = useCategorias()
  const [prof, setProf] = useState<Prof | null>(null)
  const [servicos, setServicos] = useState<Servico[] | null>(null)
  const [sel, setSel] = useState<string[]>(() => esc.servico.split(',').filter(Boolean))
  const [descontos, setDescontos] = useState<Record<string, Desconto>>({})
  const [cat, setCat] = useState('')
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [p, vi] = await Promise.all([
        supabase.from('professionals').select('id, name, salon_id').eq('id', esc.prof).maybeSingle(),
        supabase.from('professional_services').select('services (*)').eq('professional_id', esc.prof),
      ])
      if (!vivo) return
      if (p.error || vi.error) {
        setErro('Não deu para carregar os serviços. Tenta de novo.')
        return
      }
      setProf((p.data as Prof | null) ?? null)
      const lista = ((vi.data ?? []) as unknown as { services: Servico | null }[]).map((v) => v.services).filter((s): s is Servico => Boolean(s?.active))
      setServicos(lista)
      if (lista.length) {
        const { data: d } = await supabase.rpc('descontos_para_mim', { servicos: lista.map((s) => s.id) })
        if (vivo) setDescontos(Object.fromEntries(((d ?? []) as Desconto[]).map((x) => [x.service_id, x])))
      }
    })()
    return () => {
      vivo = false
    }
  }, [esc.prof])

  const precoDe = (s: Servico) => (descontos[s.id] ? descontos[s.id]!.preco_com_desconto_cents / 100 : Number(s.price ?? 0))
  const alternar = (sid: string) => setSel((atual) => (atual.includes(sid) ? atual.filter((x) => x !== sid) : atual.length >= 6 ? atual : [...atual, sid]))
  const escolhidos = sel.map((sid) => servicos?.find((s) => s.id === sid)).filter((s): s is Servico => Boolean(s))
  const totalMin = escolhidos.reduce((a, s) => a + Number(s.duration_minutes ?? 0), 0)
  const totalPreco = escolhidos.reduce((a, s) => a + precoDe(s), 0)
  // muitos serviços: agrupados por categoria, com filtro e busca
  const grupos = useMemo(() => agruparPorCategoria(servicos ?? [], cats) as Grupo[], [servicos, cats])
  const muitos = (servicos?.length ?? 0) > 8
  const visiveis = grupos.filter((g) => !cat || g.id === cat).map((g) => ({ ...g, itens: g.itens.filter((s) => bate(s.name, busca)) })).filter((g) => g.itens.length)

  return (
    <Tela
      titulo="Serviços"
      rodape={
        <>
          {escolhidos.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text style={[e.resumoNomes, { color: t.texto }]} numberOfLines={2}>
                {escolhidos.map((s) => s.name).join(' + ')}
              </Text>
              <Text style={{ color: t.texto2, fontSize: 13 }}>
                {escolhidos.length} {escolhidos.length === 1 ? 'serviço' : 'serviços'} · {formatDuracao(totalMin)} · <Text style={{ color: t.texto, fontWeight: '800' }}>{formatPreco(totalPreco)}</Text>
              </Text>
            </View>
          ) : null}
          <Botao
            titulo={sel.length > 1 ? `Escolher data para os ${sel.length}` : 'Escolher data'}
            icone="calendar-outline"
            desabilitado={!sel.length}
            onPress={() => router.push({ pathname: '/agendar/data', params: paramsDe({ prof: esc.prof, servico: sel.join(',') }) })}
          />
        </>
      }
    >
      <Trilha passo={1} />
      {prof ? <Text style={[e.contexto, { color: t.texto2 }]}>Com {prof.name}.</Text> : null}
      <Text style={[e.dica, { color: t.texto3 }]}>Toque para escolher. Vários serviços entram no mesmo horário, um atrás do outro.</Text>

      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      {servicos === null && !erro ? <Carregando texto="Buscando os serviços…" /> : null}
      {servicos && servicos.length === 0 ? <Aviso tom="info" texto="Ela ainda não cadastrou serviços." /> : null}

      {muitos ? (
        <>
          <Entrada placeholder="Buscar serviço" value={busca} onChangeText={setBusca} autoCorrect={false} />
          {grupos.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.sangria} contentContainerStyle={e.chips}>
              <Chip texto="Todos" ativo={cat === ''} onPress={() => setCat('')} />
              {grupos.map((g) => (
                <Chip key={g.id || 'outros'} texto={g.nome} ativo={cat === g.id} onPress={() => setCat(g.id)} />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {visiveis.length === 0 && (servicos?.length ?? 0) > 0 ? <Text style={{ color: t.texto2, textAlign: 'center' }}>Nada com esse nome.</Text> : null}

      {visiveis.map((g) => (
        <View key={g.id || 'outros'} style={{ gap: 10 }}>
          {grupos.length > 1 ? <Text style={[e.grupo, { color: t.texto2 }]}>{g.nome}</Text> : null}
          {g.itens.map((s) => {
            const marcado = sel.includes(s.id)
            const d = descontos[s.id]
            return (
              <Pressable
                key={s.id}
                onPress={() => alternar(s.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: marcado }}
                style={({ pressed }) => [e.linha, { backgroundColor: marcado ? t.veu : t.superficie, borderColor: marcado ? t.acento : t.fio, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={e.foto}>
                  {s.images?.[0] ? <Image source={{ uri: s.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={20} color={MARCA.rosa} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[e.nome, { color: t.texto, flexShrink: 1 }]} numberOfLines={2}>
                      {s.name}
                    </Text>
                    {d ? <Selo texto={`-${d.desconto_pct}%`} tom="acento" /> : null}
                  </View>
                  <Text style={{ color: t.texto2, fontSize: 13 }}>
                    {d ? (
                      <>
                        <Text style={{ color: t.texto, fontWeight: '800' }}>{formatPreco(precoDe(s))}</Text> <Text style={{ textDecorationLine: 'line-through' }}>{formatPreco(s.price)}</Text>
                      </>
                    ) : (
                      formatPreco(s.price)
                    )}{' '}
                    · {labelDuracao(s)}
                  </Text>
                  {s.description ? (
                    <Text style={{ color: t.texto3, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>
                      {s.description}
                    </Text>
                  ) : null}
                </View>
                <View style={[e.marca, { backgroundColor: marcado ? t.acento : t.superficie2 }]}>
                  <Ionicons name={marcado ? 'checkmark' : 'add'} size={18} color={marcado ? t.acentoTexto : t.acento} />
                </View>
              </Pressable>
            )
          })}
        </View>
      ))}
    </Tela>
  )
}

const e = StyleSheet.create({
  contexto: { fontSize: 15, fontWeight: '600' },
  dica: { fontSize: 13, lineHeight: 18, marginTop: -8 },
  sangria: { marginHorizontal: -ESPACO },
  chips: { paddingHorizontal: ESPACO, gap: 8 },
  grupo: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  foto: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,45,122,0.08)', alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 15, fontWeight: '700' },
  marca: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  resumoNomes: { fontSize: 14, fontWeight: '700' },
})
