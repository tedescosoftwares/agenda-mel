import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAtualizacao } from '@/lib/atualizacao'
import { useTema } from '@/lib/tema'

// A faixa "versão nova pronta": aparece por cima das abas quando uma atualização
// OTA terminou de baixar. Ela escolhe quando reiniciar (um toque); fechar a faixa
// deixa para a próxima vez que o app abrir, quando a versão nova entra sozinha.
export function Atualizador() {
  const { pronta, reiniciar } = useAtualizacao()
  const t = useTema()
  const inset = useSafeAreaInsets()
  if (!pronta) return null
  return (
    <View pointerEvents="box-none" style={[e.lugar, { bottom: Math.max(inset.bottom, 8) + 60 }]}>
      <View style={[e.faixa, { backgroundColor: t.texto, shadowColor: '#000' }]} accessibilityLiveRegion="polite">
        <Ionicons name="sparkles-outline" size={18} color={t.fundo} />
        <Text style={[e.texto, { color: t.fundo }]} numberOfLines={2}>Uma versão nova da MIMO está pronta.</Text>
        <Pressable onPress={reiniciar} accessibilityRole="button" style={({ pressed }) => [e.botao, { backgroundColor: t.acento, opacity: pressed ? 0.8 : 1 }]} testID="ota-reiniciar">
          <Text style={[e.botaoTexto, { color: t.acentoTexto }]}>Reiniciar</Text>
        </Pressable>
      </View>
    </View>
  )
}

const e = StyleSheet.create({
  lugar: { position: 'absolute', left: 12, right: 12 },
  faixa: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  texto: { flex: 1, fontSize: 13.5, fontWeight: '600' },
  botao: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  botaoTexto: { fontSize: 13.5, fontWeight: '800' },
})
