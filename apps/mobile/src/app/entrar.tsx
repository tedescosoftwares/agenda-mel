import { Image } from 'expo-image'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Aviso, Botao } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { CONFIGURADO, NOME_DO_APP, VARIANTE, VERSAO } from '@/lib/config'
import { useAbrirWeb } from '@/lib/ponte'
import { ESPACO, useTema } from '@/lib/tema'
import iconeCliente from '../../assets/images/cliente/icone.png'
import iconePro from '../../assets/images/pro/icone.png'

// Entrar: e-mail e senha, direto no Supabase. Criar conta e recuperar senha
// já existem na web, então abrem na ponte; quando a web termina o login ela
// avisa o app (src/lib/app.js na web) e a sessão passa a ser do app também.
export default function Entrar() {
  const t = useTema()
  const { entrar } = useSessao()
  const abrir = useAbrirWeb()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  async function enviar() {
    if (!email.trim() || !senha) {
      setErro('Preenche o e-mail e a senha.')
      return
    }
    setEntrando(true)
    setErro(null)
    const falha = await entrar(email, senha)
    setEntrando(false)
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
            <Text style={[e.titulo, { color: t.texto }]}>Oi! Que bom te ver.</Text>
            <Text style={[e.sub, { color: t.texto2 }]}>Entra com a mesma conta do site: seus horários e salões já estão aqui.</Text>
          </View>

          {!CONFIGURADO ? (
            <Aviso tom="erro" texto="Faltam as credenciais do Supabase: EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env do app (veja .env.example)." />
          ) : null}

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
            returnKeyType="next"
          />
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
          {erro ? <Aviso tom="erro" texto={erro} /> : null}
          <Botao titulo="Entrar" onPress={enviar} carregando={entrando} />
          <Botao titulo="Esqueci a senha" tipo="linha" onPress={() => abrir('/login?modo=esqueci', 'Recuperar senha')} />

          <View style={e.rodape}>
            <Text style={{ color: t.texto2 }}>Primeira vez na MIMO?</Text>
            <Botao titulo="Criar conta" tipo="fantasma" icone="sparkles-outline" onPress={() => abrir('/cadastro', 'Criar conta')} />
          </View>
          <Text style={[e.versao, { color: t.texto3 }]}>
            {NOME_DO_APP} {VERSAO}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, paddingTop: 36, gap: 12, flexGrow: 1 },
  marca: { alignItems: 'center', gap: 8, marginBottom: 16 },
  logo: { width: 88, height: 88, borderRadius: 24, marginBottom: 6 },
  titulo: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  sub: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', paddingHorizontal: 12 },
  campo: { minHeight: 50, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 },
  rodape: { marginTop: 'auto', paddingTop: 24, alignItems: 'center', gap: 10 },
  versao: { textAlign: 'center', fontSize: 12, marginTop: 8 },
})
