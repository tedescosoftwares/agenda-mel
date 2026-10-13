import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import QRCode from 'qrcode'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { COMO_FUNCIONA, CREDITO_DIAS, POLITICAS, TAXA_PIX_TEXTO, TERMOS_VERSAO, formatCents, formatDataLonga } from '@mimo/core'
import { Confirmacao, type Pergunta } from '@/components/Folha'
import { Tela } from '@/components/Tela'
import { Aviso, Botao, Caixa, Carregando, Cartao, Entrada } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { capitalizar } from '@/lib/agendar'
import { hora } from '@/lib/formato'
import { chamar } from '@/lib/funcoes'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// A tela do PIX (a mesma da web, ClientePagamento). Em ordem: o resumo do que
// ela está pagando, as condições com o "li e aceito", o QR com o relógio dos
// 15 minutos, e o comprovante. Depois de pago ela vê o comprovante e segue
// pelo botão; não pula sozinha.
type Appt = { id: string; status: string; date: string; start_time: string; price_cents: number | null; service_name: string | null; pago_cents: number | null; salon_id: string | null; cancelado_em: string | null; cancelado_por: string | null; services: { name: string } | null; professionals: { name: string } | null; salons: { name: string; tipo: string | null } | null }
type Item = { id: string; name: string; price_cents: number; preco_cheio_cents: number | null; ordem: number }
type Regras = { sinal_pct: number; politica: string | null }
type Pix = { ok?: boolean; motivo?: string; pagamento_id: string; copia_cola: string; valor_cents: number; expira_em: string | null; sinal_pct: number | null; existente?: boolean; sandbox?: boolean }
type Pago = { id: string; status: string; valor_cents: number; total_cents: number | null; sinal_pct: number | null; pago_em: string | null; cobranca_id: string | null; termos_aceitos_em: string | null; estorno_cents: number | null; estornado_em: string | null; motivo_estorno: string | null; tentativas_estorno: number | null }
type Comanda = { id: string; itens: { nome: string; qtd: number | null; preco_cents: number }[] | null; desconto_cents: number; total_cents: number; pagamentos: { forma: string; valor_cents: number; parcelas: number | null; detalhe: string | null; recebido_cents: number | null; troco_cents: number | null }[] | null; atendida_por: string | null }
type Estado = 'carregando' | 'resumo' | 'cpf' | 'gerando' | 'aguardando' | 'pago' | 'devolvido' | 'expirado' | 'erro'
const FORMA: Record<string, string> = { dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito', pix: 'PIX no balcão', app: 'Pago pelo app', outro: 'Outro' }

const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function quando(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`
}
function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}
const mascaraCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}

export default function Pagamento() {
  const t = useTema()
  const router = useRouter()
  const { usuario, recarregarPerfil } = useSessao()
  const { id: appt } = useLocalSearchParams<{ id: string }>()
  const [a, setA] = useState<Appt | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [regras, setRegras] = useState<Regras | null>(null)
  const [pg, setPg] = useState<Pix | null>(null)
  const [pago, setPago] = useState<Pago | null>(null)
  const [comanda, setComanda] = useState<Comanda | null>(null)
  const [cpf, setCpf] = useState('')
  const [aceite, setAceite] = useState(false)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [restante, setRestante] = useState<number | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [estado, setEstado] = useState<Estado>('carregando')
  const [simulando, setSimulando] = useState(false)
  const [simulado, setSimulado] = useState('')
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)

  // o horário, os serviços e as regras da casa; se já está pago, vai direto ao comprovante
  useEffect(() => {
    if (!usuario || !appt) return
    let vivo = true
    ;(async () => {
      const { data } = await supabase
        .from('appointments')
        .select('id, status, date, start_time, price_cents, service_name, pago_cents, salon_id, cancelado_em, cancelado_por, services (name), professionals (name), salons (name, tipo)')
        .eq('id', appt)
        .eq('client_id', usuario.id)
        .maybeSingle()
      if (!vivo) return
      const ap = (data as unknown as Appt | null) ?? null
      setA(ap)
      if (!ap) {
        setEstado('erro')
        setErro('Não encontramos esse horário.')
        return
      }
      const [it, r, pgs, cm] = await Promise.all([
        supabase.from('appointment_services').select('id, name, price_cents, preco_cheio_cents, ordem').eq('appointment_id', ap.id).order('ordem'),
        ap.salon_id ? supabase.rpc('pagamento_do_salao', { salao: ap.salon_id }) : Promise.resolve({ data: null }),
        supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, cobranca_id, termos_aceitos_em, estorno_cents, estornado_em, motivo_estorno, liquido_cents, tentativas_estorno').eq('appointment_id', ap.id).in('status', ['pago', 'estornado', 'estorno_pendente']).order('pago_em', { ascending: false }).limit(1),
        supabase.from('comandas').select('id').eq('status', 'fechada').or(`appointment_id.eq.${ap.id},appointment_ids.cs.{${ap.id}}`).limit(1).maybeSingle(),
      ])
      if (!vivo) return
      setItens((it.data ?? []) as Item[])
      setRegras((r.data as Regras | null) ?? null)
      const c = cm.data as { id: string } | null
      if (c?.id) {
        const { data: cp } = await supabase.rpc('comprovante_da_comanda', { comanda: c.id })
        if (vivo) setComanda((cp as Comanda | null) ?? null)
      }
      const p0 = ((pgs.data ?? []) as Pago[])[0]
      if (p0?.status === 'pago') {
        setPago(p0)
        setEstado('pago')
      } else if (p0) {
        setPago(p0)
        setEstado('devolvido')
      } else if (ap.status === 'cancelado') {
        setEstado('erro')
        setErro('Este horário foi cancelado.')
      } else setEstado('resumo')
    })()
    return () => {
      vivo = false
    }
  }, [usuario, appt])

  const gerar = useCallback(async () => {
    setErro('')
    setEstado('gerando')
    try {
      const r = await chamar<Pix>('pagamento-criar', { appointment_id: appt, aceite: true, termos_versao: TERMOS_VERSAO })
      if (r?.ok === false && r.motivo === 'sem_cpf') {
        setEstado('cpf')
        return
      }
      if (r?.ok === false) {
        setErro(capitalizar(r.motivo ?? 'não deu para gerar o PIX') + '.')
        setEstado('erro')
        return
      }
      setPg(r)
      setEstado('aguardando')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para gerar o PIX.')
      setEstado('erro')
    }
  }, [appt])

  // o QR, desenhado aqui mesmo a partir do copia e cola
  const copiaCola = pg?.copia_cola
  useEffect(() => {
    if (!copiaCola) return
    let vivo = true
    QRCode.toString(copiaCola, { type: 'svg', margin: 1, color: { dark: '#1f2026', light: '#ffffff' } })
      .then((svg) => {
        if (vivo) setQr('data:image/svg+xml;base64,' + btoa(svg))
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [copiaCola])

  // o relógio e a confirmação: pergunta ao banco a cada 4 s; pago vira comprovante
  const pagamentoId = pg?.pagamento_id
  const expiraEm = pg?.expira_em
  useEffect(() => {
    if (estado !== 'aguardando' || !pagamentoId) return
    let vivo = true
    const tick = async () => {
      if (expiraEm) setRestante(Math.max(0, Math.floor((new Date(expiraEm).getTime() - Date.now()) / 1000)))
      const { data } = await supabase.from('pagamentos').select('id, status, valor_cents, total_cents, sinal_pct, pago_em, cobranca_id, termos_aceitos_em').eq('id', pagamentoId).maybeSingle()
      if (!vivo) return
      const p = data as Pago | null
      if (p?.status === 'pago') {
        setPago(p)
        setEstado('pago')
      } else if (p?.status === 'expirado' || p?.status === 'cancelado') setEstado('expirado')
    }
    tick()
    const i = setInterval(tick, 4000)
    return () => {
      vivo = false
      clearInterval(i)
    }
  }, [estado, pagamentoId, expiraEm])

  async function salvarCpf() {
    if (!usuario) return
    const d = cpf.replace(/\D/g, '')
    if (!cpfValido(d)) {
      setErro('Confira o CPF: parece que tem um número errado.')
      return
    }
    const { error } = await supabase.from('profiles').update({ cpf: d }).eq('id', usuario.id)
    if (error) {
      setErro(error.message)
      return
    }
    recarregarPerfil()
    gerar()
  }
  async function copiar() {
    if (!pg) return
    await Clipboard.setStringAsync(pg.copia_cola)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }
  async function simular() {
    setSimulando(true)
    setErro('')
    try {
      const r = await chamar<{ jeito?: string; pendente?: boolean; repetida?: boolean; motivo_pix?: string }>('pagamento-criar', { appointment_id: appt, simular: true })
      setSimulado(
        r?.jeito === 'pix' && r.pendente
          ? r.repetida
            ? 'Já existe uma transação esperando autorização no painel do sandbox da conta MIMO. Aprove lá com o token 000000; não criei outra.'
            : 'A conta MIMO do sandbox pediu autorização (ação crítica). Aprove no painel com o token 000000 e esta tela confirma sozinha. Não toque de novo: cada toque criaria outra transação.'
          : r?.jeito === 'pix'
            ? 'Pago com o saldo da conta MIMO do sandbox: o dinheiro entrou de verdade na conta da profissional (no sandbox).'
            : 'A conta MIMO do sandbox não tinha saldo' + (r?.motivo_pix ? ` (${r.motivo_pix})` : '') + ', então a cobrança foi baixada como "recebida em dinheiro". Não gera saldo; a devolução, se houver, desfaz a baixa.',
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para simular.')
    } finally {
      setSimulando(false)
    }
  }
  const desistir = () =>
    setPergunta({
      titulo: 'Desistir do horário?',
      texto: 'A vaga volta a ficar livre para outra pessoa.',
      ok: 'Desistir',
      cancelar: 'Continuar pagando',
      perigo: true,
      onOk: async () => {
        await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', appt)
        router.dismissTo('/')
      },
    })
  const verHorario = () => router.replace({ pathname: '/agendamento/[id]', params: { id: appt } })
  const seguir = () => {
    router.dismissTo('/')
    router.push({ pathname: '/agendar/sucesso', params: { id: appt } })
  }

  // depois que a visita fechou, nada mais falta; e só faz sentido 'seguir' quando o horário ainda vai acontecer
  const fechado = a?.status === 'concluido' || Boolean(comanda)
  const futuro = Boolean(a) && (a!.status === 'pendente' || a!.status === 'confirmado') && a!.date >= hojeIso()
  // a prévia do que ela vai pagar: o banco confirma na hora de gerar
  const total = a?.price_cents ?? 0
  const pct = pg?.sinal_pct ?? regras?.sinal_pct ?? 100
  const agora = pg?.valor_cents ?? (total > 0 ? Math.max(100, Math.round((total * pct) / 100)) : 0)
  const resto = Math.max(0, total - agora)
  const pol = POLITICAS[(regras?.politica ?? 'moderada') as keyof typeof POLITICAS] ?? POLITICAS.moderada
  const minutos = restante != null ? `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}` : null
  const nomeDoServico = a?.service_name ?? a?.services?.name ?? 'Atendimento'
  const comprovante = estado === 'pago' || estado === 'devolvido'

  return (
    <Tela titulo={comprovante ? 'Comprovante' : 'Pagar pelo app'}>
      {!comprovante && a ? (
        <Cartao estilo={{ gap: 8 }}>
          <Linha rotulo="Com" valor={`${a.professionals?.name ?? ''}${a.salons?.name && a.salons.name !== a.professionals?.name ? ` · ${a.salons.name}` : ''}`} />
          <Linha rotulo="Data" valor={capitalizar(formatDataLonga(a.date))} />
          <Linha rotulo="Horário" valor={hora(a.start_time)} />
          {itens.length > 0 ? (
            itens.map((x) => <Linha key={x.id} rotulo={x.name} valor={formatCents(x.price_cents)} de={x.preco_cheio_cents != null && x.preco_cheio_cents > x.price_cents ? formatCents(x.preco_cheio_cents) : undefined} suave />)
          ) : (
            <Linha rotulo={nomeDoServico} valor={formatCents(total)} suave />
          )}
          <Linha rotulo="Total dos serviços" valor={formatCents(total)} />
          <View style={[e.linha, { borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 }]}>
            <Text style={{ color: t.texto, fontWeight: '700', flex: 1 }}>{pct < 100 ? `Sinal de ${pct}%, agora por PIX` : 'Agora por PIX'}</Text>
            <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17 }}>{formatCents(agora)}</Text>
          </View>
          {resto > 0 ? <Text style={{ color: t.texto2, fontSize: 13 }}>O restante, {formatCents(resto)}, você acerta no atendimento.</Text> : null}
        </Cartao>
      ) : null}

      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      {estado === 'carregando' ? <Carregando /> : null}

      {estado === 'resumo' && a ? (
        <Cartao estilo={{ gap: 10 }}>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 16 }}>Antes de pagar, combinado é combinado</Text>
          {[
            `O PIX vai para a conta de recebimento de ${a.salons?.name ?? a.professionals?.name ?? 'quem te atende'}, processado por ${COMO_FUNCIONA.provedor.split(' ')[0]}. A vaga fica guardada por 15 minutos enquanto o PIX não cai; caiu, o horário está confirmado.`,
            `Cancelando até ${pol.horas} h antes (política ${pol.rotulo.toLowerCase()}), o valor volta para a sua conta em até 1 dia útil, menos a taxa do PIX (${TAXA_PIX_TEXTO}), que o processador não devolve. Se você pagar já dentro do prazo, ainda pode desistir com devolução em até 1 hora depois de pagar.`,
            `Depois desse prazo, o sinal não é devolvido: vira crédito por ${CREDITO_DIAS} dias para marcar de novo com a mesma casa. Sem uso nesse período, fica com a casa. Remarcar leva o sinal junto, em qualquer prazo.`,
            'Se for a profissional quem cancelar, o valor volta também, menos a taxa do PIX.',
            ...(resto > 0 ? [`O restante, ${formatCents(resto)}, é pago no atendimento, direto com a profissional.`] : []),
          ].map((x, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: t.acento }}>•</Text>
              <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19, flex: 1 }}>{x}</Text>
            </View>
          ))}
          <Caixa marcado={aceite} onPress={() => setAceite((v) => !v)} titulo="Li e aceito as condições" sub="de pagamento, devolução e crédito descritas acima." />
          <Botao titulo={`Gerar o PIX de ${formatCents(agora)}`} icone="qr-code-outline" desabilitado={!aceite} onPress={gerar} />
          <Pressable onPress={desistir} hitSlop={6} style={{ alignSelf: 'center' }}>
            <Text style={{ color: t.texto2, fontWeight: '700', textDecorationLine: 'underline' }}>Desistir do horário</Text>
          </Pressable>
        </Cartao>
      ) : null}

      {estado === 'cpf' ? (
        <Cartao estilo={{ gap: 10 }}>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 16 }}>Só uma vez: seu CPF</Text>
          <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>O PIX precisa do CPF de quem paga. Fica guardado para as próximas vezes e não aparece para a profissional.</Text>
          <Entrada rotulo="CPF" placeholder="000.000.000-00" value={cpf} onChangeText={(v) => setCpf(mascaraCpf(v))} keyboardType="number-pad" maxLength={14} autoFocus />
          <Botao titulo="Continuar para o PIX" onPress={salvarCpf} />
        </Cartao>
      ) : null}

      {estado === 'gerando' ? <Carregando texto="Gerando o seu PIX…" /> : null}

      {estado === 'aguardando' && pg ? (
        <Cartao estilo={{ alignItems: 'center', gap: 10 }}>
          <View style={e.qr}>{qr ? <Image source={{ uri: qr }} style={{ width: 220, height: 220 }} contentFit="contain" /> : <Carregando />}</View>
          <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19, textAlign: 'center' }}>
            Abra o app do seu banco, escolha <Text style={{ fontWeight: '700', color: t.texto }}>Pix, ler QR code</Text> e aponte a câmera. Ou copie o código:
          </Text>
          <Botao titulo={copiado ? 'Copiado!' : 'Copiar código PIX'} icone={copiado ? 'checkmark' : 'copy-outline'} tipo={copiado ? 'fantasma' : 'primario'} onPress={copiar} estilo={{ alignSelf: 'stretch' }} />
          {minutos ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="time-outline" size={14} color={t.texto2} />
              <Text style={{ color: t.texto2, fontSize: 13.5 }}>
                {restante != null && restante > 0 ? (
                  <>
                    Reserva guardada por <Text style={{ fontWeight: '800', color: t.texto }}>{minutos}</Text>
                  </>
                ) : (
                  'A reserva venceu'
                )}
              </Text>
            </View>
          ) : null}
          <Text style={{ color: t.texto3, fontSize: 12.5, textAlign: 'center' }}>Assim que o PIX cair, esta tela mostra o comprovante.</Text>
          <Pressable onPress={desistir} hitSlop={6}>
            <Text style={{ color: t.texto2, fontWeight: '700', textDecorationLine: 'underline' }}>Desistir do horário</Text>
          </Pressable>
          {pg.sandbox ? <Botao titulo={simulando ? 'Simulando…' : 'Simular pagamento (teste)'} tipo="linha" onPress={simular} desabilitado={simulando} estilo={{ alignSelf: 'stretch' }} /> : null}
          {simulado ? <Text style={{ color: t.texto2, fontSize: 12.5, lineHeight: 17 }}>{simulado}</Text> : null}
        </Cartao>
      ) : null}

      {estado === 'pago' && a && pago ? (
        <>
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            <View style={[e.check, { backgroundColor: t.veu }]}>
              <Ionicons name="checkmark" size={36} color={t.acento} />
            </View>
            <Text style={[e.titulo, { color: t.texto }]}>{fechado ? 'Atendimento concluído' : 'Pagamento confirmado!'}</Text>
            <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>
              {fechado ? (comanda ? 'Você pagou o sinal pelo app e o restante no salão. Está tudo aqui.' : 'O sinal foi pago pelo app.') : a.status === 'cancelado' ? 'Este horário foi cancelado.' : 'Seu horário já está confirmado na agenda da profissional.'}
            </Text>
          </View>
          <Cartao estilo={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="receipt-outline" size={18} color={t.acento} />
              <Text style={{ color: t.texto, fontWeight: '800' }}>Comprovante</Text>
            </View>
            <Linha rotulo="Valor pago" valor={`${formatCents(pago.valor_cents)}${pago.sinal_pct && pago.sinal_pct < 100 ? ` (sinal de ${pago.sinal_pct}%)` : ''}`} />
            <Linha rotulo="Forma" valor="PIX" />
            <Linha rotulo="Pago em" valor={quando(pago.pago_em)} />
            {a.salons?.name && a.salons.name !== a.professionals?.name ? <Linha rotulo="Para" valor={a.salons.name} /> : null}
            <Linha rotulo="Com" valor={a.professionals?.name ?? ''} />
            <Linha rotulo="Data" valor={capitalizar(formatDataLonga(a.date))} />
            <Linha rotulo="Horário" valor={hora(a.start_time)} />
            {!comanda ? (itens.length > 0 ? itens.map((x) => <Linha key={x.id} rotulo={x.name} valor={formatCents(x.price_cents)} suave />) : <Linha rotulo={nomeDoServico} valor={formatCents(total)} suave />) : null}
            {!comanda ? <Linha rotulo="Total dos serviços" valor={formatCents(pago.total_cents ?? total)} /> : null}
            {!fechado && (pago.total_cents ?? total) - pago.valor_cents > 0 ? <Linha rotulo="Restante no atendimento" valor={formatCents((pago.total_cents ?? total) - pago.valor_cents)} /> : null}
            {comanda ? (
              <View style={[{ gap: 6, borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 }]}>
                <Text style={{ color: t.texto, fontWeight: '800' }}>No salão, ao fechar</Text>
                {(comanda.itens ?? []).map((x, k) => (
                  <Linha key={k} rotulo={`${x.nome}${(x.qtd ?? 1) > 1 ? ` × ${x.qtd}` : ''}`} valor={formatCents(x.preco_cents * (x.qtd ?? 1))} suave />
                ))}
                {comanda.desconto_cents > 0 ? <Linha rotulo="Desconto" valor={`− ${formatCents(comanda.desconto_cents)}`} /> : null}
                <Linha rotulo="Total do atendimento" valor={formatCents(comanda.total_cents)} />
                {(comanda.pagamentos ?? []).map((p, k) => (
                  <Linha key={k} rotulo={p.forma === 'app' ? 'Sinal pago pelo app' : `${FORMA[p.forma] ?? p.forma}${(p.parcelas ?? 0) > 1 ? ` em ${p.parcelas}x` : ''}${p.detalhe ? ` · ${p.detalhe}` : ''}${(p.troco_cents ?? 0) > 0 ? ` · entregue ${formatCents(p.recebido_cents ?? 0)}, troco ${formatCents(p.troco_cents ?? 0)}` : ''}`} valor={formatCents(p.valor_cents)} suave />
                ))}
                {comanda.atendida_por ? <Text style={{ color: t.texto3, fontSize: 12 }}>Com {comanda.atendida_por} · comprovante nº {String(comanda.id).slice(0, 8)}</Text> : null}
              </View>
            ) : null}
            {pago.cobranca_id ? <Text style={{ color: t.texto3, fontSize: 12 }}>Identificação do pagamento: {pago.cobranca_id}</Text> : null}
            {pago.termos_aceitos_em ? <Text style={{ color: t.texto3, fontSize: 12 }}>Condições aceitas em {quando(pago.termos_aceitos_em)}.</Text> : null}
          </Cartao>
          {futuro ? <Botao titulo="Tudo certo, seguir" icone="arrow-forward" onPress={seguir} /> : <Botao titulo="Ver o horário" icone="calendar-outline" onPress={verHorario} />}
          {futuro ? <Botao titulo="Ver o horário" tipo="fantasma" onPress={verHorario} /> : null}
          {comanda ? <Botao titulo="Comprovante completo do atendimento" tipo="fantasma" onPress={() => router.push({ pathname: '/comanda/[id]', params: { id: comanda.id, de: appt } })} /> : null}
        </>
      ) : null}

      {estado === 'devolvido' && a && pago ? (
        <>
          <Cartao estilo={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="receipt-outline" size={18} color={t.acento} />
              <Text style={{ color: t.texto, fontWeight: '800' }}>{pago.status === 'estornado' ? 'Comprovante da devolução' : 'Devolução a caminho'}</Text>
            </View>
            <Linha rotulo="Você pagou" valor={`${formatCents(pago.valor_cents)}${pago.sinal_pct && pago.sinal_pct < 100 ? ` (sinal de ${pago.sinal_pct}%)` : ''}`} />
            <Linha rotulo="Pago em" valor={quando(pago.pago_em)} />
            <Linha rotulo="Cancelado" valor={`${quando(a.cancelado_em)}${a.cancelado_por === 'cliente' ? ', por você' : a.cancelado_por && a.cancelado_por !== 'sistema' ? (a.salons?.tipo === 'autonoma' ? ', pela profissional' : ', pelo salão') : ''}`} />
            <Linha rotulo={pago.status === 'estornado' ? 'Devolvido' : 'Vai voltar'} valor={formatCents(pago.estorno_cents ?? pago.valor_cents)} />
            {(pago.estorno_cents ?? pago.valor_cents) < pago.valor_cents ? <Linha rotulo="Taxa do PIX, não devolvida" valor={formatCents(pago.valor_cents - (pago.estorno_cents ?? pago.valor_cents))} /> : null}
            <Linha rotulo={pago.status === 'estornado' ? 'Devolvido em' : 'Situação'} valor={pago.status === 'estornado' ? quando(pago.estornado_em) : (pago.tentativas_estorno ?? 0) >= 3 ? 'Atrasada, já avisamos a profissional' : 'Em até 1 dia útil, na conta de onde veio o PIX'} />
            <Linha rotulo="Com" valor={`${a.professionals?.name ?? ''}${a.salons?.name && a.salons.name !== a.professionals?.name ? ` · ${a.salons.name}` : ''}`} />
            <Linha rotulo="Horário" valor={`${formatDataLonga(a.date)} às ${hora(a.start_time)}`} />
            {itens.length > 0 ? itens.map((x) => <Linha key={x.id} rotulo={x.name} valor={formatCents(x.price_cents)} suave />) : <Linha rotulo={nomeDoServico} valor={formatCents(total)} suave />}
            {pago.motivo_estorno ? <Text style={{ color: t.texto3, fontSize: 12 }}>Motivo: {pago.motivo_estorno}.</Text> : null}
            {pago.cobranca_id ? <Text style={{ color: t.texto3, fontSize: 12 }}>Identificação do pagamento: {pago.cobranca_id}</Text> : null}
          </Cartao>
          <Botao titulo="Ver o horário" tipo="fantasma" onPress={verHorario} />
        </>
      ) : null}

      {estado === 'expirado' ? (
        <Cartao estilo={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 16 }}>A reserva venceu.</Text>
          <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>O PIX não chegou a tempo e o horário voltou a ficar livre. Se ainda quiser, marque de novo.</Text>
          <Botao titulo="Voltar ao início" onPress={() => router.dismissTo('/')} estilo={{ alignSelf: 'stretch' }} />
        </Cartao>
      ) : null}

      {estado === 'erro' ? (
        <View style={{ gap: 10 }}>
          {a ? (
            <Botao
              titulo="Tentar de novo"
              onPress={() => {
                setErro('')
                setEstado('resumo')
              }}
            />
          ) : null}
          <Botao titulo={a ? 'Ver o horário' : 'Voltar ao início'} tipo="fantasma" onPress={() => (a ? verHorario() : router.dismissTo('/'))} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Ionicons name="shield-checkmark-outline" size={13} color={t.texto3} />
        <Text style={{ color: t.texto3, fontSize: 12 }}>Pagamento processado por {COMO_FUNCIONA.provedor.split(' ')[0]}, instituição autorizada pelo Banco Central.</Text>
      </View>
      <Confirmacao pergunta={pergunta} onFechar={() => setPergunta(null)} />
    </Tela>
  )
}

function Linha({ rotulo, valor, de, suave = false }: { rotulo: string; valor: string; de?: string; suave?: boolean }) {
  const t = useTema()
  return (
    <View style={e.linha}>
      <Text style={{ color: suave ? t.texto : t.texto2, flex: 1 }}>{rotulo}</Text>
      <Text style={{ color: t.texto, fontWeight: suave ? '500' : '700', textAlign: 'right' }}>
        {de ? <Text style={{ color: t.texto3, textDecorationLine: 'line-through' }}>{de} </Text> : null}
        {valor}
      </Text>
    </View>
  )
}

const e = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  qr: { width: 236, height: 236, padding: 8, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  check: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
})
