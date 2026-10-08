import { Ionicons } from '@expo/vector-icons'
import type { Session } from '@supabase/supabase-js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview'
import { Botao, Vazio } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { VARIANTE, VERSAO, WEB_URL } from '@/lib/config'
import { caminhoSeguro } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// A ponte: a web da MIMO dentro do app, com a sessão do app.
//
// Abre WEB_URL/sessao-app?ir=<caminho> injetando window.__mimoSessao antes da
// página carregar; a web (src/pages/SessaoApp.jsx) assume a sessão e segue
// para o caminho pedido. Dali em diante:
//   app -> web   token renovado aqui: injectJavaScript atualiza window.__mimoSessao
//                e dispara 'mimo:sessao' (a web chama setSession)
//   web -> app   postMessage JSON: { tipo: 'sessao', access_token, refresh_token }
//                (login feito na web), { tipo: 'sair' }, { tipo: 'fechar' },
//                { tipo: 'abrir', url }, { tipo: 'titulo', texto }
// A WebView só navega dentro de WEB_URL; qualquer outro endereço (WhatsApp,
// mapa, telefone) vai para o sistema. Assim o token nunca é injetado fora da MIMO.
type Mensagem = { tipo?: string; access_token?: string; refresh_token?: string; url?: string; texto?: string }

const ORIGEM = WEB_URL
const SAEM_DO_APP = /^(https?|mailto|tel|sms|whatsapp|geo|maps|intent):/i

function scriptInicial(s: Session | null) {
  const sessao = s ? { access_token: s.access_token, refresh_token: s.refresh_token } : null
  const app = { variante: VARIANTE, versao: VERSAO, plataforma: Platform.OS }
  return `window.__mimoApp = ${JSON.stringify(app)}; window.__mimoSessao = ${JSON.stringify(sessao)}; true;`
}

function scriptDeAtualizacao(s: Session) {
  const sessao = { access_token: s.access_token, refresh_token: s.refresh_token }
  return `window.__mimoSessao = ${JSON.stringify(sessao)}; window.dispatchEvent(new Event('mimo:sessao')); true;`
}

export default function Ponte() {
  const { ir, titulo } = useLocalSearchParams<{ ir?: string; titulo?: string }>()
  const { sessao } = useSessao()
  const router = useRouter()
  const t = useTema()
  const ref = useRef<WebView>(null)
  const ultimoToken = useRef<string | null>(sessao?.access_token ?? null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [podeVoltar, setPodeVoltar] = useState(false)
  const [tituloDaPagina, setTituloDaPagina] = useState(titulo ?? '')
  // a sessão injetada é a da abertura; o que mudar depois entra por injectJavaScript
  const [injetado] = useState(() => scriptInicial(sessao))

  const destino = caminhoSeguro(ir)
  const url = `${ORIGEM}/sessao-app?ir=${encodeURIComponent(destino)}`

  // o app renovou ou trocou a sessão: a página assume; saiu: a ponte fecha
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'SIGNED_OUT') {
        router.replace('/entrar')
        return
      }
      if (!s || s.access_token === ultimoToken.current) return
      ultimoToken.current = s.access_token
      ref.current?.injectJavaScript(scriptDeAtualizacao(s))
    })
    return () => subscription.unsubscribe()
  }, [router])

  // botão físico de voltar (Android): volta dentro da web antes de fechar a ponte
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (podeVoltar) {
        ref.current?.goBack()
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [podeVoltar])

  function fechar() {
    if (router.canGoBack()) router.back()
    else router.replace(sessao ? '/' : '/entrar')
  }

  function aoReceber(ev: WebViewMessageEvent) {
    if (!ev.nativeEvent.url?.startsWith(ORIGEM)) return
    let msg: Mensagem
    try {
      msg = JSON.parse(ev.nativeEvent.data) as Mensagem
    } catch {
      return
    }
    switch (msg.tipo) {
      case 'sessao':
        if (msg.access_token && msg.refresh_token && msg.access_token !== ultimoToken.current) {
          ultimoToken.current = msg.access_token
          supabase.auth.setSession({ access_token: msg.access_token, refresh_token: msg.refresh_token }).catch(() => {})
        }
        break
      case 'sair':
        supabase.auth.signOut().catch(() => {})
        break
      case 'fechar':
        fechar()
        break
      case 'abrir':
        if (msg.url && SAEM_DO_APP.test(msg.url)) Linking.openURL(msg.url).catch(() => {})
        break
      case 'titulo':
        setTituloDaPagina(String(msg.texto ?? ''))
        break
    }
  }

  function aoNavegar(nav: WebViewNavigation) {
    setPodeVoltar(nav.canGoBack)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.superficie }} edges={['top', 'bottom']}>
      <View style={[e.barra, { borderBottomColor: t.fio, backgroundColor: t.superficie }]}>
        <Pressable onPress={fechar} hitSlop={10} style={e.icone} accessibilityLabel="Fechar">
          <Ionicons name="close" size={24} color={t.texto} />
        </Pressable>
        <Text style={[e.titulo, { color: t.texto }]} numberOfLines={1}>
          {tituloDaPagina || 'MIMO'}
        </Text>
        {carregando ? (
          <ActivityIndicator color={t.acento} style={e.icone} />
        ) : (
          <Pressable onPress={() => ref.current?.reload()} hitSlop={10} style={e.icone} accessibilityLabel="Recarregar">
            <Ionicons name="refresh" size={22} color={t.texto2} />
          </Pressable>
        )}
      </View>

      {erro ? (
        <Vazio titulo="Não deu para abrir" texto={erro} mostrarMel={false}>
          <Botao titulo="Tentar de novo" onPress={() => setErro(null)} />
          <Botao titulo="Fechar" tipo="linha" onPress={fechar} />
        </Vazio>
      ) : (
        <WebView
          ref={ref}
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: t.fundo }}
          injectedJavaScriptBeforeContentLoaded={injetado}
          onMessage={aoReceber}
          onNavigationStateChange={aoNavegar}
          onShouldStartLoadWithRequest={(req) => {
            const u = req.url
            if (u.startsWith(ORIGEM) || u.startsWith('about:')) return true
            if (SAEM_DO_APP.test(u)) Linking.openURL(u).catch(() => {})
            return false
          }}
          onLoadStart={() => setCarregando(true)}
          onLoadEnd={() => setCarregando(false)}
          onError={(ev) => {
            setCarregando(false)
            setErro(ev.nativeEvent.description || 'Confere a conexão e tenta de novo.')
          }}
          applicationNameForUserAgent={`MIMOApp/${VERSAO} (${VARIANTE})`}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          domStorageEnabled
          javaScriptEnabled
          sharedCookiesEnabled
          textZoom={100}
        />
      )}
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  barra: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, height: 50, borderBottomWidth: StyleSheet.hairlineWidth },
  icone: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titulo: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
})
