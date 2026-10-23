import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Aviso, Botao } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { CONFIGURADO, NOME_DO_APP, SUPABASE_URL, VARIANTE, VERSAO, WEB_URL } from '@/lib/config'
import { extrairCodigo, guardarConvite } from '@/lib/convite'
import { entrarComGoogle, provedoresLigados } from '@/lib/oauth'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'
import iconeCliente from '../../assets/images/cliente/icone.png'
import iconePro from '../../assets/images/pro/icone.png'

// Entrar: e-mail e senha, direto no Supabase; ou com o Google (3.60), no app da
// cliente, quando o provedor está ligado. "Esqueci a senha" manda o link
// por e-mail (o link abre o site, que pede a senha nova; a senha vale aqui).
// Criar conta é nativo (cadastro.tsx) e nasce de um convite: ?convite=ANA7K2
// chega pelo QR ou pelo link /v/CODIGO e, depois de entrar, a sessão já põe
// a pessoa na agenda (src/context/sessao.tsx).
export default function Entrar() {
  const t = useTema()
  const router = useRouter()
  const { entrar } = useSessao()
  const { convite: bruto, email: emailParam } = useLocalSearchParams<{ convite?: string; email?: string }>()
  const convite = extrairCodigo(bruto)
  const [modo, setModo] = useState<'login' | 'esqueci'>('login')
  const [email, setEmail] = useState(emailParam ?? '')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [quem, setQuem] = useState<{ codigo: string; nome: string } | null>(null)
  const [google, setGoogle] = useState(false)
  const [googleOcupado, setGoogleOcupado] = useState(false)

  // o Google aparece só no app da cliente, e só com o provedor ligado no Supabase
  useEffect(() => {
    if (VARIANTE !== 'cliente' || !CONFIGURADO) return
    let vivo = true
    provedoresLigados().then((p) => {
      if (vivo) setGoogle(Boolean(p.google))
    })
    return () => {
      vivo = false
    }
  }, [])

  async function comGoogle() {
    setErro(null)
    setInfo(null)
    setGoogleOcupado(true)
    const falha = await entrarComGoogle()
    setGoogleOcupado(false)
    if (falha) setErro(falha)
    // deu certo: a sessão muda e o _layout troca para as abas (ou pede o WhatsApp)
  }

  // veio por um convite: diz quem convidou e guarda o código para depois do login
  useEffect(() => {
    if (!convite) return
    let vivo = true
    guardarConvite(convite)
    supabase.rpc('resolver_codigo', { chave: convite }).then(({ data }) => {
      const nome = (data as { nome?: string } | null)?.nome
      if (vivo && nome) setQuem({ codigo: convite, nome })
    })
    return () => {
      vivo = false
    }
  }, [convite])
  const convidou = quem && quem.codigo === convite ? quem.nome : null

  async function enviar() {
    setErro(null)
    setInfo(null)
    if (modo === 'esqueci') {
      if (!email.trim()) {
        setErro('Preenche o e-mail da sua conta.')
        return
      }
      setOcupado(true)
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${WEB_URL}/login` })
      setOcupado(false)
      if (error) {
        setErro(error.message)
        return
      }
      setInfo('Se esse e-mail tiver conta, mandamos um link para criar uma senha nova. Pode abrir pelo celular mesmo: a senha nova vale aqui no app.')
      setModo('login')
      return
    }
    if (!email.trim() || !senha) {
      setErro('Preenche o e-mail e a senha.')
      return
    }
    setOcupado(true)
    const falha = await entrar(email, senha)
    setOcupado(false)
    if (falha) setErro(falha)
    // deu certo: o Stack.Protected do _layout troca para as abas sozinho
  }

  const campo = [e.campo, { backgroundColor: t.superficie, borderColor: t.fio, color: t.texto }]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={e.conteudo} keyboardShouldPersistTaps="handled">
          <View style={e.marca}>
            <Image source={VARIANTE === 'pro' ? iconePro : iconeCliente} style={e.logo} contentFit="contain" />
            <Text style={[e.titulo, { color: t.texto }]}>{modo === 'esqueci' ? 'Recuperar senha' : 'Oi! Que bom te ver.'}</Text>
            <Text style={[e.sub, { color: t.texto2 }]}>{modo === 'esqueci' ? 'Diz o e-mail da sua conta e mandamos um link para criar uma senha nova.' : 'Entra com a mesma conta do site: seus horários e salões já estão aqui.'}</Text>
          </View>

          {!CONFIGURADO ? (
            <Aviso tom="erro" texto="Faltam as credenciais do Supabase: EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env do app (veja .env.example)." />
          ) : null}
          {convidou ? <Aviso tom="info" icone="sparkles-outline" texto={`${convidou} te convidou. Entre e você já cai na agenda.`} /> : null}

          <TextInput
            style={campo}
            placeholder="seu e-mail"
            placeholderTextColor={t.texto3}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            returnKeyType={modo === 'esqueci' ? 'go' : 'next'}
            onSubmitEditing={modo === 'esqueci' ? enviar : undefined}
          />
          {modo === 'login' ? (
            <TextInput
              style={campo}
              placeholder="sua senha"
              placeholderTextColor={t.texto3}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
              value={senha}
              onChangeText={setSenha}
              returnKeyType="go"
              onSubmitEditing={enviar}
            />
          ) : null}
          {erro ? <Aviso tom="erro" texto={erro} /> : null}
          {info ? <Aviso tom="info" texto={info} /> : null}
          <Botao titulo={modo === 'esqueci' ? 'Enviar link' : 'Entrar'} onPress={enviar} carregando={ocupado} />
          {google && modo === 'login' ? (
            <>
              <View style={e.ou}>
                <View style={[e.ouLinha, { backgroundColor: t.fio }]} />
                <Text style={{ color: t.texto3, fontSize: 12.5 }}>ou</Text>
                <View style={[e.ouLinha, { backgroundColor: t.fio }]} />
              </View>
              <Botao titulo="Continuar com Google" tipo="linha" icone="logo-google" onPress={comGoogle} carregando={googleOcupado} />
            </>
          ) : null}
          {modo === 'esqueci' ? (
            <Botao
              titulo="Voltar"
              tipo="linha"
              onPress={() => {
                setErro(null)
                setModo('login')
              }}
            />
          ) : (
            <Botao
              titulo="Esqueci a senha"
              tipo="linha"
              onPress={() => {
                setErro(null)
                setInfo(null)
                setModo('esqueci')
              }}
            />
          )}

          <View style={e.rodape}>
            <Text style={{ color: t.texto2 }}>Primeira vez na MIMO?</Text>
            <Botao titulo="Criar conta" tipo="fantasma" icone="sparkles-outline" onPress={() => router.push({ pathname: '/cadastro', params: convite ? { convite } : {} })} estilo={{ alignSelf: 'stretch' }} />
            <Pressable onPress={() => router.push('/ler-qr')} hitSlop={6} accessibilityRole="button">
              <Text style={{ color: t.acento, fontWeight: '700' }}>Recebeu um QR? Ler com a câmera</Text>
            </Pressable>
          </View>
          <Text style={[e.versao, { color: t.texto3 }]}>
            {NOME_DO_APP} {VERSAO} · {CONFIGURADO ? hostDe(SUPABASE_URL) : 'Supabase não configurado'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// só o host (abcd.supabase.co): mostra qual projeto o app está usando sem expor nada
function hostDe(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, paddingTop: 36, gap: 12, flexGrow: 1 },
  marca: { alignItems: 'center', gap: 8, marginBottom: 16 },
  logo: { width: 88, height: 88, borderRadius: 24, marginBottom: 6 },
  titulo: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  sub: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', paddingHorizontal: 12 },
  campo: { minHeight: 50, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 },
  ou: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  ouLinha: { flex: 1, height: 1 },
  rodape: { marginTop: 'auto', paddingTop: 24, alignItems: 'center', gap: 12 },
  versao: { textAlign: 'center', fontSize: 12, marginTop: 8 },
})
