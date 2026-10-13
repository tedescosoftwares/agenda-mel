import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatDataLonga } from '@mimo/core'
import { Botao, Cartao } from '@/components/ui'
import { capitalizar } from '@/lib/agendar'
import { useAbrirWeb } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Passo 5: deu certo. Três finais possíveis: pedido novo, pedido de troca,
// troca já feita. Pendente ou confirmado é o banco quem decide.
type Appt = { id: string; date: string; start_time: string; status: string; remarca_de: string | null; visita_id: string | null; service_name: string | null; services: { name: string } | null; professionals: { name: string } | null }
type Parte = { appointment_id: string; servico: string; profissional: string; inicio: string }

export default function Sucesso() {
  const t = useTema()
  const router = useRouter()
  const abrir = useAbrirWeb()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const [appt, setAppt] = useState<Appt | null>(null)
  const [partes, setPartes] = useState<Parte[]>([])

  useEffect(() => {
    if (!id || id === 'novo') return
    let vivo = true
    supabase
      .from('appointments')
      .select('id, date, start_time, status, remarca_de, visita_id, service_name, services (name), professionals (name)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setAppt((data as unknown as Appt | null) ?? null)
      })
    return () => {
      vivo = false
    }
  }, [id])

  const visitaId = appt?.visita_id
  useEffect(() => {
    if (!appt?.id || !visitaId) return
    let vivo = true
    supabase.rpc('partes_da_visita', { appt: appt.id }).then(({ data }) => {
      if (vivo) setPartes((data ?? []) as Parte[])
    })
    return () => {
      vivo = false
    }
  }, [appt?.id, visitaId])

  const partesDaVisita = visitaId ? partes : []
  const troca = Boolean(appt?.remarca_de)
  const jaTrocou = troca && appt?.status === 'confirmado'
  const jaConfirmou = !troca && appt?.status === 'confirmado'
  const titulo = jaTrocou ? 'Remarcado!' : jaConfirmou ? 'Agendamento confirmado! 🎉' : troca ? 'Pedido de troca enviado!' : 'Pedido enviado!'
  const texto = jaTrocou
    ? 'Sua profissional não pede confirmação, então a troca já valeu. Ela foi avisada.'
    : jaConfirmou
      ? 'Sua profissional não pede confirmação: o horário já é seu. Ela foi avisada.'
      : troca
        ? 'Seu horário atual continua guardado. Assim que a profissional aceitar a troca, você recebe um aviso aqui no app.'
        : partesDaVisita.length
          ? 'Sua visita ficou guardada. Cada profissional confirma a parte dela, e você recebe um aviso aqui no app.'
          : 'Seu horário ficou guardado, aguardando a confirmação da profissional. Assim que ela responder, você recebe um aviso aqui no app.'

  const inicio = () => router.dismissTo('/')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top', 'bottom']}>
      <View style={e.conteudo}>
        <View style={[e.check, { backgroundColor: t.veu }]}>
          <Ionicons name={troca ? 'repeat' : 'checkmark'} size={44} color={t.acento} />
        </View>
        <Text style={[e.titulo, { color: t.texto }]}>{titulo}</Text>
        <Text style={[e.texto, { color: t.texto2 }]}>{texto}</Text>
        {appt ? (
          <Cartao estilo={{ alignSelf: 'stretch', gap: 8 }}>
            <Linha rotulo="Serviço" valor={appt.service_name || appt.services?.name || 'Atendimento'} />
            <Linha rotulo="Com" valor={appt.professionals?.name ?? '…'} />
            <Linha rotulo={troca ? 'Nova data' : 'Data'} valor={capitalizar(formatDataLonga(appt.date))} />
            <Linha rotulo="Horário" valor={appt.start_time.slice(0, 5)} />
            {partesDaVisita.map((x) => (
              <Linha key={x.appointment_id} rotulo={String(x.inicio).slice(0, 5)} valor={`${x.servico} com ${x.profissional}`} />
            ))}
          </Cartao>
        ) : null}
        <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>
          {appt ? (
            <Botao titulo="Ver este agendamento" icone="calendar-outline" onPress={() => abrir(`/cliente/agendamento/${appt.id}`, 'Agendamento')} />
          ) : (
            <Botao titulo="Ver meus agendamentos" icone="calendar-outline" onPress={() => router.dismissTo('/horarios')} />
          )}
          <Botao titulo="Voltar ao início" tipo="fantasma" onPress={inicio} />
        </View>
      </View>
    </SafeAreaView>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  const t = useTema()
  return (
    <View style={e.linha}>
      <Text style={{ color: t.texto2 }}>{rotulo}</Text>
      <Text style={{ color: t.texto, fontWeight: '700', textAlign: 'right', flexShrink: 1 }}>{valor}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  conteudo: { flex: 1, padding: ESPACO, paddingTop: 48, alignItems: 'center', gap: 12 },
  check: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  titulo: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  texto: { fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 8 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
})
