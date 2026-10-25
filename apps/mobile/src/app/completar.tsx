import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { chamada, foneValido, formatarFone, linkWhats, numeroWhats } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Avatar, Aviso, Botao, Caixa, Carregando, Cartao, Entrada } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { WEB_URL } from '@/lib/config'
import { useConfig } from '@/lib/configPublica'
import { mascaraData, nascimentoOk, paraIso } from '@/lib/datas'
import { aceitesDaCliente } from '@/lib/legal'
import { contaSocial } from '@/lib/oauth'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// O cadastro completo (3.60, 3.65): nome, WhatsApp e o aceite dos termos. A
// conta que nasce pelo Google chega sem telefone, e é pelo WhatsApp que chegam a
// confirmação e o lembrete; o salão também encaixa clientes por ele. Uma conta
// antiga pode estar sem o aceite. Esta tela vem antes das abas (_layout.tsx,
// precisaCompletar) e chama completar_perfil (207): telefone (um WhatsApp, uma
// conta — 067), aniversário, o aceite dos termos e os encaixes que o salão já
// fez por esse número.
export default function Completar() {
  const t = useTema()
  const cfg = useConfig()
  const { usuario, perfil, perfilPronto, recarregarPerfil, sair } = useSessao()
  const meta = (usuario?.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string; picture?: string }
  // o nome vem do perfil (ou do Google) até a pessoa mexer nele
  const [nomeDigitado, setNomeDigitado] = useState<string | null>(null)
  const [fone, setFone] = useState(() => (perfil?.phone ? formatarFone(perfil.phone) : ''))
  const [nasc, setNasc] = useState('')
  const [termos, setTermos] = useState(false)
  const [erro, setErro] = useState('')
  const [jaTem, setJaTem] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const precisaAceite = !perfil?.aceitou_termos_em
  const peloGoogle = contaSocial(usuario)
  const faltaSoAceite = Boolean(perfil?.phone && perfil?.full_name && precisaAceite)
  const foto = perfil?.avatar_url ?? meta.avatar_url ?? meta.picture ?? null

  const nome = nomeDigitado ?? perfil?.full_name ?? meta.full_name ?? meta.name ?? ''

  async function concluir() {
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
    if (precisaAceite && !termos) {
      setErro('Para continuar, é preciso aceitar os Termos e a Política de privacidade.')
      return
    }
    setOcupado(true)
    try {
      // um WhatsApp, uma conta (067): confere antes de guardar
      const livre = await supabase.rpc('telefone_disponivel', { fone: formatarFone(fone) })
      if (livre.error) {
        setErro('Não consegui conferir o WhatsApp agora. Tenta de novo.')
        return
      }
      const l = livre.data as { disponivel?: boolean; em_uso?: boolean; motivo?: string } | null
      if (l && l.disponivel === false) {
        if (l.em_uso) setJaTem(true)
        else setErro(l.motivo || 'Esse WhatsApp não serve.')
        return
      }
      const aceites = precisaAceite ? (await aceitesDaCliente()).aceites : null
      const { data, error } = await supabase.rpc('completar_perfil', { nome_: nome.trim(), fone_: formatarFone(fone), nascimento_: iso, aceites_: aceites })
      if (error) {
        setErro(error.message)
        return
      }
      const r = data as { ok?: boolean; em_uso?: boolean; motivo?: string } | null
      if (!r?.ok) {
        if (r?.em_uso) setJaTem(true)
        else setErro(r?.motivo || 'Não deu para guardar agora. Tenta de novo.')
        return
      }
      // com o telefone no perfil, a trava do _layout solta as abas sozinha
      await recarregarPerfil()
    } finally {
      setOcupado(false)
    }
  }

  const ler = (caminho: string) => void WebBrowser.openBrowserAsync(`${WEB_URL}${caminho}`)
  const suporte = () => void Linking.openURL(linkWhats(numeroWhats(cfg), chamada('whatsEmUso', null, cfg).texto))

  return (
    <Tela titulo={faltaSoAceite ? 'Falta só o seu aceite' : perfil?.phone ? 'Complete o seu cadastro' : 'Falta só o seu WhatsApp'} voltar={() => void sair()}>
      {!perfilPronto ? <Carregando /> : null}
      <Text style={{ color: t.texto2, lineHeight: 21 }}>
        {faltaSoAceite
          ? 'Para seguir usando a MIMO, confira seus dados e aceite os Termos de uso e a Política de privacidade.'
          : peloGoogle
            ? 'Você entrou com o Google. É pelo WhatsApp que chegam a confirmação e o lembrete dos seus horários, e é por ele que a profissional te reconhece.'
            : 'Para usar a MIMO, precisamos do seu nome, do seu WhatsApp e do aceite dos termos. É rapidinho.'}
      </Text>
      <Cartao estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar url={foto} nome={nome || 'G'} tamanho={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 16 }}>{nome || (peloGoogle ? 'Sua conta Google' : 'Sua conta')}</Text>
          <Text style={{ color: t.texto2, fontSize: 13 }}>{usuario?.email}</Text>
        </View>
      </Cartao>
      <Cartao estilo={{ gap: 12 }}>
        <Entrada rotulo="Nome e sobrenome" placeholder="Maria da Silva" value={nome} onChangeText={setNomeDigitado} autoComplete="name" textContentType="name" autoCapitalize="words" />
        <View style={{ gap: 4 }}>
          <Entrada rotulo="WhatsApp" placeholder="(13) 99999-9999" value={fone} onChangeText={(v) => setFone(formatarFone(v))} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={15} />
          <Text style={{ color: t.texto3, fontSize: 12.5 }}>É por ele que chegam a confirmação e o lembrete.</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Entrada rotulo="Aniversário (opcional)" placeholder="DD/MM/AAAA" value={nasc} onChangeText={(v) => setNasc(mascaraData(v))} keyboardType="number-pad" maxLength={10} />
          <Text style={{ color: t.texto3, fontSize: 12.5 }}>A profissional gosta de lembrar.</Text>
        </View>
        {precisaAceite ? (
          <>
            <Caixa marcado={termos} onPress={() => setTermos((v) => !v)} titulo="Li e aceito os Termos de uso e a Política de privacidade" sub="Os dois abrem aqui embaixo, para ler antes." />
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable onPress={() => ler('/termos/cliente')} hitSlop={6} accessibilityRole="link">
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler os termos</Text>
              </Pressable>
              <Pressable onPress={() => ler('/privacidade')} hitSlop={6} accessibilityRole="link">
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Ler a política</Text>
              </Pressable>
            </View>
          </>
        ) : null}
        {erro ? <Aviso tom="erro" texto={erro} /> : null}
        {jaTem ? (
          <View style={[e.jaTem, { backgroundColor: t.veu }]}>
            <Text style={{ color: t.texto, lineHeight: 20 }}>
              <Text style={{ fontWeight: '800' }}>Esse WhatsApp já está em uso</Text> por outra conta da MIMO. Se a conta é sua, saia desta e entre por ela, com e-mail e senha. Se o número é seu e você não tem outra conta, fale com o suporte.
            </Text>
            <Botao titulo="Entrar com a outra conta" onPress={() => void sair()} />
            <Botao titulo="Falar com o suporte" tipo="fantasma" icone="logo-whatsapp" onPress={suporte} />
          </View>
        ) : null}
        <Botao titulo={ocupado ? 'Guardando…' : 'Concluir'} onPress={concluir} desabilitado={ocupado || (precisaAceite && !termos)} carregando={ocupado} />
      </Cartao>
      <Pressable onPress={() => void sair()} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'center', padding: 8 }}>
        <Text style={{ color: t.acento, fontWeight: '700' }}>Sair da conta</Text>
      </Pressable>
    </Tela>
  )
}

const e = StyleSheet.create({
  jaTem: { borderRadius: 12, padding: 12, gap: 10 },
})
