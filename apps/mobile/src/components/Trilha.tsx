import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { useTema } from '@/lib/tema'

// Os passos do fluxo de marcar. Remarcando, o serviço já está decidido: a
// trilha começa na data.
export function Trilha({ passo, remarcar = false }: { passo: number; remarcar?: boolean }) {
  const t = useTema()
  const nomes = remarcar ? ['Data', 'Hora', 'Confirmar'] : ['Serviço', 'Data', 'Hora', 'Confirmar']
  const atual = remarcar ? passo - 1 : passo
  return (
    <View style={e.trilha}>
      {nomes.map((nome, i) => {
        const n = i + 1
        const feito = n < atual
        const agora = n === atual
        return (
          <View key={nome} style={e.passo}>
            {i > 0 ? <View style={[e.linha, { backgroundColor: feito || agora ? t.acento : t.fio }]} /> : null}
            <View style={[e.bola, { backgroundColor: feito ? t.acento : agora ? t.veu : t.superficie2, borderColor: feito || agora ? t.acento : t.fio }]}>
              {feito ? <Ionicons name="checkmark" size={14} color={t.acentoTexto} /> : <Text style={[e.num, { color: agora ? t.acento : t.texto3 }]}>{n}</Text>}
            </View>
            <Text style={[e.rotulo, { color: agora ? t.texto : t.texto3, fontWeight: agora ? '700' : '600' }]}>{nome}</Text>
          </View>
        )
      })}
    </View>
  )
}

const e = StyleSheet.create({
  trilha: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 2 },
  passo: { flex: 1, alignItems: 'center', gap: 4 },
  linha: { position: 'absolute', top: 12, right: '50%', left: '-50%', height: 2 },
  bola: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  num: { fontSize: 12, fontWeight: '700' },
  rotulo: { fontSize: 11 },
})
