import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { toISODate } from '@/lib/formato'
import { RAIO, useTema } from '@/lib/tema'

const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Calendário de mês para escolher o dia (o mesmo da web, CalendarioMes).
// Dia passado ou fechado nasce desabilitado: a tela não mente sobre a oferta.
export function Calendario({ valor, onEscolher, diaAberto, minimo }: { valor?: string; onEscolher: (iso: string) => void; diaAberto?: (d: Date) => boolean; minimo?: string }) {
  const t = useTema()
  const hoje = useMemo(() => new Date(), [])
  const [ancora, setAncora] = useState(() => {
    const base = valor ? new Date(valor + 'T12:00:00') : hoje
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const semanas = useMemo(() => {
    const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1)
    const ultimo = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 0)
    const celulas: (Date | null)[] = []
    for (let i = 0; i < primeiro.getDay(); i++) celulas.push(null)
    for (let d = 1; d <= ultimo.getDate(); d++) celulas.push(new Date(ancora.getFullYear(), ancora.getMonth(), d))
    while (celulas.length % 7 !== 0) celulas.push(null)
    return Array.from({ length: celulas.length / 7 }, (_, i) => celulas.slice(i * 7, i * 7 + 7))
  }, [ancora])

  const pisoISO = minimo ?? toISODate(hoje)
  const hojeISO = toISODate(hoje)
  const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  const podeVoltar = ancora > mesAtual
  const mover = (passo: number) => setAncora((a) => new Date(a.getFullYear(), a.getMonth() + passo, 1))

  return (
    <View style={[e.caixa, { backgroundColor: t.superficie, borderColor: t.fio }]}>
      <View style={e.topo}>
        <Pressable onPress={() => mover(-1)} disabled={!podeVoltar} hitSlop={8} accessibilityLabel="Mês anterior" style={[e.seta, { opacity: podeVoltar ? 1 : 0.3 }]}>
          <Ionicons name="chevron-back" size={20} color={t.texto} />
        </Pressable>
        <Text style={[e.mes, { color: t.texto }]}>
          {MESES[ancora.getMonth()]} {ancora.getFullYear()}
        </Text>
        <Pressable onPress={() => mover(1)} hitSlop={8} accessibilityLabel="Próximo mês" style={e.seta}>
          <Ionicons name="chevron-forward" size={20} color={t.texto} />
        </Pressable>
      </View>
      <View style={e.grade}>
        {DIAS_SEMANA.map((d, i) => (
          <Text key={i} style={[e.celula, e.cabeca, { color: t.texto3 }]}>
            {d}
          </Text>
        ))}
      </View>
      {semanas.map((semana, i) => (
        <View key={i} style={e.grade}>
          {semana.map((d, j) => {
            if (!d) return <View key={j} style={e.celula} />
            const iso = toISODate(d)
            const indisponivel = iso < pisoISO || (diaAberto ? !diaAberto(d) : false)
            const escolhido = iso === valor
            const ehHoje = iso === hojeISO
            return (
              <View key={j} style={e.celula}>
                <Pressable
                  onPress={() => onEscolher(iso)}
                  disabled={indisponivel}
                  accessibilityLabel={`Dia ${d.getDate()}`}
                  style={({ pressed }) => [
                    e.dia,
                    escolhido ? { backgroundColor: t.acento } : ehHoje ? { borderColor: t.acento, borderWidth: 1.5 } : null,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[e.diaTexto, { color: escolhido ? t.acentoTexto : indisponivel ? t.texto3 : ehHoje ? t.acento : t.texto, opacity: indisponivel ? 0.5 : 1 }]}>{d.getDate()}</Text>
                </Pressable>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const e = StyleSheet.create({
  caixa: { borderRadius: RAIO, borderWidth: 1, padding: 10, gap: 2 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  seta: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  mes: { fontSize: 16, fontWeight: '800' },
  grade: { flexDirection: 'row' },
  celula: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  cabeca: { fontSize: 11, fontWeight: '700', paddingVertical: 4 },
  dia: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  diaTexto: { fontSize: 15, fontWeight: '600' },
})
