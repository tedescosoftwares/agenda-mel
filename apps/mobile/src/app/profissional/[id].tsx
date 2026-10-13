import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { agruparPorCategoria, labelDuracao } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Botao, Carregando, Cartao, Vazio } from '@/components/ui'
import { useCategorias, type Servico } from '@/lib/agendar'
import { dataCurta, formatPreco, iniciais } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { MARCA, useTema } from '@/lib/tema'

// O perfil da profissional (o mesmo da web, ClienteProfissional): foto grande,
// nome, nota, e três abas: Serviços, Avaliações, Sobre. O botão "Agendar
// horário" fica fixo no pé: é a única razão de esta tela existir.
type Prof = { id: string; name: string; slug: string | null; bio: string | null; photo_url: string | null; salon_id: string | null; salons: { name: string; tipo: string | null } | null }
type Avaliacao = { nota: number; comentario: string | null; quem: string | null; quando: string }

export default function Profissional() {
  const t = useTema()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const cats = useCategorias()
  const [prof, setProf] = useState<Prof | null | undefined>(undefined)
  const [preferida, setPreferida] = useState(false)
  const [servicos, setServicos] = useState<Servico[]>([])
  const [nota, setNota] = useState<{ media: number; quantas: number } | null>(null)
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([])
  const [aba, setAba] = useState<'servicos' | 'avaliacoes' | 'sobre'>('servicos')

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      ;(async () => {
        const [p, vi, n, av] = await Promise.all([
          supabase.from('professionals').select('id, name, slug, bio, photo_url, salon_id, salons (name, tipo)').eq('id', id).maybeSingle(),
          supabase.from('professional_services').select('services (*)').eq('professional_id', id),
          supabase.rpc('avaliacao_da_profissional', { prof: id }),
          supabase.rpc('avaliacoes_da_profissional', { prof: id, quantas: 10 }),
        ])
        if (!vivo) return
        const pr = (p.data as unknown as Prof | null) ?? null
        setProf(pr)
        setServicos(((vi.data ?? []) as unknown as { services: Servico | null }[]).map((v) => v.services).filter((s): s is Servico => Boolean(s?.active)))
        setNota(((n.data ?? []) as { media: number; quantas: number }[])[0] ?? null)
        setAvaliacoes((av.data ?? []) as Avaliacao[])
        if (pr?.salon_id) {
          const { data: pp } = await supabase.from('profissional_preferida').select('professional_id').eq('salon_id', pr.salon_id).maybeSingle()
          if (vivo) setPreferida((pp as { professional_id: string } | null)?.professional_id === pr.id)
        }
      })()
      return () => {
        vivo = false
      }
    }, [id]),
  )

  if (prof === undefined) {
    return (
      <Tela titulo="Profissional">
        <Carregando />
      </Tela>
    )
  }
  if (!prof) {
    return (
      <Tela titulo="Profissional">
        <Vazio mostrarMel={false} titulo="Não encontramos essa profissional." />
      </Tela>
    )
  }

  const especialidade = servicos
    .slice(0, 2)
    .map((s) => s.name)
    .join(' e ')
  const salaoNome = prof.salons?.tipo === 'salao' ? prof.salons?.name : null
  async function alternarPreferida() {
    if (!prof?.salon_id) return
    const nova = preferida ? null : prof.id
    setPreferida(Boolean(nova))
    await supabase.rpc('escolher_preferida', { salao: prof.salon_id, prof: nova })
  }
  const grupos = agruparPorCategoria(servicos, cats) as { id: string; nome: string; itens: Servico[] }[]

  return (
    <Tela titulo={prof.name} rodape={<Botao titulo="Agendar horário" icone="calendar-outline" onPress={() => router.push({ pathname: '/agendar/servicos', params: { prof: prof.id } })} />}>
      <View style={e.capa}>
        {prof.photo_url ? (
          <Image source={{ uri: prof.photo_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <LinearGradient colors={[MARCA.rosa, MARCA.roxo]} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#fff', fontSize: 64, fontWeight: '800' }}>{iniciais(prof.name)}</Text>
          </LinearGradient>
        )}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={[e.nome, { color: t.texto }]}>{prof.name}</Text>
        {especialidade ? <Text style={{ color: t.texto2 }}>{especialidade}</Text> : null}
        {salaoNome && prof.salon_id ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Pressable onPress={() => router.push({ pathname: '/salao/[id]', params: { id: prof.salon_id! } })} hitSlop={4}>
              <Text style={{ color: t.acento, fontWeight: '700' }}>{salaoNome}</Text>
            </Pressable>
            <Text style={{ color: t.texto3 }}>·</Text>
            <Pressable onPress={alternarPreferida} hitSlop={4} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name={preferida ? 'star' : 'star-outline'} size={14} color={preferida ? '#f5a623' : t.texto2} />
              <Text style={{ color: preferida ? t.texto : t.texto2, fontWeight: '600', fontSize: 13.5 }}>{preferida ? 'Sua preferida neste salão' : 'Marcar como minha preferida'}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Ionicons name="star" size={14} color="#f5a623" />
          {nota ? (
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>
              <Text style={{ color: t.texto, fontWeight: '800' }}>{Number(nota.media).toFixed(1)}</Text> ({nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'})
            </Text>
          ) : (
            <Text style={{ color: t.texto3, fontSize: 13.5 }}>Ainda sem avaliações</Text>
          )}
        </View>
      </View>

      <View style={[e.abas, { backgroundColor: t.superficie2 }]}>
        {(
          [
            ['servicos', 'Serviços'],
            ['avaliacoes', 'Avaliações'],
            ['sobre', 'Sobre'],
          ] as const
        ).map(([k, r]) => (
          <Pressable key={k} onPress={() => setAba(k)} accessibilityRole="button" accessibilityState={{ selected: aba === k }} style={[e.segmento, aba === k && { backgroundColor: t.superficie }]}>
            <Text style={[e.segmentoTexto, { color: aba === k ? t.texto : t.texto2 }]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      {aba === 'servicos' ? (
        <View style={{ gap: 10 }}>
          {servicos.length === 0 ? <Vazio mostrarMel={false} titulo="Ela ainda não cadastrou serviços." /> : null}
          {grupos.map((g) => (
            <View key={g.id || 'outros'} style={{ gap: 10 }}>
              {grupos.length > 1 ? <Text style={[e.grupo, { color: t.texto2 }]}>{g.nome}</Text> : null}
              {g.itens.map((s) => (
                <Cartao key={s.id} onPress={() => router.push({ pathname: '/servico/[id]', params: { id: s.id, prof: prof.id } })} estilo={e.linha}>
                  <View style={e.foto}>{s.images?.[0] ? <Image source={{ uri: s.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={20} color={MARCA.rosa} />}</View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[e.servico, { color: t.texto }]}>{s.name}</Text>
                    <Text style={{ color: t.texto2, fontSize: 13 }}>
                      {formatPreco(s.price)} · {labelDuracao(s)}
                    </Text>
                  </View>
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>Ver</Text>
                </Cartao>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {aba === 'avaliacoes' ? (
        <View style={{ gap: 10 }}>
          {avaliacoes.length === 0 ? <Vazio mostrarMel={false} titulo="Nenhuma avaliação ainda." texto="Seja a primeira: marque, seja atendida e conte como foi." /> : null}
          {avaliacoes.map((a, i) => (
            <Cartao key={i} estilo={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: t.texto, fontWeight: '800' }}>{a.quem ?? 'Cliente'}</Text>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Ionicons key={n} name={n <= a.nota ? 'star' : 'star-outline'} size={14} color={n <= a.nota ? '#f5a623' : t.texto3} />
                  ))}
                </View>
              </View>
              {a.comentario ? <Text style={{ color: t.texto, lineHeight: 20 }}>{a.comentario}</Text> : null}
              <Text style={{ color: t.texto3, fontSize: 12 }}>{dataCurta(a.quando.slice(0, 10))}/{a.quando.slice(0, 4)}</Text>
            </Cartao>
          ))}
        </View>
      ) : null}

      {aba === 'sobre' ? (
        <Cartao>
          <Text style={{ color: t.texto, lineHeight: 21 }}>{prof.bio || 'Ela ainda não escreveu sobre si.'}</Text>
        </Cartao>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  capa: { height: 240, borderRadius: 22, overflow: 'hidden', backgroundColor: '#eee' },
  nome: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  abas: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 3 },
  segmento: { flex: 1, minHeight: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentoTexto: { fontSize: 14, fontWeight: '700' },
  grupo: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  foto: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(255,45,122,0.08)', alignItems: 'center', justifyContent: 'center' },
  servico: { fontSize: 15, fontWeight: '700' },
})
