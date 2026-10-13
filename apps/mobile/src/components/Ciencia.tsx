import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { AppState, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Aviso, Botao, Entrada } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// A página de ciência (077), a mesma da web (CienciaGate): a cliente faltou,
// ou cancelou em cima da hora. Cobre o app até ela tocar em "Li e concordo".
// Numa falta, ela pode dizer "Eu compareci": a profissional é avisada.
type Pendencia = { id: string; motivo: string; servico: string | null; profissional: string | null; quando: string | null; appointment_id: string | null }

export function Ciencia({ ativa }: { ativa: boolean }) {
  const t = useTema()
  const [lista, setLista] = useState<Pendencia[]>([])
  const [contestando, setContestando] = useState(false)
  const [texto, setTexto] = useState('')
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(() => {
    supabase.rpc('minhas_ciencias').then(({ data }) => setLista((data ?? []) as Pendencia[]))
  }, [])

  // ao entrar e sempre que o app volta para a frente
  useEffect(() => {
    if (!ativa) return
    carregar()
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') carregar()
    })
    return () => sub.remove()
  }, [ativa, carregar])

  const c = lista[0]
  if (!ativa || !c) return null
  const falta = c.motivo === 'falta'

  async function concordar() {
    if (!c) return
    setMexendo(true)
    setErro('')
    const { error } = await supabase.rpc('aceitar_ciencia', { ciencia: c.id })
    setMexendo(false)
    if (error) {
      setErro(error.message)
      return
    }
    setContestando(false)
    carregar()
  }
  async function contestar() {
    if (!c) return
    setMexendo(true)
    setErro('')
    const { error } = await supabase.rpc('contestar_falta', { ciencia: c.id, texto: texto.trim() || null })
    setMexendo(false)
    if (error) {
      setErro(error.message)
      return
    }
    setContestando(false)
    setTexto('')
    carregar()
  }

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }}>
        <ScrollView contentContainerStyle={e.conteudo} keyboardShouldPersistTaps="handled">
          <View style={[e.icone, { backgroundColor: t.veu }]}>
            <Ionicons name={falta ? 'person-remove-outline' : 'calendar-clear-outline'} size={30} color={t.acento} />
          </View>
          <Text style={[e.titulo, { color: t.texto }]}>{falta ? 'Sobre o horário que não aconteceu' : 'Sobre o cancelamento em cima da hora'}</Text>
          <Text style={[e.texto, { color: t.texto }]}>
            <Text style={{ fontWeight: '800' }}>{c.servico}</Text> com {c.profissional}, {c.quando}.
          </Text>
          <Text style={[e.texto, { color: t.texto2 }]}>
            {falta
              ? 'Esse horário ficou marcado como não comparecimento. Quando um horário reservado fica vazio, a profissional perde aquele tempo de trabalho e outra cliente que queria a vaga fica sem ela.'
              : 'Esse horário foi cancelado com menos de 24 horas de antecedência. Nesse prazo é difícil a profissional preencher a vaga, e ela perde aquele tempo de trabalho.'}
          </Text>
          <Text style={[e.texto, { color: t.texto2 }]}>Não é multa nem bronca: é um pedido. Se não puder ir, cancele ou peça para remarcar com antecedência, pelo app. É assim que a agenda funciona bem para todo mundo.</Text>
          {contestando ? (
            <View style={{ gap: 10 }}>
              <Entrada rotulo="Conta o que aconteceu (opcional)" placeholder="Ex.: cheguei 10 minutos atrasada e fui atendida" value={texto} onChangeText={setTexto} multiline />
              <Botao titulo="Enviar: eu compareci" onPress={contestar} carregando={mexendo} />
              <Botao titulo="Voltar" tipo="fantasma" onPress={() => setContestando(false)} desabilitado={mexendo} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Botao titulo="Li e concordo" onPress={concordar} carregando={mexendo} />
              {falta ? <Botao titulo="Eu compareci" tipo="fantasma" onPress={() => setContestando(true)} desabilitado={mexendo} /> : null}
            </View>
          )}
          {erro ? <Aviso tom="erro" texto={erro} /> : null}
          {lista.length > 1 ? (
            <Text style={{ color: t.texto3, fontSize: 12.5, textAlign: 'center' }}>
              Mais {lista.length - 1} {lista.length - 1 === 1 ? 'aviso' : 'avisos'} depois deste.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, paddingTop: 40, gap: 14, flexGrow: 1 },
  icone: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, lineHeight: 29 },
  texto: { fontSize: 15, lineHeight: 22 },
})
