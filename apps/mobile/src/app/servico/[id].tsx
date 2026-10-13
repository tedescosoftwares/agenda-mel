import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { labelDuracao, nomeDaCategoria } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Botao, Carregando, Cartao, Selo, Vazio } from '@/components/ui'
import { paramsDe, useCategorias, type Servico } from '@/lib/agendar'
import { formatDuracao, formatPreco } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { MARCA, useTema } from '@/lib/tema'

// A página de um serviço (a mesma da web, ClienteServico): fotos, descrição,
// preço (com o desconto da promoção que ela enxerga), duração, quem faz e o
// que costuma ir junto. Chega com prof=<id> quando ela já está no fluxo de
// uma profissional e sel=<ids> com o que já tinha escolhido.
type Quem = { id: string; name: string; photo_url: string | null; active: boolean; salon_id: string | null; preco_cents: number | null; duracao_minutos: number | null }
type Junto = { id: string; name: string; price: number; duration_minutes: number; images: string[] | null }
type Desconto = { titulo: string; desconto_pct: number; preco_com_desconto_cents: number }

export default function ServicoPagina() {
  const t = useTema()
  const router = useRouter()
  const q = useLocalSearchParams<{ id: string; prof?: string; sel?: string }>()
  const id = q.id
  const profId = q.prof ?? ''
  const sel = (q.sel ?? '').split(',').filter(Boolean)
  const cats = useCategorias()
  const [s, setS] = useState<Servico | null | undefined>(undefined)
  const [quem, setQuem] = useState<Quem[]>([])
  const [juntos, setJuntos] = useState<Junto[]>([])
  const [desconto, setDesconto] = useState<Desconto | null>(null)
  const [foto, setFoto] = useState(0)

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      ;(async () => {
        const [sv, ps, ju, de] = await Promise.all([
          supabase.from('services').select('*').eq('id', id).maybeSingle(),
          supabase.from('professional_services').select('preco_cents, duracao_minutos, professionals (id, name, photo_url, active, salon_id)').eq('service_id', id),
          supabase.rpc('servicos_sugeridos_para', { servicos: [id] }),
          supabase.rpc('descontos_para_mim', { servicos: [id] }),
        ])
        if (!vivo) return
        setS((sv.data as Servico | null) ?? null)
        setQuem(
          ((ps.data ?? []) as unknown as { preco_cents: number | null; duracao_minutos: number | null; professionals: Omit<Quem, 'preco_cents' | 'duracao_minutos'> | null }[])
            .map((v) => (v.professionals ? { ...v.professionals, preco_cents: v.preco_cents, duracao_minutos: v.duracao_minutos } : null))
            .filter((p): p is Quem => Boolean(p?.active))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        const ids = ((ju.data ?? []) as { sugerido_id: string }[]).map((x) => x.sugerido_id)
        if (ids.length) {
          const { data: js } = await supabase.from('services').select('id, name, price, duration_minutes, images').in('id', ids)
          if (vivo) setJuntos((js ?? []) as Junto[])
        } else setJuntos([])
        setDesconto(((de.data ?? []) as Desconto[])[0] ?? null)
      })()
      return () => {
        vivo = false
      }
    }, [id]),
  )

  if (s === undefined) {
    return (
      <Tela titulo="Serviço">
        <Carregando />
      </Tela>
    )
  }
  if (!s) {
    return (
      <Tela titulo="Serviço">
        <Vazio mostrarMel={false} titulo="Não encontramos esse serviço." />
      </Tela>
    )
  }

  const jaEscolhido = sel.includes(s.id)
  const escolha = jaEscolhido ? sel : [...sel, s.id]
  // com quem: a dos parâmetros, ou a única que faz
  const prof = profId || (quem.length === 1 ? quem[0]!.id : '')
  const fotos = s.images ?? []
  const precoPor = desconto ? desconto.preco_com_desconto_cents / 100 : null

  return (
    <Tela
      titulo={s.name}
      rodape={
        prof ? (
          <>
            {sel.length > 0 && !jaEscolhido ? <Text style={{ color: t.texto2, fontSize: 13 }}>Entra junto com {sel.length === 1 ? 'o que você já escolheu' : `os ${sel.length} que você já escolheu`}.</Text> : null}
            <Botao
              titulo={jaEscolhido ? 'Escolher data' : sel.length ? 'Adicionar e escolher data' : 'Escolher data'}
              icone={jaEscolhido ? 'checkmark' : sel.length ? 'add' : 'calendar-outline'}
              onPress={() => router.push({ pathname: '/agendar/data', params: paramsDe({ prof, servico: escolha.join(',') }) })}
            />
            <Botao titulo={jaEscolhido ? 'Ver outros serviços' : 'Adicionar e ver outros serviços'} tipo="fantasma" onPress={() => router.push({ pathname: '/agendar/servicos', params: paramsDe({ prof, servico: escolha.join(',') }) })} />
          </>
        ) : undefined
      }
    >
      <View style={e.galeria}>
        {fotos.length ? (
          <Image source={{ uri: fotos[foto] ?? fotos[0] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.veu, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="sparkles" size={48} color={MARCA.rosa} />
          </View>
        )}
        {desconto ? (
          <View style={e.selo}>
            <Text style={e.seloTexto}>-{desconto.desconto_pct}%</Text>
          </View>
        ) : null}
        {fotos.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={e.miniaturas} contentContainerStyle={{ gap: 6 }}>
            {fotos.map((f, i) => (
              <Pressable key={f} onPress={() => setFoto(i)} accessibilityLabel={`Foto ${i + 1}`} style={[e.miniatura, { borderColor: i === foto ? '#fff' : 'rgba(255,255,255,0.5)' }]}>
                <Image source={{ uri: f }} style={StyleSheet.absoluteFill} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ gap: 4 }}>
        <Text style={[e.cat, { color: t.texto2 }]}>
          {nomeDaCategoria(cats, s.categoria_id)}
          {s.is_combo ? ' · combo' : ''}
        </Text>
        <Text style={[e.nome, { color: t.texto }]}>{s.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {precoPor != null ? (
            <>
              <Text style={[e.preco, { color: t.texto }]}>{formatPreco(precoPor)}</Text>
              <Text style={{ color: t.texto3, textDecorationLine: 'line-through' }}>{formatPreco(s.price)}</Text>
              <Selo texto={desconto!.titulo} tom="acento" />
            </>
          ) : (
            <Text style={[e.preco, { color: t.texto }]}>
              {s.a_partir ? <Text style={{ color: t.texto2, fontSize: 14, fontWeight: '500' }}>a partir de </Text> : null}
              {formatPreco(s.price)}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="time-outline" size={14} color={t.texto3} />
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>{labelDuracao(s)}</Text>
          </View>
        </View>
      </View>

      {s.description ? (
        <Cartao>
          <Text style={{ color: t.texto, lineHeight: 21 }}>{s.description}</Text>
        </Cartao>
      ) : null}

      {quem.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[e.secao, { color: t.texto }]}>Quem faz</Text>
          {quem.map((p) => (
            <Cartao key={p.id} onPress={() => router.push({ pathname: '/profissional/[id]', params: { id: p.id } })} estilo={[e.linha, p.id === profId ? { borderColor: t.acento } : null]}>
              <Avatar url={p.photo_url} nome={p.name} tamanho={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[e.forte, { color: t.texto }]}>{p.name}</Text>
                {p.id === profId ? <Text style={{ color: t.acento, fontSize: 12.5, fontWeight: '600' }}>você está marcando com ela</Text> : null}
                {p.preco_cents != null || p.duracao_minutos != null ? (
                  <Text style={{ color: t.texto2, fontSize: 12.5 }}>com ela: {[p.preco_cents != null ? formatPreco(p.preco_cents / 100) : null, p.duracao_minutos != null ? formatDuracao(p.duracao_minutos) : null].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.texto3} />
            </Cartao>
          ))}
        </View>
      ) : null}

      {juntos.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[e.secao, { color: t.texto }]}>Costuma ir junto</Text>
          {juntos.map((x) => (
            <Cartao key={x.id} onPress={() => router.push({ pathname: '/servico/[id]', params: { id: x.id, ...(prof ? { prof } : {}), sel: escolha.join(',') } })} estilo={e.linha}>
              <View style={e.foto}>{x.images?.[0] ? <Image source={{ uri: x.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={18} color={MARCA.rosa} />}</View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[e.forte, { color: t.texto }]}>{x.name}</Text>
                <Text style={{ color: t.texto2, fontSize: 13 }}>
                  {formatPreco(x.price)} · {formatDuracao(x.duration_minutes)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.texto3} />
            </Cartao>
          ))}
        </View>
      ) : null}

      {!prof ? (
        <Cartao estilo={{ alignItems: 'center' }}>
          <Text style={{ color: t.texto, fontWeight: '700', textAlign: 'center' }}>{quem.length > 1 ? 'Escolha acima com quem quer marcar.' : 'Ninguém atendendo com este serviço agora.'}</Text>
          {quem.length > 1 ? <Text style={{ color: t.texto2, fontSize: 13.5, textAlign: 'center' }}>Toque numa das profissionais para ver o horário dela.</Text> : null}
        </Cartao>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  galeria: { height: 240, borderRadius: 22, overflow: 'hidden', backgroundColor: '#eee' },
  selo: { position: 'absolute', top: 12, left: 12, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  seloTexto: { color: MARCA.rosaEscuro, fontSize: 12.5, fontWeight: '800' },
  miniaturas: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  miniatura: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 2 },
  cat: { fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  nome: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  preco: { fontSize: 22, fontWeight: '800' },
  secao: { fontSize: 16, fontWeight: '800' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  forte: { fontSize: 15, fontWeight: '700' },
  foto: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,45,122,0.08)', alignItems: 'center', justifyContent: 'center' },
})
