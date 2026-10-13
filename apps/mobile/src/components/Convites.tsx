import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { formatDataLonga } from '@mimo/core'
import { Aviso, Botao, Cartao, Selo } from '@/components/ui'
import { hora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Os convites que pedem resposta na lista de horários: vir mais cedo
// (responder_antecipacao) e a vaga que abriu na fila (responder_vaga). Os
// mesmos da web (ConviteAdiantar e OfertaVaga).
const MENSAGEM_ADIANTAR: Record<string, string> = {
  expirada: 'Esse convite expirou: seu horário original continua valendo.',
  conflito: 'Esse horário acabou de ser ocupado. Seu horário original continua valendo.',
}
const MENSAGEM_VAGA: Record<string, string> = {
  expirada: 'O tempo dessa vaga acabou: ela passou para a próxima da fila.',
  conflito: 'Essa vaga acabou de ser preenchida.',
}

function useResposta(funcao: string, mensagens: Record<string, string>, onRespondido: () => void) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  async function responder(oferta_id: string, aceitar: boolean) {
    setEnviando(true)
    setErro('')
    const { data, error } = await supabase.rpc(funcao, { oferta_id, aceitar })
    setEnviando(false)
    if (error) {
      setErro(error.message)
      return
    }
    const r = String(data ?? '')
    if (mensagens[r]) {
      setErro(mensagens[r]!)
      setTimeout(onRespondido, 2500)
      return
    }
    onRespondido()
  }
  return { enviando, erro, responder }
}

export function ConviteAdiantar({ oferta, servico, profissional, onRespondido }: { oferta: { id: string; proposed_start_time: string | null; previous_start_time: string | null }; servico?: string | null; profissional?: string | null; onRespondido: () => void }) {
  const t = useTema()
  const { enviando, erro, responder } = useResposta('responder_antecipacao', MENSAGEM_ADIANTAR, onRespondido)
  const nova = hora(oferta.proposed_start_time ?? '')
  const antiga = hora(oferta.previous_start_time ?? '')
  return (
    <Cartao tom="acento">
      <Selo texto="Dá para adiantar" tom="acento" />
      <Text style={[e.texto, { color: t.texto }]}>
        <Text style={{ fontWeight: '800' }}>{profissional ?? 'Sua profissional'}</Text> pode te atender às <Text style={{ fontWeight: '800' }}>{nova}</Text> em vez de {antiga}
        {servico ? ` (${servico})` : ''}.
      </Text>
      <Text style={{ color: t.texto2, fontSize: 13 }}>Você decide: sem resposta, o horário original continua valendo.</Text>
      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      <View style={e.acoes}>
        <Botao titulo={`Manter ${antiga}`} tipo="fantasma" onPress={() => responder(oferta.id, false)} desabilitado={enviando} estilo={{ flex: 1 }} />
        <Botao titulo={`Pode ser ${nova}`} onPress={() => responder(oferta.id, true)} carregando={enviando} estilo={{ flex: 1 }} />
      </View>
    </Cartao>
  )
}

export type Vaga = { id: string; date: string; start_time: string; expires_at: string | null; waitlist_entries: { services: { name: string } | null; professionals: { name: string } | null } | null }

export function OfertaVaga({ oferta, onRespondido }: { oferta: Vaga; onRespondido: () => void }) {
  const t = useTema()
  const { enviando, erro, responder } = useResposta('responder_vaga', MENSAGEM_VAGA, onRespondido)
  const [minutos, setMinutos] = useState<number | null>(null)
  // conta regressiva do tempo que a vaga fica guardada
  useEffect(() => {
    const atualizar = () => setMinutos(oferta.expires_at ? Math.max(0, Math.round((new Date(oferta.expires_at).getTime() - Date.now()) / 60000)) : null)
    const id = setInterval(atualizar, 30000)
    atualizar()
    return () => clearInterval(id)
  }, [oferta.expires_at])
  const entrada = oferta.waitlist_entries
  return (
    <Cartao tom="acento">
      <Selo texto="Abriu uma vaga" tom="acento" />
      <Text style={[e.texto, { color: t.texto }]}>
        <Text style={{ fontWeight: '800' }}>{entrada?.services?.name ?? 'Seu serviço'}</Text> com {entrada?.professionals?.name ?? 'a profissional'}
        {'\n'}
        {formatDataLonga(oferta.date)} às <Text style={{ fontWeight: '800' }}>{hora(oferta.start_time)}</Text>
      </Text>
      <Text style={{ color: t.texto2, fontSize: 13 }}>
        {minutos === null ? 'Guardada para você.' : minutos > 0 ? `Guardada para você por mais ${minutos} min.` : 'O tempo está acabando.'} Depois disso passa para a próxima da fila.
      </Text>
      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      <View style={e.acoes}>
        <Botao titulo="Agora não" tipo="fantasma" onPress={() => responder(oferta.id, false)} desabilitado={enviando} estilo={{ flex: 1 }} />
        <Botao titulo="Quero essa vaga" onPress={() => responder(oferta.id, true)} carregando={enviando} estilo={{ flex: 1.2 }} />
      </View>
    </Cartao>
  )
}

const e = StyleSheet.create({
  texto: { fontSize: 15, lineHeight: 22 },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 2 },
})
