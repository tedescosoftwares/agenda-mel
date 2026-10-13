import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { formatDataLonga, labelDuracao } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Trilha } from '@/components/Trilha'
import { Botao, Carregando, Cartao, Chip } from '@/components/ui'
import { capitalizar, paramsDe, useContexto, useEscolhas } from '@/lib/agendar'
import { formatPreco } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Passo 3: a hora. Os horários livres são do banco (horarios_livres), que
// já considera a duração, a antecedência mínima e o que está ocupado.
export default function Hora() {
  const t = useTema()
  const router = useRouter()
  const esc = useEscolhas()
  const { servico } = useContexto(esc.prof, esc.servico)
  const [slots, setSlots] = useState<string[] | null>(null)
  const [hora, setHora] = useState(esc.hora)

  const duracao = servico?.duration_minutes
  useEffect(() => {
    if (!esc.prof || !esc.data || !duracao) return
    let vivo = true
    supabase.rpc('horarios_livres', { prof: esc.prof, dia: esc.data, duracao }).then(({ data }) => {
      if (vivo) setSlots(((data ?? []) as { hora: string }[]).map((h) => String(h.hora ?? h).slice(0, 5)))
    })
    return () => {
      vivo = false
    }
  }, [esc.prof, esc.data, duracao])

  return (
    <Tela
      titulo={esc.remarcar ? 'Nova hora' : 'Escolher hora'}
      rodape={<Botao titulo="Continuar" icone="arrow-forward" desabilitado={!hora} onPress={() => router.push({ pathname: '/agendar/confirmar', params: paramsDe({ ...esc, hora }) })} />}
    >
      <Trilha passo={3} remarcar={Boolean(esc.remarcar)} />
      {esc.data ? <Text style={[e.data, { color: t.texto }]}>{capitalizar(formatDataLonga(esc.data))}</Text> : null}

      <Text style={[e.secao, { color: t.texto }]}>Horários disponíveis</Text>
      {slots === null ? (
        <Carregando texto="Buscando…" />
      ) : slots.length === 0 ? (
        <Cartao estilo={{ alignItems: 'center' }}>
          <Text style={{ color: t.texto, fontWeight: '700' }}>Nenhum horário livre neste dia.</Text>
          <Botao titulo="Escolher outro dia" tipo="fantasma" onPress={() => router.back()} />
        </Cartao>
      ) : (
        <View style={e.grade}>
          {slots.map((h) => (
            <Chip key={h} texto={h} ativo={h === hora} onPress={() => setHora(h)} estilo={e.slot} />
          ))}
        </View>
      )}

      {servico ? (
        <Cartao estilo={{ gap: 6 }}>
          <View style={e.linha}>
            <Text style={{ color: t.texto2 }}>Valor</Text>
            <Text style={{ color: t.texto, fontWeight: '800' }}>{formatPreco(servico.price)}</Text>
          </View>
          <View style={e.linha}>
            <Text style={{ color: t.texto2 }}>Duração</Text>
            <Text style={{ color: t.texto, fontWeight: '600' }}>{labelDuracao(servico)}</Text>
          </View>
        </Cartao>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  data: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  secao: { fontSize: 16, fontWeight: '800', marginTop: -4 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { width: '31%', minHeight: 44, flexGrow: 1 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})
