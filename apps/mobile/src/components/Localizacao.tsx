import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Botao, Cartao } from '@/components/ui'
import { WEB_URL } from '@/lib/config'
import { abrirAjustes, pedirPermissao, permissaoAtual, type Permissao } from '@/lib/localizacao'
import { ESPACO, useTema } from '@/lib/tema'

// A primeira tela do app (3.66): por que a MIMO pede a localização, e o que
// faz (e não faz) com ela. Aparece em toda abertura enquanto a permissão não
// for dada (3.66.1): "Permitir" abre o pedido do sistema; negada de vez, vira
// "Abrir ajustes"; "Continuar sem" segue só por esta sessão (a cidade do guia
// vem pela conexão, e a aba Guia pede de novo).
export function Localizacao({ onPronto }: { onPronto: () => void }) {
  const t = useTema()
  const [ocupado, setOcupado] = useState(false)
  const [permissao, setPermissao] = useState<Permissao | null>(null)
  useEffect(() => {
    let vivo = true
    permissaoAtual().then((p) => {
      if (vivo) setPermissao(p)
    })
    return () => {
      vivo = false
    }
  }, [])
  const negada = permissao === 'negada'

  async function permitir() {
    setOcupado(true)
    const ok = await pedirPermissao().catch(() => false)
    const agora = ok ? 'ok' : await permissaoAtual()
    setOcupado(false)
    // negou de vez: a tela mostra o caminho dos ajustes; negou por ora: segue, e pergunta na próxima abertura
    if (agora === 'negada') return setPermissao('negada')
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
          <Text style={{ color: t.texto2, lineHeight: 20 }}>Usamos a sua posição para ordenar o que está perto e, de forma aproximada (uns 100 m), para saber de que cidade e região as clientes usam o guia. Não ligamos a posição à sua conta, não vendemos nem repassamos dados a ninguém.</Text>
          <Text style={{ color: t.texto2, lineHeight: 20 }}>Você liga ou desliga quando quiser, nos ajustes do celular.</Text>
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/privacidade`)} hitSlop={6} accessibilityRole="link">
            <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler a política de privacidade</Text>
          </Pressable>
        </Cartao>
        <View style={{ gap: 10, marginTop: 'auto' }}>
          {negada ? (
            <>
              <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>A localização está desligada para a MIMO no seu celular. Ligue nos ajustes: Permissões, Localização.</Text>
              <Botao titulo="Abrir ajustes" icone="settings-outline" onPress={() => void abrirAjustes()} />
            </>
          ) : (
            <Botao titulo="Permitir localização" icone="navigate-outline" onPress={() => void permitir()} carregando={ocupado} />
          )}
          <Pressable onPress={onPronto} hitSlop={8} accessibilityRole="button" disabled={ocupado} style={{ alignSelf: 'center', padding: 8 }} testID="localizacao-sem">
            <Text style={{ color: t.texto3, fontSize: 13.5 }}>Continuar sem localização</Text>
          </Pressable>
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
