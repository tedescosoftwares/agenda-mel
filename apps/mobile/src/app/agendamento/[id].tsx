import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { formatCents, formatDataLonga, linksDeRota, temPino } from '@mimo/core'
import { Avaliar } from '@/components/Avaliar'
import { Confirmacao, type Pergunta } from '@/components/Folha'
import { Tela } from '@/components/Tela'
import { Avatar, Aviso, Botao, Cartao, Carregando, Chip, Selo, Vazio, type Icone } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { capitalizar } from '@/lib/agendar'
import { dataCurta, formatDuracao, formatPreco, hora, primeiroNome } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// A página de um horário: tudo sobre ele num lugar só, com as mesmas regras
// da web (ClienteAgendamento). É para onde os avisos apontam e para onde o
// cartão da lista leva. Remarcar e marcar de novo abrem o fluxo nativo; o
// PIX, o comprovante, a profissional e o salão ainda abrem na ponte.
type Appt = {
  id: string
  date: string
  start_time: string
  end_time: string | null
  status: string
  notes: string | null
  created_at: string
  service_id: string | null
  professional_id: string | null
  salon_id: string | null
  price_cents: number | null
  desconto_cents: number | null
  pago_cents: number | null
  remarca_de: string | null
  visita_id: string | null
  service_name: string | null
  services: { name: string; price: number | null; duration_minutes: number | null } | null
  professionals: { id: string; name: string; photo_url: string | null } | null
  salons: { id: string; name: string; address: string | null; city: string | null; phone: string | null; tipo: string | null; lat: number | null; lng: number | null } | null
}
type Pagamento = { id: string; status: string; valor_cents: number; total_cents: number | null; sinal_pct: number | null; pago_em: string | null; estorno_cents: number | null; motivo_estorno: string | null; tentativas_estorno: number | null; credito_ate: string | null }
type Regras = { modo: string; permite_remarcar?: boolean | null }
type Dinheiro = { dentro_do_prazo: boolean; limite: string | null; horas: number; volta_cents: number; taxa_cents: number; credito_ate_se_cancelar: string | null; salao: string | null }
type Item = { id: string; name: string; price_cents: number; preco_cheio_cents: number | null; duration_minutes: number | null; ordem: number }
type Parte = { appointment_id: string; servico: string; service_id: string | null; profissional: string; professional_id: string | null; inicio: string; status: string; price_cents: number | null }

const ESTADO: Record<string, { rotulo: string; icone: Icone; texto: string; tom: 'ok' | 'aviso' | 'neutro' | 'acento' }> = {
  pendente: { rotulo: 'Aguardando confirmação', icone: 'hourglass-outline', texto: 'A profissional ainda vai confirmar. Você recebe um aviso assim que ela responder.', tom: 'aviso' },
  confirmado: { rotulo: 'Confirmado', icone: 'checkmark-circle-outline', texto: 'Está tudo certo. Se precisar, dá para remarcar ou cancelar por aqui.', tom: 'ok' },
  concluido: { rotulo: 'Concluído', icone: 'checkmark', texto: 'Já aconteceu. Que tal contar como foi?', tom: 'ok' },
  cancelado: { rotulo: 'Cancelado', icone: 'close-circle-outline', texto: 'Este horário não vale mais.', tom: 'neutro' },
  faltou: { rotulo: 'Não compareceu', icone: 'close-circle-outline', texto: 'Este horário passou sem atendimento.', tom: 'neutro' },
  aguardando_pagamento: { rotulo: 'Aguardando pagamento', icone: 'hourglass-outline', texto: 'Assim que o PIX cair, o pedido vai para a profissional.', tom: 'aviso' },
}
const PARTE: Record<string, string> = { pendente: 'Aguardando', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Recusado', faltou: 'Não foi' }

const nomeDoServico = (a: Appt) => a.service_name || a.services?.name || 'Atendimento'
const ajustadoNoSalao = (a: Appt) => Boolean(a.service_name && a.services?.name && a.service_name !== a.services.name)
function minutosEntre(ini: string | null, fim: string | null): number | null {
  if (!ini || !fim) return null
  const [h1, m1] = ini.split(':').map(Number)
  const [h2, m2] = fim.split(':').map(Number)
  return (h2 ?? 0) * 60 + (m2 ?? 0) - ((h1 ?? 0) * 60 + (m1 ?? 0))
}
const diaCurto = (d: string | null) => (d ? dataCurta(String(d).slice(0, 10)) : '')
function quando(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Agendamento() {
  const t = useTema()
  const router = useRouter()
  const { usuario } = useSessao()
  const { id, avaliar } = useLocalSearchParams<{ id: string; avaliar?: string }>()
  const [a, setA] = useState<Appt | null | undefined>(undefined)
  const [origem, setOrigem] = useState<{ date: string; start_time: string } | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [partes, setPartes] = useState<Parte[]>([])
  const [erro, setErro] = useState('')
  const [comanda, setComanda] = useState<{ id: string; quantos: number } | null>(null)
  const [pagamento, setPagamento] = useState<Pagamento | null>(null)
  const [regras, setRegras] = useState<Regras | null>(null)
  const [dinheiro, setDinheiro] = useState<Dinheiro | null>(null)
  const [avaliada, setAvaliada] = useState<{ nota: number } | false | null>(null)
  const [avaliando, setAvaliando] = useState(false)
  const [fechouPedido, setFechouPedido] = useState(false)
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)

  const carregar = useCallback(async () => {
    if (!usuario || !id) return
    const { data, error } = await supabase
      .from('appointments')
      .select('*, services (name, price, duration_minutes), professionals (id, name, photo_url), salons (id, name, address, city, phone, tipo, lat, lng)')
      .eq('id', id)
      .eq('client_id', usuario.id)
      .maybeSingle()
    if (error) setErro(error.message)
    const appt = (data as unknown as Appt | null) ?? null
    setA(appt)
    if (!appt) return
    const [pgs, rv, cm, it] = await Promise.all([
      supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, estorno_cents, motivo_estorno, liquido_cents, tentativas_estorno, credito_ate').eq('appointment_id', appt.id).order('criado_em', { ascending: false }).limit(1),
      supabase.from('reviews').select('id, nota').eq('appointment_id', appt.id).maybeSingle(),
      // o comprovante é um só por visita: o horário pode ser o principal da comanda ou um dos outros
      supabase.from('comandas').select('id, appointment_ids').eq('status', 'fechada').or(`appointment_id.eq.${appt.id},appointment_ids.cs.{${appt.id}}`).limit(1).maybeSingle(),
      supabase.from('appointment_services').select('id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem').eq('appointment_id', appt.id).order('ordem'),
    ])
    const pg = ((pgs.data ?? []) as Pagamento[])[0] ?? null
    setPagamento(pg)
    if (appt.salon_id) supabase.rpc('pagamento_do_salao', { salao: appt.salon_id }).then(({ data: r }) => setRegras((r as Regras | null) ?? null))
    if ((appt.pago_cents ?? 0) > 0 || pg) supabase.rpc('regras_do_agendamento', { appt: appt.id }).then(({ data: r }) => setDinheiro((r as Dinheiro | null) ?? null))
    else setDinheiro(null)
    setAvaliada((rv.data as { nota: number } | null) ?? false)
    const c = cm.data as { id: string; appointment_ids: string[] | null } | null
    setComanda(c ? { id: c.id, quantos: (c.appointment_ids ?? []).length } : null)
    setItens((it.data ?? []) as Item[])
    if (appt.visita_id) {
      const { data: pv } = await supabase.rpc('partes_da_visita', { appt: appt.id })
      setPartes((pv ?? []) as Parte[])
    } else setPartes([])
    if (appt.remarca_de) {
      const { data: o } = await supabase.from('appointments').select('id, date, start_time').eq('id', appt.remarca_de).maybeSingle()
      setOrigem((o as { date: string; start_time: string } | null) ?? null)
    } else setOrigem(null)
  }, [usuario, id])

  useFocusEffect(
    useCallback(() => {
      carregar()
    }, [carregar]),
  )

  if (a === undefined) {
    return (
      <Tela titulo="Agendamento">
        <Carregando />
      </Tela>
    )
  }
  if (!a) {
    return (
      <Tela titulo="Agendamento">
        <Vazio mostrarMel={false} titulo="Não encontramos esse agendamento." texto={erro || undefined} />
      </Tela>
    )
  }

  const troca = Boolean(a.remarca_de) && a.status === 'pendente'
  const futuro = new Date(`${a.date}T${a.start_time}`) > new Date()
  const est = a.status === 'confirmado' && !futuro ? { ...ESTADO.confirmado!, texto: 'Já aconteceu. Que tal contar como foi?' } : (ESTADO[a.status] ?? ESTADO.pendente!)
  const podeMexer = futuro && (a.status === 'pendente' || a.status === 'confirmado' || a.status === 'aguardando_pagamento')
  const podeAvaliar = a.status === 'concluido' || (a.status === 'confirmado' && new Date(`${a.date}T${a.end_time ?? a.start_time}`) < new Date())
  const preco = a.price_cents != null ? a.price_cents / 100 : (a.services?.price ?? null)
  const pago = a.pago_cents ?? 0
  // depois que o salão fechou (concluído ou com comanda), não falta mais nada
  const fechado = a.status === 'concluido' || Boolean(comanda)
  const duracao = itens.length > 1 ? itens.reduce((s, x) => s + (x.duration_minutes ?? 0), 0) || minutosEntre(a.start_time, a.end_time) : (a.services?.duration_minutes ?? minutosEntre(a.start_time, a.end_time))
  const salao = a.salons
  const vivas = partes.filter((x) => x.status === 'pendente' || x.status === 'confirmado')
  const recusadas = partes.filter((x) => x.status === 'cancelado')
  const endereco = [salao?.address, salao?.city].filter(Boolean).join(' · ')
  const rotas = salao ? (linksDeRota({ lat: salao.lat, lng: salao.lng, nome: salao.name, endereco: salao.address, cidade: salao.city }) as { google: string; waze: string; apple: string | null } | null) : null
  const pino = temPino(salao?.lat, salao?.lng)
  // veio do aviso "Como foi com a Ana?": abre a folha de estrelas direto
  const avaliandoAgora = avaliando || (avaliar === '1' && !fechouPedido && podeAvaliar && avaliada === false)
  const fecharAvaliacao = () => {
    setAvaliando(false)
    setFechouPedido(true)
  }

  function cancelar() {
    let textoPago = ''
    if (pago > 0 && dinheiro) {
      textoPago = dinheiro.dentro_do_prazo
        ? ` ${formatCents(dinheiro.volta_cents)} voltam para a sua conta em até 1 dia útil${dinheiro.taxa_cents > 0 ? ` (a taxa do PIX, ${formatCents(dinheiro.taxa_cents)}, não é devolvida)` : ''}. Se preferir, remarque: o sinal vai junto.`
        : ` Como faltam menos de ${dinheiro.horas} h, o sinal de ${formatCents(pago)} não volta, mas vira crédito com ${dinheiro.salao ?? 'a profissional'} até ${diaCurto(dinheiro.credito_ate_se_cancelar)}. Remarcar leva o sinal junto e já entra confirmado.`
    }
    setPergunta({
      titulo: troca ? 'Desistir da troca?' : 'Cancelar este horário?',
      texto: troca ? 'Seu horário atual continua valendo.' : `${nomeDoServico(a!)} em ${formatDataLonga(a!.date)} às ${hora(a!.start_time)}.${textoPago}`,
      ok: troca ? 'Desistir' : 'Cancelar horário',
      cancelar: 'Manter',
      perigo: true,
      onOk: async () => {
        const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a!.id)
        if (error) setErro(error.message)
        else carregar()
      },
    })
  }
  // a visita inteira: esta parte e as outras que ainda valem
  function cancelarVisita() {
    setPergunta({
      titulo: 'Cancelar a visita inteira?',
      texto: `${nomeDoServico(a!)} e mais ${vivas.length === 1 ? '1 parte' : vivas.length + ' partes'} em ${formatDataLonga(a!.date)}.`,
      ok: 'Cancelar tudo',
      cancelar: 'Manter',
      perigo: true,
      onOk: async () => {
        const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).in('id', [a!.id, ...vivas.map((x) => x.appointment_id)])
        if (error) setErro(error.message)
        else carregar()
      },
    })
  }
  const remarcar = () => router.push({ pathname: '/agendar/data', params: { prof: a.professional_id ?? '', servico: a.service_id ?? '', remarcar: a.id } })
  const deNovo = (servico?: string | null, prof?: string | null) => router.push({ pathname: '/agendar/servicos', params: { prof: prof ?? a.professionals?.id ?? '', servico: servico ?? a.service_id ?? '' } })

  // o que aconteceu com o dinheiro pago pelo app
  const cartaoPagamento = (() => {
    if (!(pago > 0 || pagamento || a.status === 'aguardando_pagamento')) return null
    const precoCents = a.price_cents ?? 0
    if (a.status === 'aguardando_pagamento') return { titulo: 'Aguardando o PIX', texto: 'A vaga fica guardada por 15 minutos.' }
    if (pagamento?.status === 'estorno_pendente' || pagamento?.status === 'estornado') {
      const atrasada = pagamento.status !== 'estornado' && (pagamento.tentativas_estorno ?? 0) >= 3
      return {
        titulo: pagamento.status === 'estornado' ? 'Devolvido' : atrasada ? 'Devolução atrasada' : 'Devolução a caminho',
        texto: `${formatCents(pagamento.estorno_cents ?? pagamento.valor_cents)} ${pagamento.status === 'estornado' ? 'voltaram' : 'voltam'} para a sua conta.${atrasada ? ' Já avisamos a profissional.' : ''}`,
      }
    }
    if (pagamento?.status === 'credito') return { titulo: `Sinal virou crédito: ${formatCents(pagamento.valor_cents)}`, texto: `Vale até ${diaCurto(pagamento.credito_ate)} para marcar de novo com ${dinheiro?.salao ?? 'a profissional'}. Entra como sinal, sem pagar de novo.` }
    if (pagamento?.status === 'retido') return { titulo: 'Sinal retido', texto: pagamento.motivo_estorno?.includes('venceu') ? `O crédito de ${formatCents(pagamento.valor_cents)} passou dos 30 dias sem uso e ficou com a profissional.` : `Cancelado em cima da hora: ${formatCents(pagamento.valor_cents)} ficaram com a profissional.` }
    if (pago > 0 && fechado) return { titulo: 'Atendimento pago', texto: pago < precoCents ? `Sinal de ${formatCents(pago)} pelo app e o restante acertado no salão.` : `${formatCents(pago)} pagos pelo app.` }
    if (pago > 0) {
      const falta = pago < precoCents ? `Faltam ${formatCents(precoCents - pago)}, no atendimento.` : ''
      const prazo = podeMexer && dinheiro ? (dinheiro.dentro_do_prazo ? ` Cancelando até ${quando(dinheiro.limite)}, ${formatCents(dinheiro.volta_cents)} voltam. Remarcar leva o sinal junto.` : ` Passou o prazo de ${dinheiro.horas} h: cancelando, o sinal vira crédito por 30 dias. Remarcar leva o sinal junto.`) : ''
      return { titulo: pago < precoCents ? `Sinal pago: ${formatCents(pago)}` : `Pago pelo app: ${formatCents(pago)}`, texto: `${falta}${prazo}`.trim() }
    }
    return { titulo: 'Pagamento não concluído', texto: pagamento?.status === 'expirado' ? 'A reserva venceu.' : 'Nenhum PIX confirmado.' }
  })()
  const temComprovante = (pagamento?.status === 'pago' && pago > 0) || pagamento?.status === 'estornado' || pagamento?.status === 'estorno_pendente'

  return (
    <Tela titulo="Agendamento">
      <Cartao estilo={{ gap: 8 }}>
        <Selo texto={troca ? 'Troca aguardando' : est.rotulo} tom={troca ? 'acento' : est.tom} />
        <Text style={[e.servico, { color: t.texto }]}>{nomeDoServico(a)}</Text>
        <View style={e.quando}>
          <Ionicons name="calendar-outline" size={18} color={t.acento} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={[e.quandoDia, { color: t.texto }]}>{capitalizar(formatDataLonga(a.date))}</Text>
            <Text style={{ color: t.texto2 }}>
              às {hora(a.start_time)}
              {a.end_time ? ` · até ${hora(a.end_time)}` : ''}
            </Text>
          </View>
        </View>
        <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>
          {troca && origem ? `No lugar de ${formatDataLonga(origem.date)} às ${hora(origem.start_time)}. Até ela responder, o horário de antes continua valendo.` : est.texto}
        </Text>
      </Cartao>

      {cartaoPagamento ? (
        <Cartao tom="acento" estilo={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="wallet-outline" size={18} color={t.acento} />
            <Text style={{ color: t.texto, fontWeight: '800', flex: 1 }}>{cartaoPagamento.titulo}</Text>
          </View>
          {cartaoPagamento.texto ? <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>{cartaoPagamento.texto}</Text> : null}
          <View style={e.chips}>
            {a.status === 'aguardando_pagamento' ? <Chip texto="Pagar" ativo onPress={() => router.push({ pathname: '/pagamento/[id]', params: { id: a.id } })} /> : null}
            {pagamento?.status === 'credito' && a.professionals && a.service_id ? <Chip texto="Usar o crédito" ativo onPress={() => deNovo()} /> : null}
            {temComprovante ? <Chip texto="Comprovante" onPress={() => router.push({ pathname: '/pagamento/[id]', params: { id: a.id } })} /> : null}
          </View>
        </Cartao>
      ) : null}

      {a.professionals ? (
        <Cartao onPress={() => router.push({ pathname: '/profissional/[id]', params: { id: a.professionals!.id } })} estilo={e.linha}>
          <Avatar url={a.professionals.photo_url} nome={a.professionals.name} tamanho={44} />
          <View style={{ flex: 1 }}>
            <Text style={[e.rotulo, { color: t.texto2 }]}>Com</Text>
            <Text style={[e.forte, { color: t.texto }]}>{a.professionals.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.texto3} />
        </Cartao>
      ) : null}

      <Cartao estilo={{ gap: 14 }}>
        {salao ? (
          <Dado icone="location-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Onde</Text>
            {salao.tipo === 'salao' ? (
              <Pressable onPress={() => router.push({ pathname: '/salao/[id]', params: { id: salao.id } })} hitSlop={4}>
                <Text style={[e.forte, { color: t.acento }]}>{salao.name}</Text>
              </Pressable>
            ) : (
              <Text style={[e.forte, { color: t.texto }]}>{salao.name}</Text>
            )}
            {endereco ? <Text style={{ color: t.texto2, fontSize: 13.5 }}>{endereco}</Text> : null}
            {rotas && (futuro || !pino) && a.status !== 'cancelado' ? (
              <View style={[e.chips, { marginTop: 4 }]}>
                <Chip texto="Google Maps" onPress={() => Linking.openURL(rotas.google).catch(() => {})} />
                <Chip texto="Waze" onPress={() => Linking.openURL(rotas.waze).catch(() => {})} />
                {rotas.apple && Platform.OS === 'ios' ? <Chip texto="Apple Maps" onPress={() => Linking.openURL(rotas.apple!).catch(() => {})} /> : null}
              </View>
            ) : null}
          </Dado>
        ) : null}
        {comanda ? (
          <Dado icone="receipt-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Comprovante</Text>
            <Text style={[e.forte, { color: t.texto }]}>Atendimento fechado no balcão</Text>
            {comanda.quantos > 1 ? <Text style={{ color: t.texto2, fontSize: 13.5 }}>Um comprovante só, com os {comanda.quantos} horários dessa visita.</Text> : null}
            <Pressable onPress={() => router.push({ pathname: '/comanda/[id]', params: { id: comanda.id, de: a.id } })} hitSlop={4}>
              <Text style={[e.link, { color: t.acento }]}>Ver o comprovante</Text>
            </Pressable>
          </Dado>
        ) : null}
        {itens.length > 1 ? (
          <Dado icone="sparkles-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Serviços</Text>
            {itens.map((x) => (
              <View key={x.id} style={e.item}>
                <Text style={{ color: t.texto, flex: 1 }}>{x.name}</Text>
                <Text style={{ color: t.texto2, fontSize: 13 }}>
                  {x.duration_minutes ? `${formatDuracao(x.duration_minutes)} · ` : ''}
                  {x.preco_cheio_cents != null && x.preco_cheio_cents > x.price_cents ? <Text style={{ textDecorationLine: 'line-through' }}>{formatPreco(x.preco_cheio_cents / 100)} </Text> : null}
                  {formatPreco(x.price_cents / 100)}
                </Text>
              </View>
            ))}
            <Text style={[e.forte, { color: t.texto }]}>{[preco != null ? formatPreco(preco) : null, duracao ? formatDuracao(duracao) : null].filter(Boolean).join(' · ')} no total</Text>
            {ajustadoNoSalao(a) ? (
              <Text style={{ color: t.texto2, fontSize: 13 }}>
                Ajustado no salão: você tinha marcado {a.services?.name}
                {itens.filter((x) => x.name !== a.services?.name).length ? `, e entrou ${itens.filter((x) => x.name !== a.services?.name).map((x) => x.name).join(' + ')} com ${primeiroNome(a.professionals?.name) || 'a mesma profissional'}` : ''}.
              </Text>
            ) : null}
          </Dado>
        ) : (
          <Dado icone="sparkles-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Serviço</Text>
            <Text style={[e.forte, { color: t.texto }]}>{nomeDoServico(a)}</Text>
            {ajustadoNoSalao(a) ? <Text style={{ color: t.texto2, fontSize: 13 }}>Ajustado no salão: você tinha marcado {a.services?.name}.</Text> : null}
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>
              {(a.desconto_cents ?? 0) > 0 && preco != null && a.price_cents != null ? (
                <>
                  <Text style={{ textDecorationLine: 'line-through' }}>{formatPreco((a.price_cents + (a.desconto_cents ?? 0)) / 100)}</Text> {formatPreco(preco)} · promoção
                </>
              ) : preco != null ? (
                formatPreco(preco)
              ) : null}
              {duracao ? `${preco != null ? ' · ' : ''}${formatDuracao(duracao)}` : ''}
            </Text>
          </Dado>
        )}
        {partes.length > 0 ? (
          <Dado icone="people-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Na mesma visita</Text>
            {partes.map((x) => (
              <View key={x.appointment_id} style={[e.item, { alignItems: 'center' }]}>
                <Text style={{ color: t.acento, fontWeight: '800', width: 44 }}>{hora(String(x.inicio))}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.texto, fontWeight: '700' }}>{x.servico}</Text>
                  <Text style={{ color: t.texto2, fontSize: 13 }}>
                    com {x.profissional}
                    {x.price_cents != null ? ` · ${formatPreco(x.price_cents / 100)}` : ''}
                  </Text>
                </View>
                <Selo texto={PARTE[x.status] ?? x.status} tom={x.status === 'confirmado' || x.status === 'concluido' ? 'ok' : x.status === 'pendente' ? 'aviso' : 'neutro'} />
              </View>
            ))}
            <Text style={{ color: t.texto2, fontSize: 13 }}>Cada profissional confirma a parte dela.</Text>
          </Dado>
        ) : null}
        {a.notes ? (
          <Dado icone="document-text-outline">
            <Text style={[e.rotulo, { color: t.texto2 }]}>Sua observação</Text>
            <Text style={{ color: t.texto }}>{a.notes}</Text>
          </Dado>
        ) : null}
        <Dado icone="time-outline">
          <Text style={[e.rotulo, { color: t.texto2 }]}>Pedido feito</Text>
          <Text style={{ color: t.texto }}>{dataCurta(a.created_at.slice(0, 10))}/{a.created_at.slice(0, 4)}</Text>
        </Dado>
      </Cartao>

      {erro ? <Aviso tom="erro" texto={erro} /> : null}

      {recusadas.length > 0 && podeMexer ? (
        <Cartao>
          <Text style={{ color: t.texto, fontWeight: '800' }}>{recusadas.map((x) => `${x.profissional} não pôde fazer ${x.servico}`).join('. ')}.</Text>
          <Text style={{ color: t.texto2, fontSize: 13.5 }}>O resto da visita continua como está. O que você prefere?</Text>
          {recusadas
            .filter((x) => x.service_id)
            .map((x) => (
              <Botao key={x.appointment_id} titulo={`Marcar ${x.servico} outro dia`} onPress={() => deNovo(x.service_id, x.professional_id)} />
            ))}
          <Text style={{ color: t.texto2, fontSize: 13 }}>
            ou manter só {nomeDoServico(a)}
            {vivas.length ? ' e o resto' : ''}: não precisa fazer nada.
          </Text>
        </Cartao>
      ) : null}

      <View style={{ gap: 10 }}>
        {podeMexer && regras && regras.modo !== 'nao' && pago === 0 && a.status !== 'aguardando_pagamento' ? <Botao titulo="Pagar agora pelo app" icone="wallet-outline" onPress={() => router.push({ pathname: '/pagamento/[id]', params: { id: a.id } })} /> : null}
        {podeMexer && !troca && a.service_id && regras?.permite_remarcar !== false ? (
          <Botao titulo="Remarcar" icone="repeat-outline" tipo={regras && regras.modo !== 'nao' && pago === 0 ? 'fantasma' : 'primario'} onPress={remarcar} />
        ) : null}
        {podeMexer ? <Botao titulo={troca ? 'Desistir da troca' : vivas.length ? 'Cancelar só esta parte' : 'Cancelar horário'} tipo="linha" onPress={cancelar} /> : null}
        {podeMexer && !troca && vivas.length > 0 ? <Botao titulo="Cancelar a visita inteira" tipo="linha" onPress={cancelarVisita} /> : null}
        {podeAvaliar && avaliada === false ? <Botao titulo="Avaliar como foi" icone="star-outline" onPress={() => setAvaliando(true)} /> : null}
        {!podeMexer && a.professionals && a.service_id ? <Botao titulo="Marcar de novo" icone="add-circle-outline" tipo={podeAvaliar && avaliada === false ? 'fantasma' : 'primario'} onPress={() => deNovo()} /> : null}
        {avaliada ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Ionicons name="star" size={14} color="#f5a623" />
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>
              Você deu {avaliada.nota} {avaliada.nota === 1 ? 'estrela' : 'estrelas'}. Obrigada por contar!
            </Text>
          </View>
        ) : null}
      </View>

      <Confirmacao pergunta={pergunta} onFechar={() => setPergunta(null)} />
      {a.professionals ? (
        <Avaliar
          appt={a}
          aberta={avaliandoAgora}
          onFechar={fecharAvaliacao}
          onPronto={() => {
            fecharAvaliacao()
            carregar()
          }}
        />
      ) : null}
    </Tela>
  )
}

function Dado({ icone, children }: { icone: Icone; children: React.ReactNode }) {
  const t = useTema()
  return (
    <View style={e.dado}>
      <Ionicons name={icone} size={18} color={t.acento} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 3 }}>{children}</View>
    </View>
  )
}

const e = StyleSheet.create({
  servico: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, lineHeight: 27 },
  quando: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  quandoDia: { fontSize: 15.5, fontWeight: '700' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  rotulo: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  forte: { fontSize: 15.5, fontWeight: '700' },
  link: { fontSize: 14, fontWeight: '700' },
  dado: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  item: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
