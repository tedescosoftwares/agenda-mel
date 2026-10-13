import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { formatCents } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Botao, Cartao, Carregando } from '@/components/ui'
import { WEB_URL } from '@/lib/config'
import { dataCurta } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Indique e ganhe (a mesma da web, Indicacao): o código grande, copiar,
// compartilhar, e os dois números que importam: quantas amigas vieram e
// quanto virou crédito.
type Resumo = { codigo: string; saldo_cents: number; indicadas_total: number; indicadas_creditadas: number; premio_indicou_cents: number; premio_indicada_cents: number }
type Lancamento = { id: string; amount_cents: number; kind: string; description: string | null; created_at: string }

export default function Indicacao() {
  const t = useTema()
  const [resumo, setResumo] = useState<Resumo | null | undefined>(undefined)
  const [saldo, setSaldo] = useState(0)
  const [extrato, setExtrato] = useState<Lancamento[]>([])
  const [copiado, setCopiado] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      Promise.all([supabase.rpc('meu_resumo_indicacoes'), supabase.rpc('saldo_creditos'), supabase.from('credit_transactions').select('*').order('created_at', { ascending: false }).limit(10)]).then(([r, s, x]) => {
        if (!vivo) return
        setResumo(((r.data ?? []) as Resumo[])[0] ?? null)
        setSaldo(Number(s.data ?? 0))
        setExtrato((x.data ?? []) as Lancamento[])
      })
      return () => {
        vivo = false
      }
    }, []),
  )

  const link = resumo ? `${WEB_URL}/?indique=${resumo.codigo}` : ''
  const msg = resumo ? `Oi! Me acompanha no MIMO e você ganha ${formatCents(resumo.premio_indicada_cents)} de desconto no seu primeiro atendimento: ${link}` : ''

  async function copiar() {
    if (!resumo) return
    await Clipboard.setStringAsync(resumo.codigo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }
  async function compartilhar() {
    try {
      await Share.share({ message: msg })
    } catch {
      // sem a folha de compartilhar (navegador): vai pelo WhatsApp
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`).catch(() => {})
    }
  }

  return (
    <Tela titulo="Indique e ganhe">
      {resumo === undefined ? <Carregando /> : null}
      {resumo !== undefined ? (
        <>
          <View style={e.topo}>
            <View style={[e.ilustra, { backgroundColor: t.veu }]}>
              <Ionicons name="gift-outline" size={40} color={t.acento} />
            </View>
            <Text style={[e.titulo, { color: t.texto }]}>Convide amigas, ganhe créditos</Text>
            {resumo ? (
              <Text style={[e.texto, { color: t.texto2 }]}>
                Cada amiga que agendar ganha {formatCents(resumo.premio_indicada_cents)}, e você ganha {formatCents(resumo.premio_indicou_cents)}.
              </Text>
            ) : null}
          </View>

          {resumo ? (
            <Cartao estilo={{ alignItems: 'center', gap: 10 }}>
              <Text style={{ color: t.texto2, fontSize: 13 }}>Seu código</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={[e.codigo, { color: t.texto }]}>{resumo.codigo}</Text>
                <Pressable onPress={copiar} hitSlop={8} accessibilityLabel="Copiar código" style={[e.copiar, { backgroundColor: t.superficie2 }]}>
                  <Ionicons name={copiado ? 'checkmark' : 'copy-outline'} size={18} color={copiado ? t.ok : t.acento} />
                </Pressable>
              </View>
              <Botao titulo="Compartilhar" icone="share-social-outline" onPress={compartilhar} estilo={{ alignSelf: 'stretch' }} />
              <Text style={{ color: copiado ? t.ok : 'transparent', fontSize: 12.5 }}>Copiado!</Text>
            </Cartao>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Cartao estilo={e.tile}>
              <Text style={[e.tileValor, { color: t.acento }]}>{resumo?.indicadas_total ?? 0}</Text>
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>amigas convidadas</Text>
            </Cartao>
            <Cartao estilo={e.tile}>
              <Text style={[e.tileValor, { color: t.acento }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatCents(saldo)}
              </Text>
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>em créditos</Text>
            </Cartao>
          </View>

          {extrato.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={[e.secao, { color: t.texto }]}>Extrato</Text>
              {extrato.map((x) => (
                <Cartao key={x.id} estilo={e.linha}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontWeight: '700' }}>{x.description || x.kind}</Text>
                    <Text style={{ color: t.texto2, fontSize: 12.5 }}>{dataCurta(x.created_at.slice(0, 10))}/{x.created_at.slice(0, 4)}</Text>
                  </View>
                  <Text style={{ color: x.amount_cents >= 0 ? t.ok : t.erro, fontWeight: '800' }}>
                    {x.amount_cents >= 0 ? '+' : ''}
                    {formatCents(x.amount_cents)}
                  </Text>
                </Cartao>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  topo: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  ilustra: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  titulo: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  texto: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', paddingHorizontal: 8 },
  codigo: { fontSize: 30, fontWeight: '800', letterSpacing: 3 },
  copiar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tile: { flex: 1, alignItems: 'center', gap: 2, padding: 12 },
  tileValor: { fontSize: 22, fontWeight: '800' },
  secao: { fontSize: 16, fontWeight: '800' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
})
