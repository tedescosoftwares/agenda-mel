import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Share, StyleSheet, Text, View } from 'react-native'
import { formatCents, formatDataLonga } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Aviso, Botao, Carregando, Cartao, Vazio } from '@/components/ui'
import { capitalizar } from '@/lib/agendar'
import { hora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// O comprovante do atendimento (o mesmo da web, ClienteComanda): o cupom que
// o balcão fechou, com os serviços, desconto, sinal pago pelo app, como pagou
// o resto e o troco.
type Comanda = {
  id: string
  fechada_em: string | null
  status: string
  itens: { nome: string; qtd: number | null; preco_cents: number }[] | null
  desconto_cents: number
  total_cents: number
  pagamentos: { forma: string; valor_cents: number; parcelas: number | null; detalhe: string | null; recebido_cents: number | null; troco_cents: number | null }[] | null
  atendida_por: string | null
  appointment_id: string | null
  dia: string | null
  hora: string | null
  salao: { nome: string; endereco: string | null; cidade: string | null; cnpj: string | null; logo_url: string | null } | null
}
const ROTULO: Record<string, string> = { dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito', pix: 'PIX', app: 'Pago pelo app', outro: 'Outro' }

export default function ComandaPagina() {
  const t = useTema()
  const router = useRouter()
  const { id, de } = useLocalSearchParams<{ id: string; de?: string }>()
  const [c, setC] = useState<Comanda | null | undefined>(undefined)

  useEffect(() => {
    let vivo = true
    supabase.rpc('comprovante_da_comanda', { comanda: id }).then(({ data }) => {
      if (vivo) setC((data as Comanda | null) ?? null)
    })
    return () => {
      vivo = false
    }
  }, [id])

  async function compartilhar() {
    if (!c) return
    const texto = `Comprovante · ${c.salao?.nome ?? ''}\n${(c.itens ?? []).map((i) => `${i.nome} ${formatCents(i.preco_cents * (i.qtd ?? 1))}`).join('\n')}\nTotal ${formatCents(c.total_cents)}`
    try {
      await Share.share({ title: 'Comprovante', message: texto })
    } catch {
      await Clipboard.setStringAsync(texto)
    }
  }

  if (c === undefined) {
    return (
      <Tela titulo="Comprovante">
        <Carregando />
      </Tela>
    )
  }
  if (!c) {
    return (
      <Tela titulo="Comprovante">
        <Vazio mostrarMel={false} titulo="Não encontramos esse comprovante." />
      </Tela>
    )
  }
  const quando = c.dia ? capitalizar(formatDataLonga(c.dia)) : c.fechada_em ? capitalizar(formatDataLonga(c.fechada_em.slice(0, 10))) : ''
  const horarioId = de || c.appointment_id

  return (
    <Tela titulo="Comprovante">
      <Cartao estilo={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="receipt-outline" size={18} color={t.acento} />
          <Text style={{ color: t.texto, fontWeight: '800' }}>Comprovante do atendimento</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[e.logo, { backgroundColor: t.superficie2 }]}>{c.salao?.logo_url ? <Image source={{ uri: c.salao.logo_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="storefront-outline" size={18} color={t.acento} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.texto, fontWeight: '700' }}>{c.salao?.nome}</Text>
            <Text style={{ color: t.texto2, fontSize: 13 }}>
              {quando}
              {c.hora ? ` às ${hora(String(c.hora))}` : ''}
              {c.atendida_por ? ` · com ${c.atendida_por}` : ''}
            </Text>
          </View>
        </View>
        {(c.itens ?? []).map((x, k) => (
          <View key={k} style={e.linha}>
            <Text style={{ color: t.texto, flex: 1 }}>
              {x.nome}
              {(x.qtd ?? 1) > 1 ? ` × ${x.qtd}` : ''}
            </Text>
            <Text style={{ color: t.texto }}>{formatCents(x.preco_cents * (x.qtd ?? 1))}</Text>
          </View>
        ))}
        {c.desconto_cents > 0 ? (
          <View style={e.linha}>
            <Text style={{ color: t.texto2 }}>Desconto</Text>
            <Text style={{ color: t.texto, fontWeight: '700' }}>− {formatCents(c.desconto_cents)}</Text>
          </View>
        ) : null}
        <View style={[e.linha, { borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 }]}>
          <Text style={{ color: t.texto, fontWeight: '700' }}>Total</Text>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17 }}>{formatCents(c.total_cents)}</Text>
        </View>
        {(c.pagamentos ?? []).map((p, k) => (
          <View key={k} style={e.linha}>
            <Text style={{ color: t.texto2, fontSize: 13, flex: 1 }}>
              {ROTULO[p.forma] ?? p.forma}
              {(p.parcelas ?? 0) > 1 ? ` em ${p.parcelas}x` : ''}
              {p.detalhe && p.forma !== 'app' ? ` · ${p.detalhe}` : ''}
              {(p.troco_cents ?? 0) > 0 ? ` · entregue ${formatCents(p.recebido_cents ?? 0)}, troco ${formatCents(p.troco_cents ?? 0)}` : ''}
            </Text>
            <Text style={{ color: t.texto, fontWeight: '700', fontSize: 13 }}>{formatCents(p.valor_cents)}</Text>
          </View>
        ))}
        {c.salao?.endereco ? (
          <Text style={{ color: t.texto3, fontSize: 12 }}>
            {c.salao.nome}
            {c.salao.cnpj ? ` · CNPJ ${c.salao.cnpj}` : ''} · {c.salao.endereco}
            {c.salao.cidade ? ` · ${c.salao.cidade}` : ''}
          </Text>
        ) : null}
        <Text style={{ color: t.texto3, fontSize: 12 }}>Comprovante nº {String(c.id).slice(0, 8)} · emitido pelo MIMO. Não é documento fiscal.</Text>
        {c.status === 'estornada' ? <Aviso tom="erro" texto="Esta comanda foi estornada pelo salão." /> : null}
      </Cartao>
      <Botao titulo="Compartilhar" icone="share-social-outline" tipo="fantasma" onPress={compartilhar} />
      {horarioId ? <Botao titulo="Ver o horário" tipo="linha" onPress={() => router.push({ pathname: '/agendamento/[id]', params: { id: horarioId } })} /> : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
