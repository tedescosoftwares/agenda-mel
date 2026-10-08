import { Link, Redirect, useLocalSearchParams, usePathname } from 'expo-router'
import { StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Vazio } from '@/components/ui'
import { useTema } from '@/lib/tema'

// Um link do site que o app não tem como tela própria (mimo.com.vc/cliente/agendamento/123,
// vindo de um lembrete, por exemplo) abre na ponte. Qualquer outra coisa: não existe.
const DA_WEB = /^\/(v|p|cliente|login|cadastro|entrar|termos|privacidade|pro|admin)(\/|$)/

export default function NaoEncontrada() {
  const t = useTema()
  const caminho = usePathname()
  const params = useLocalSearchParams()
  const extras = Object.entries(params).filter(([k, v]) => k !== 'not-found' && typeof v === 'string') as [string, string][]
  const busca = extras.length ? '?' + extras.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : ''

  if (DA_WEB.test(caminho)) return <Redirect href={{ pathname: '/web', params: { ir: caminho + busca } }} />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo, justifyContent: 'center' }}>
      <Vazio titulo="Essa página não existe" texto={`Não achei ${caminho} por aqui.`}>
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
