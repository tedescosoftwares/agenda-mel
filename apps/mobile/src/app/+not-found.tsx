import { Link, Redirect, useLocalSearchParams, usePathname } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Vazio } from '@/components/ui'
import { WEB_URL } from '@/lib/config'
import { rotaNativa } from '@/lib/ponte'
import { useTema } from '@/lib/tema'

// Um link do site com o caminho antigo (mimo.com.vc/cliente/agendamento/123,
// vindo de um lembrete, por exemplo) cai na tela nativa dele. O que não tem
// tela no app abre no navegador; qualquer outra coisa não existe.
const DA_WEB = /^\/(v|p|cliente|login|cadastro|entrar|termos|privacidade|pro|admin|blog)(\/|$)/

export default function NaoEncontrada() {
  const t = useTema()
  const caminho = usePathname()
  const params = useLocalSearchParams()
  const extras = Object.entries(params).filter(([k, v]) => k !== 'not-found' && typeof v === 'string') as [string, string][]
  const busca = extras.length ? '?' + extras.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : ''

  const nativa = rotaNativa(caminho + busca)
  if (nativa) return <Redirect href={nativa} />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo, justifyContent: 'center' }}>
      <Vazio titulo="Essa página não existe" texto={`Não achei ${caminho} por aqui.`}>
        {DA_WEB.test(caminho) ? (
          <Pressable onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}${caminho}${busca}`)} hitSlop={6} accessibilityRole="button">
            <Text style={[e.link, { color: t.acento }]}>Abrir no site</Text>
          </Pressable>
        ) : null}
        <Link href="/" style={[e.link, { color: t.acento }]}>
          <Text>Ir para o início</Text>
        </Link>
      </Vazio>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  link: { textAlign: 'center', fontWeight: '700', fontSize: 15, padding: 12 },
})
