import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Botao, Cartao } from '@/components/ui'
import { WEB_URL } from '@/lib/config'
import { marcarPerguntado, pedirPermissao } from '@/lib/localizacao'
import { ESPACO, useTema } from '@/lib/tema'

// A primeira tela do app (3.66): por que a MIMO pede a localização, e o que
// faz (e não faz) com ela. Aparece uma vez, antes de entrar; "Permitir" abre o
// pedido do sistema, "Agora não" segue sem (a cidade do guia vem pela conexão
// e dá para ligar depois, na aba Guia).
export function Localizacao({ onPronto }: { onPronto: () => void }) {
  const t = useTema()
  const [ocupado, setOcupado] = useState(false)

  async function permitir() {
    setOcupado(true)
    await pedirPermissao().catch(() => false)
    await marcarPerguntado()
    setOcupado(false)
    onPronto()
  }
  async function depois() {
    await marcarPerguntado()
    onPronto()
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }}>
      <ScrollView contentContainerStyle={e.conteudo}>
        <View style={[e.icone, { backgroundColor: t.veu }]}>
          <Ionicons name="navigate-circle-outline" size={46} color={t.acento} />
        </View>
        <Text style={[e.titulo, { color: t.texto }]}>Salões perto de você</Text>
        <Text style={[e.texto, { color: t.texto2 }]}>
          Com a sua localização, a MIMO mostra primeiro os salões, as promoções e as ofertas mais perto de você, e já escolhe a sua cidade no guia.
        </Text>
        <Cartao estilo={{ gap: 8 }}>
          <View style={e.linha}>
            <Ionicons name="shield-checkmark-outline" size={20} color={t.ok} />
            <Text style={[e.forte, { color: t.texto }]}>Seus dados são seus</Text>
          </View>
          <Text style={{ color: t.texto2, lineHeight: 20 }}>A localização fica só no seu aparelho: não guardamos o seu ponto no servidor, não vendemos nem repassamos dados a ninguém. Usamos só para ordenar o que está perto.</Text>
          <Text style={{ color: t.texto2, lineHeight: 20 }}>Você liga ou desliga quando quiser, nos ajustes do celular.</Text>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/privacidade`)} hitSlop={6} accessibilityRole="link">
            <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler a política de privacidade</Text>
          </Pressable>
        </Cartao>
        <View style={{ gap: 10, marginTop: 'auto' }}>
          <Botao titulo="Permitir localização" icone="navigate-outline" onPress={() => void permitir()} carregando={ocupado} />
          <Botao titulo="Agora não" tipo="fantasma" onPress={() => void depois()} desabilitado={ocupado} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, paddingTop: 48, gap: 16, flexGrow: 1 },
  icone: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  titulo: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  texto: { fontSize: 15.5, lineHeight: 23, textAlign: 'center', paddingHorizontal: 6 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  forte: { fontSize: 15.5, fontWeight: '800' },
})
