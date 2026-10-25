import { Ionicons } from '@expo/vector-icons'
import * as Linking from 'expo-linking'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { AppState, Linking as LinkingRN, Pressable, StyleSheet, Text, View } from 'react-native'
import { chamada, foneValido, formatarFone, linkWhats, numeroWhats } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Aviso, Botao, Caixa, Cartao, Entrada } from '@/components/ui'
import { WEB_URL } from '@/lib/config'
import { useConfig } from '@/lib/configPublica'
import { extrairCodigo, guardarConvite } from '@/lib/convite'
import { entrarComGoogle, provedoresLigados } from '@/lib/oauth'
import { mascaraData, nascimentoOk, paraIso } from '@/lib/datas'
import { aceitesDaCliente } from '@/lib/legal'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// O cadastro da cliente (o mesmo da web, CadastroCliente). Com ou sem convite
// (3.65): a conta nasce sozinha e os vínculos vêm depois, pelo guia, pelo QR,
// pelo link ou pelo código. Quando o convite vem (?convite=ANA7K2, do QR ou do
// link /v/CODIGO), ele vai nos metadados da conta e o servidor cria o vínculo
// quando o perfil nasce (053); aniversário e aceite também (065). Dois passos
// curtos (quem é você, e como você entra) e no fim "confira seu e-mail", com
// reenvio. Ou, em um toque, com o Google (3.60): a sessão nasce, o código
// guardado vira o vínculo e o app pede o WhatsApp em seguida (completar.tsx).
type Alvo = { tipo: string; nome: string; foto: string | null }

export default function Cadastro() {
  const t = useTema()
  const router = useRouter()
  const cfg = useConfig()
  const { convite: bruto } = useLocalSearchParams<{ convite?: string }>()
  const convite = extrairCodigo(bruto)
  const [quem, setQuem] = useState<{ codigo: string; alvo: Alvo | null } | null>(null)
  const [passo, setPasso] = useState<1 | 2>(1)
  const [codigo, setCodigo] = useState('')
  const [comCodigo, setComCodigo] = useState(false)
  const [nome, setNome] = useState('')
  const [fone, setFone] = useState('')
  const [nasc, setNasc] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [termos, setTermos] = useState(false)
  const [erro, setErro] = useState('')
  const [jaTem, setJaTem] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [reenviado, setReenviado] = useState('')
  const [google, setGoogle] = useState(false)
  const [googleOcupado, setGoogleOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    provedoresLigados().then((p) => {
      if (vivo) setGoogle(Boolean(p.google))
    })
    return () => {
      vivo = false
    }
  }, [])

  async function comGoogle() {
    setErro('')
    setGoogleOcupado(true)
    const falha = await entrarComGoogle()
    setGoogleOcupado(false)
    if (falha) setErro(falha)
  }

  // quem convidou (o código fica guardado: se ela só entrar, o vínculo nasce no login)
  useEffect(() => {
    if (!convite) return
    let vivo = true
    guardarConvite(convite)
    supabase.rpc('resolver_codigo', { chave: convite }).then(({ data }) => {
      if (vivo) setQuem({ codigo: convite, alvo: (data as Alvo | null) ?? null })
    })
    return () => {
      vivo = false
    }
  }, [convite])

  const alvo = quem && quem.codigo === convite ? quem.alvo : undefined
  const primeiroNome = alvo?.nome ? alvo.nome.split(' ')[0] : ''

  function usarCodigo() {
    const c = extrairCodigo(codigo)
    if (!c) {
      setErro('Isso não parece um código da MIMO: são seis letras, ou o link /v/…')
      return
    }
    setErro('')
    setComCodigo(false)
    router.setParams({ convite: c })
  }

  async function seguir() {
    setErro('')
    setJaTem(false)
    if (nome.trim().split(' ').length < 2) {
      setErro('Diga seu nome e sobrenome, do jeito que a profissional te conhece.')
      return
    }
    if (!foneValido(fone)) {
      setErro('Confere o WhatsApp: DDD + 9 dígitos, como (13) 99999-9999.')
      return
    }
    const iso = nasc ? paraIso(nasc) : null
    if (nasc && (!iso || !nascimentoOk(iso))) {
      setErro('Confere a data de aniversário.')
      return
    }
    // um WhatsApp, uma conta (067): antes de pedir e-mail e senha
    setOcupado(true)
    const { data, error } = await supabase.rpc('telefone_disponivel', { fone: formatarFone(fone) })
    setOcupado(false)
    if (error) {
      setErro('Não consegui conferir o WhatsApp agora. Tenta de novo.')
      return
    }
    const r = data as { disponivel?: boolean; em_uso?: boolean; email?: string; motivo?: string } | null
    if (r && r.disponivel === false) {
      if (r.em_uso || r.email) setJaTem(true)
      else setErro(r.motivo || 'Esse WhatsApp não serve.')
      return
    }
    setPasso(2)
  }

  async function criar() {
    setErro('')
    if (!termos) {
      setErro('Para criar a conta, é preciso aceitar os Termos e a Política de privacidade.')
      return
    }
    setOcupado(true)
    try {
      const { aceites, termos: versao } = await aceitesDaCliente()
      const iso = nasc ? paraIso(nasc) : null
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
        options: {
          data: { full_name: nome.trim(), phone: formatarFone(fone), codigo_convite: alvo ? convite : null, termos: versao, aceites, ...(iso ? { nascimento: iso } : {}) },
          // o link de confirmação volta para o app (mimo://auth/confirmado, 3.66) com a sessão;
          // fora da lista de Redirect URLs do Supabase ele cai no site, e a tela abaixo entra sozinha
          emailRedirectTo: Linking.createURL('auth/confirmado'),
        },
      })
      if (error) {
        setErro(traduz(error.message))
        return
      }
      // com "confirmar e-mail" ligado, e-mail repetido não dá erro: volta um usuário sem identidades
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setErro(traduz('User already registered'))
        return
      }
      setPronto(true)
    } finally {
      setOcupado(false)
    }
  }

  // "falta só confirmar": enquanto a tela está aberta, o app tenta entrar com o e-mail e a
  // senha a cada 12 s e quando volta ao primeiro plano; confirmou, a sessão nasce e as abas
  // abrem sozinhas (3.66). Antes de confirmar o Supabase recusa, e a gente ignora.
  useEffect(() => {
    if (!pronto) return
    let vivo = true
    const tentar = () => {
      if (!vivo) return
      supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha }).catch(() => {})
    }
    const relogio = setInterval(tentar, 12000)
    const sub = AppState.addEventListener('change', (estado) => { if (estado === 'active') tentar() })
    return () => {
      vivo = false
      clearInterval(relogio)
      sub.remove()
    }
  }, [pronto, email, senha])

  async function reenviar() {
    setReenviado('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
    setReenviado(error ? 'Não deu para reenviar agora. Tente em um minuto.' : 'Reenviado! Olha a caixa de entrada e o spam.')
  }

  const entrar = () => router.replace({ pathname: '/entrar', params: { ...(convite ? { convite } : {}), ...(email.trim() ? { email: email.trim() } : {}) } })
  const ler = (caminho: string) => void WebBrowser.openBrowserAsync(`${WEB_URL}${caminho}`)
  const suporte = () => void LinkingRN.openURL(linkWhats(numeroWhats(cfg), chamada('whatsEmUso', null, cfg).texto))

  if (pronto) {
    return (
      <Tela titulo="Criar conta">
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
          <View style={[e.icone, { backgroundColor: t.veu }]}>
            <Ionicons name="mail-open-outline" size={36} color={t.acento} />
          </View>
          <Text style={[e.titulo, { color: t.texto, textAlign: 'center' }]}>Falta só confirmar</Text>
          <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 21 }}>
            Mandamos um e-mail para <Text style={{ fontWeight: '700', color: t.texto }}>{email.trim()}</Text>. Toca no botão que está nele e a sua conta abre{primeiroNome ? ` já dentro da agenda de ${primeiroNome}` : ', pronta para marcar'}.
          </Text>
          <Text style={{ color: t.texto3, textAlign: 'center', fontSize: 13 }}>Toca no botão do e-mail e o app abre já logado. Se o e-mail abrir no computador, é só voltar aqui: a gente entra sozinho.</Text>
          <Text style={{ color: t.texto3, textAlign: 'center', fontSize: 13 }}>Não chegou? Olha o spam ou as Promoções. Pode levar um minuto.</Text>
        </View>
        {reenviado ? <Aviso tom="info" texto={reenviado} /> : null}
        <Botao titulo="Já confirmei, entrar" icone="log-in-outline" onPress={entrar} />
        <Botao titulo="Reenviar e-mail" tipo="fantasma" onPress={reenviar} />
      </Tela>
    )
  }

  return (
    <Tela titulo="Criar conta">
      <>
          {alvo ? (
            <Cartao estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar url={alvo.foto} nome={alvo.nome} tamanho={48} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.texto2, fontSize: 13 }}>Você vai entrar na agenda de</Text>
                <Text style={{ color: t.texto, fontWeight: '800', fontSize: 16 }}>{alvo.nome}</Text>
              </View>
            </Cartao>
          ) : alvo === null ? (
            <Cartao estilo={{ gap: 10 }}>
              <Aviso tom="erro" texto="Código não encontrado. Confere as seis letras com a profissional, ou siga sem ele: dá para entrar na agenda depois." />
              <Botao titulo="Seguir sem o código" tipo="fantasma" onPress={() => router.setParams({ convite: '' })} />
            </Cartao>
          ) : !convite ? (
            <Cartao estilo={{ gap: 10 }}>
              <Pressable onPress={() => setComCodigo((v) => !v)} accessibilityRole="button" style={e.dobra} testID="cadastro-com-codigo">
                <Text style={{ color: t.texto2, fontWeight: '600', fontSize: 13.5, flex: 1 }}>Tem o código ou o QR de uma profissional? É opcional.</Text>
                <Ionicons name={comCodigo ? 'chevron-up' : 'chevron-down'} size={16} color={t.texto3} />
              </Pressable>
              {comCodigo ? (
                <>
                  <Text style={{ color: t.texto3, fontSize: 12.5 }}>Com ele, a conta já nasce dentro da agenda dela. Sem ele, você entra nas agendas depois, pelo guia ou pelo QR.</Text>
                  <Entrada rotulo="Código ou link" placeholder="ANA7K2" value={codigo} onChangeText={setCodigo} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={usarCodigo} returnKeyType="go" />
                  <Botao titulo="Usar o código" tipo="linha" onPress={usarCodigo} desabilitado={!codigo.trim()} />
                  <Botao titulo="Escanear o QR" icone="qr-code-outline" tipo="fantasma" onPress={() => router.push('/ler-qr')} />
                </>
              ) : null}
            </Cartao>
          ) : null}

          <Text style={{ color: t.texto3, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>{passo === 1 ? 'Passo 1 de 2 · Quem é você' : 'Passo 2 de 2 · Como você entra'}</Text>

          {passo === 1 ? (
            <Cartao estilo={{ gap: 12 }}>
              {google ? (
                <>
                  <Botao titulo="Continuar com Google" tipo="linha" icone="logo-google" onPress={comGoogle} carregando={googleOcupado} />
                  <View style={e.ou}>
                    <View style={[e.ouLinha, { backgroundColor: t.fio }]} />
                    <Text style={{ color: t.texto3, fontSize: 12.5 }}>ou com e-mail</Text>
                    <View style={[e.ouLinha, { backgroundColor: t.fio }]} />
                  </View>
                </>
              ) : null}
              <Entrada rotulo="Nome e sobrenome" placeholder="Maria da Silva" value={nome} onChangeText={setNome} autoComplete="name" textContentType="name" autoCapitalize="words" />
              <View style={{ gap: 4 }}>
                <Entrada rotulo="WhatsApp" placeholder="(13) 99999-9999" value={fone} onChangeText={(v) => setFone(formatarFone(v))} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={15} />
                <Text style={{ color: t.texto3, fontSize: 12.5 }}>É por ele que chegam a confirmação e o lembrete.</Text>
              </View>
              <View style={{ gap: 4 }}>
                <Entrada rotulo="Aniversário (opcional)" placeholder="DD/MM/AAAA" value={nasc} onChangeText={(v) => setNasc(mascaraData(v))} keyboardType="number-pad" maxLength={10} />
                <Text style={{ color: t.texto3, fontSize: 12.5 }}>A profissional gosta de lembrar.</Text>
              </View>
              {erro ? <Aviso tom="erro" texto={erro} /> : null}
              {jaTem ? (
                <View style={[e.jaTem, { backgroundColor: t.veu }]}>
                  <Text style={{ color: t.texto, lineHeight: 20 }}>
                    <Text style={{ fontWeight: '800' }}>Esse WhatsApp já está em uso</Text> e não dá pra cadastrar de novo. Se a conta é sua, é só entrar. Se o número é seu e você não tem conta, fale com o suporte.
                  </Text>
                  <Botao titulo="Entrar" onPress={entrar} />
                  <Botao titulo="Falar com o suporte" tipo="fantasma" icone="logo-whatsapp" onPress={suporte} />
                </View>
              ) : null}
              <Botao titulo={ocupado ? 'Conferindo…' : 'Continuar'} onPress={seguir} desabilitado={ocupado} carregando={ocupado} />
            </Cartao>
          ) : (
            <Cartao estilo={{ gap: 12 }}>
              <View style={{ gap: 4 }}>
                <Entrada rotulo="E-mail" placeholder="voce@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
                <Text style={{ color: t.texto3, fontSize: 12.5 }}>Vai receber um e-mail para confirmar.</Text>
              </View>
              <View style={{ gap: 6 }}>
                <Entrada rotulo="Senha" placeholder="Pelo menos 6 caracteres" value={senha} onChangeText={setSenha} secureTextEntry={!mostrar} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" />
                <Pressable onPress={() => setMostrar((v) => !v)} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-end' }}>
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>{mostrar ? 'Esconder a senha' : 'Mostrar a senha'}</Text>
                </Pressable>
              </View>
              <Caixa marcado={termos} onPress={() => setTermos((v) => !v)} titulo="Li e aceito os Termos de uso e a Política de privacidade" sub="Os dois abrem aqui embaixo, para ler antes." />
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={() => ler('/termos/cliente')} hitSlop={6} accessibilityRole="link">
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler os termos</Text>
                </Pressable>
                <Pressable onPress={() => ler('/privacidade')} hitSlop={6} accessibilityRole="link">
                  <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler a política</Text>
                </Pressable>
              </View>
              {erro ? <Aviso tom="erro" texto={erro} /> : null}
              <Botao titulo={ocupado ? 'Criando…' : 'Criar minha conta'} onPress={criar} desabilitado={ocupado || !termos || senha.length < 6 || !email.trim()} carregando={ocupado} />
              <Botao
                titulo="Voltar"
                tipo="fantasma"
                onPress={() => {
                  setErro('')
                  setPasso(1)
                }}
              />
            </Cartao>
          )}
      </>

      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
        <Text style={{ color: t.texto2 }}>Já tem conta?</Text>
        <Pressable onPress={entrar} hitSlop={6} accessibilityRole="button">
          <Text style={{ color: t.acento, fontWeight: '700' }}>Entrar</Text>
        </Pressable>
      </View>
    </Tela>
  )
}

function traduz(msg: string): string {
  const mapa: Record<string, string> = {
    'User already registered': 'Este e-mail já tem conta. Entre com a senha, ou use "Esqueci a senha".',
    'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
    'Failed to fetch': 'Não foi possível conectar. Confira sua internet.',
    'email rate limit exceeded': 'Muitos e-mails de confirmação em pouco tempo. Espere uns minutos e tente de novo (ou fale com o suporte).',
    'Load failed': 'Não foi possível conectar. Confira sua internet e tente de novo.',
    'Signup requires a valid password': 'A senha precisa ter pelo menos 6 caracteres.',
    'Database error saving new user': 'Não deu para criar a conta: esse WhatsApp já está em uso ou algum dado veio errado.',
  }
  return mapa[msg] ?? msg
}

const e = StyleSheet.create({
  titulo: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  icone: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  jaTem: { borderRadius: 14, padding: 12, gap: 10 },
  ou: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  ouLinha: { flex: 1, height: 1 },
  dobra: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})
