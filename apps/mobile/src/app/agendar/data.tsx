import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Calendario } from '@/components/Calendario'
import { Tela } from '@/components/Tela'
import { Trilha } from '@/components/Trilha'
import { Chip } from '@/components/ui'
import { curta, paramsDe, useContexto, useEscolhas } from '@/lib/agendar'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Passo 2: o dia. O calendário desabilita o que passou e os dias em que a
// profissional não atende; as datas sugeridas vêm de dias_com_vaga.
type Hora = { weekday: number; open: boolean }

export default function Data() {
  const t = useTema()
  const router = useRouter()
  const esc = useEscolhas()
  const { prof, servico } = useContexto(esc.prof, esc.servico)
  const [horas, setHoras] = useState<Hora[]>([])
  const [sugeridos, setSugeridos] = useState<{ dia: string; vagas: number }[]>([])

  useEffect(() => {
    if (!esc.prof) return
    let vivo = true
    supabase
      .from('professional_hours')
      .select('weekday, open')
      .eq('professional_id', esc.prof)
      .then(({ data }) => {
        if (vivo) setHoras((data ?? []) as Hora[])
      })
    return () => {
      vivo = false
    }
  }, [esc.prof])

  const duracao = servico?.duration_minutes
  useEffect(() => {
    if (!esc.prof || !duracao) return
    let vivo = true
    supabase.rpc('dias_com_vaga', { prof: esc.prof, duracao, quantos: 3 }).then(({ data }) => {
      if (vivo) setSugeridos((data ?? []) as { dia: string; vagas: number }[])
    })
    return () => {
      vivo = false
    }
  }, [esc.prof, duracao])

  const diaAberto = (d: Date) => Boolean(horas.find((h) => h.weekday === d.getDay())?.open)
  const seguir = (iso: string) => router.push({ pathname: '/agendar/hora', params: paramsDe({ ...esc, data: iso }) })

  return (
    <Tela titulo={esc.remarcar ? 'Nova data' : 'Escolher data'}>
      <Trilha passo={2} remarcar={Boolean(esc.remarcar)} />
      {prof && servico ? (
        <Text style={[e.contexto, { color: t.texto2 }]}>
          {esc.remarcar ? 'Remarcando ' : ''}
          {servico.name} com {prof.name}
        </Text>
      ) : null}

      <Calendario valor={esc.data || undefined} diaAberto={horas.length ? diaAberto : undefined} onEscolher={seguir} />

      {sugeridos.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[e.secao, { color: t.texto }]}>Datas disponíveis</Text>
          <View style={e.chips}>
            {sugeridos.map((d) => (
              <Chip key={d.dia} texto={curta(d.dia)} ativo={esc.data === d.dia} onPress={() => seguir(d.dia)} />
            ))}
          </View>
        </View>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  contexto: { fontSize: 15, fontWeight: '600' },
  secao: { fontSize: 16, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
