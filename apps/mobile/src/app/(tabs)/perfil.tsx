import { useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Cabecalho, Cartao, Linha } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { NOME_DO_APP, VARIANTE, VERSAO, WEB_URL } from '@/lib/config'
import { formatPreco } from '@/lib/formato'
import { useAbrirWeb } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Perfil: o resumo (meu_perfil_resumo, como na web) e os atalhos. Editar,
// avisos, indicação e fila abrem na ponte; termos e privacidade, no navegador.
type Resumo = { desde: string | null; atendimentos: number; proximos: number; agendas: number; favoritas: number; saldo_cents: number }

export default function Perfil() {
  const t = useTema()
  const abrir = useAbrirWeb()
  const { usuario, perfil, sair, recarregarPerfil } = useSessao()
  const [resumo, setResumo] = useState<Resumo | null>(null)

  useFocusEffect(
    useCallback(() => {
      recarregarPerfil()
      supabase
        .rpc('meu_perfil_resumo')
        .then(({ data }) => {
          if (data) setResumo(data as Resumo)
        })
    }, [recarregarPerfil]),
  )

  function confirmarSaida() {
    Alert.alert('Sair da conta?', 'Seus horários continuam guardados: é só entrar de novo.', [
      { text: 'Ficar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void sair() },
    ])
  }

  const desde = resumo?.desde ? new Date(resumo.desde).getFullYear() : null
  const deQuemAtende = Boolean(perfil?.role && perfil.role !== 'cliente')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView contentContainerStyle={e.conteudo}>
        <Cabecalho titulo="Perfil" />

        <Cartao estilo={{ alignItems: 'center', gap: 6 }}>
          <Avatar url={perfil?.avatar_url} nome={perfil?.full_name ?? usuario?.email} tamanho={84} />
          <Text style={[e.nome, { color: t.texto }]}>{perfil?.full_name || 'Sem nome ainda'}</Text>
          <Text style={{ color: t.texto2 }}>{usuario?.email}</Text>
          {perfil?.phone ? <Text style={{ color: t.texto2 }}>{perfil.phone}</Text> : null}
          {desde ? <Text style={{ color: t.texto3, fontSize: 12.5 }}>Na MIMO desde {desde}</Text> : null}
        </Cartao>

        {deQuemAtende ? (
          <Aviso tom="info" texto="Esta conta é de quem atende. O app dela é o MIMO Pro; este aqui é o app da cliente." />
        ) : null}

        {resumo ? (
          <View style={e.numeros}>
            <Numero valor={String(resumo.atendimentos)} rotulo="atendimentos" />
            <Numero valor={String(resumo.agendas)} rotulo={resumo.agendas === 1 ? 'agenda' : 'agendas'} />
            <Numero valor={formatPreco((resumo.saldo_cents ?? 0) / 100)} rotulo="em créditos" />
          </View>
        ) : null}

        <Cartao estilo={{ paddingVertical: 4, gap: 0 }}>
          <Linha icone="create-outline" titulo="Editar perfil" sub="Nome, telefone, foto e aniversário" onPress={() => abrir('/cliente/perfil', 'Editar perfil')} />
          <Linha icone="notifications-outline" titulo="Avisos e lembretes" sub="Como e quando a MIMO te avisa" onPress={() => abrir('/cliente/notificacoes', 'Avisos')} />
          <Linha icone="gift-outline" titulo="Indicar amigas" sub="Seu link de indicação" onPress={() => abrir('/cliente/indicacao', 'Indicar amigas')} />
          <Linha icone="hourglass-outline" titulo="Fila de espera" sub="Horários que você está esperando" onPress={() => abrir('/cliente/fila-espera', 'Fila de espera')} />
          <Linha icone="document-text-outline" titulo="Termos de uso" onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/termos/cliente`)} />
          <Linha icone="shield-checkmark-outline" titulo="Privacidade" onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/privacidade`)} />
          <Linha icone="log-out-outline" titulo="Sair da conta" cor={t.erro} onPress={confirmarSaida} semSeta />
        </Cartao>

        <Text style={[e.versao, { color: t.texto3 }]}>
          {NOME_DO_APP} {VERSAO} · {VARIANTE}
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  const t = useTema()
  return (
    <Cartao estilo={e.numero}>
      <Text style={[e.numeroValor, { color: t.acento }]} numberOfLines={1} adjustsFontSizeToFit>
        {valor}
      </Text>
      <Text style={[e.numeroRotulo, { color: t.texto2 }]}>{rotulo}</Text>
    </Cartao>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 14, paddingBottom: 32 },
  nome: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  numeros: { flexDirection: 'row', gap: 10 },
  numero: { flex: 1, alignItems: 'center', gap: 2, padding: 12 },
  numeroValor: { fontSize: 20, fontWeight: '800' },
  numeroRotulo: { fontSize: 12 },
  versao: { textAlign: 'center', fontSize: 12, marginTop: 4 },
})
