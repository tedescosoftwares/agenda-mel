import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatDataLonga, labelDuracao, textoPolitica, textoSinal } from '@mimo/core'
import { Tela } from '@/components/Tela'
import { Trilha } from '@/components/Trilha'
import { Aviso, Botao, Caixa, Cartao, Entrada, Selo } from '@/components/ui'
import { capitalizar, curta, diffMin, escreverExtras, lerExtras, somarMin, useContexto, useEscolhas, useOrigem, type Servico } from '@/lib/agendar'
import { dataCurta, formatDuracao, formatPreco } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { MARCA, useTema } from '@/lib/tema'

// Passo 4: confirmar. O resumo, os descontos, o "quer aproveitar e
// adicionar?", a visita com outras profissionais do salão, a observação, o
// crédito e o pagamento pelo app. As mesmas regras da web (AgendarConfirmar);
// o banco é quem decide preço, duração e se o pedido fica pendente.
type Pagamento = { modo: string; sinal_pct: number; politica: string | null; permite_remarcar?: boolean | null }
type Credito = { pagamento_id: string; valor_cents: number; ate: string; de: string | null }
type Desconto = { service_id: string; titulo: string; desconto_pct: number; preco_cents: number; preco_com_desconto_cents: number }
type Sugestao = { service_id: string; service_name: string; price: number; duration_minutes: number; professional_id: string; professional_name: string; photo_url: string | null; hora_sugerida: string; modo: string }
type ServicoCurto = { id: string; name: string; price: number; duration_minutes: number }
type ProfCurto = { id: string; name: string; photo_url: string | null }
type Resposta = { ok?: boolean; appointment_id?: string; motivo?: string; pagar?: boolean }

export default function Confirmar() {
  const t = useTema()
  const router = useRouter()
  const esc = useEscolhas()
  const { prof, servico } = useContexto(esc.prof, esc.servico)
  const remarcando = Boolean(esc.remarcar)
  const origem = useOrigem(esc.remarcar)
  const ids = servico?.ids ?? []
  const chaveIds = ids.join(',')
  const extras = lerExtras(esc.extra)
  const [pagamento, setPagamento] = useState<Pagamento | null>(null)
  const [querPagar, setQuerPagar] = useState(false)
  const [credito, setCredito] = useState<Credito | null>(null)
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [outros, setOutros] = useState<Servico[]>([])
  const [juntos, setJuntos] = useState<string[]>([])
  // o que veio do banco fica guardado com a chave do pedido a que pertence:
  // mudou o pedido, o valor derivado volta ao padrão sem precisar zerar estado
  const [descontosDe, setDescontosDe] = useState<{ chave: string; mapa: Record<string, Desconto> } | null>(null)
  const [conferido, setConferido] = useState<{ chave: string; cabe: boolean } | null>(null)
  const [comEspera, setComEspera] = useState(false)
  const [visitaDe, setVisitaDe] = useState<{ lista: Sugestao[] } | null>(null)
  const [detalhes, setDetalhes] = useState<{ servicos: Record<string, ServicoCurto>; profs: Record<string, ProfCurto> }>({ servicos: {}, profs: {} })

  // como o salão recebe (090) e o crédito de remarcação com esta casa (094)
  const salaoId = prof?.salon_id ?? null
  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    supabase.rpc('pagamento_do_salao', { salao: salaoId }).then(({ data }) => {
      if (vivo) setPagamento((data as Pagamento | null) ?? null)
    })
    supabase.rpc('meu_credito', { salao: salaoId }).then(({ data }) => {
      if (vivo) setCredito((data as Credito | null) ?? null)
    })
    return () => {
      vivo = false
    }
  }, [salaoId])

  // o desconto das promoções que ela enxerga (084): o banco aplica de novo ao marcar
  useEffect(() => {
    if (!chaveIds || remarcando) return
    let vivo = true
    supabase.rpc('descontos_para_mim', { servicos: chaveIds.split(',') }).then(({ data }) => {
      if (vivo) setDescontosDe({ chave: chaveIds, mapa: Object.fromEntries(((data ?? []) as Desconto[]).map((x) => [x.service_id, x])) })
    })
    return () => {
      vivo = false
    }
  }, [chaveIds, remarcando])
  const descontos: Record<string, Desconto> = !remarcando && descontosDe?.chave === chaveIds ? descontosDe.mapa : {}

  // os outros serviços dela, para o "quer aproveitar e adicionar?"
  useEffect(() => {
    if (!esc.prof || remarcando) return
    let vivo = true
    supabase
      .from('professional_services')
      .select('services (*)')
      .eq('professional_id', esc.prof)
      .then(({ data }) => {
        if (vivo) setOutros(((data ?? []) as unknown as { services: Servico | null }[]).map((v) => v.services).filter((x): x is Servico => Boolean(x?.active)))
      })
    return () => {
      vivo = false
    }
  }, [esc.prof, remarcando])
  useEffect(() => {
    if (!chaveIds || remarcando) return
    let vivo = true
    supabase
      .from('servicos_juntos')
      .select('sugerido_id')
      .in('service_id', chaveIds.split(','))
      .then(({ data }) => {
        if (vivo) setJuntos(((data ?? []) as { sugerido_id: string }[]).map((x) => x.sugerido_id))
      })
    return () => {
      vivo = false
    }
  }, [chaveIds, remarcando])

  // adicionou serviço: a duração cresce; o horário escolhido ainda cabe?
  const duracao = servico?.duration_minutes
  const precisaConferir = Boolean(esc.prof && esc.data && esc.hora && duracao && !remarcando && ids.length >= 2)
  const chaveCabe = `${esc.prof}|${esc.data}|${esc.hora}|${chaveIds}|${duracao ?? ''}`
  useEffect(() => {
    if (!precisaConferir) return
    let vivo = true
    supabase.rpc('horarios_livres', { prof: esc.prof, dia: esc.data, duracao }).then(({ data }) => {
      if (vivo) setConferido({ chave: chaveCabe, cabe: ((data ?? []) as { hora: string }[]).map((h) => String(h.hora ?? h).slice(0, 5)).includes(esc.hora) })
    })
    return () => {
      vivo = false
    }
  }, [precisaConferir, chaveCabe, esc.prof, esc.data, esc.hora, duracao])
  const conferindo = precisaConferir && conferido?.chave !== chaveCabe
  const cabe = !precisaConferir || conferido?.chave !== chaveCabe || conferido.cabe

  // os nomes das partes que vieram nos parâmetros
  const chaveExtras = esc.extra
  useEffect(() => {
    const lista = lerExtras(chaveExtras)
    if (!lista.length) return
    let vivo = true
    Promise.all([
      supabase.from('services').select('id, name, price, duration_minutes').in('id', lista.map((x) => x.servico)),
      supabase.from('professionals').select('id, name, photo_url').in('id', lista.map((x) => x.prof)),
    ]).then(([s, p]) => {
      if (!vivo) return
      setDetalhes({
        servicos: Object.fromEntries(((s.data ?? []) as ServicoCurto[]).map((x) => [x.id, x])),
        profs: Object.fromEntries(((p.data ?? []) as ProfCurto[]).map((x) => [x.id, x])),
      })
    })
    return () => {
      vivo = false
    }
  }, [chaveExtras])

  // o que outras profissionais do salão fazem na sequência
  const fimDasPartes = extras.reduce((fim, x) => {
    const s = detalhes.servicos[x.servico]
    const f = s ? somarMin(x.hora, s.duration_minutes) : x.hora
    return f > fim ? f : fim
  }, '00:00')
  const querVisita = Boolean(esc.prof && esc.data && esc.hora && duracao && !remarcando)
  useEffect(() => {
    if (!querVisita) return
    let vivo = true
    supabase
      .rpc('sugestoes_de_visita', { prof: esc.prof, servicos: chaveIds.split(','), dia: esc.data, hora: esc.hora, com_espera: comEspera, apos: chaveExtras ? fimDasPartes : null })
      .then(({ data }) => {
        if (vivo) setVisitaDe({ lista: (data ?? []) as Sugestao[] })
      })
    return () => {
      vivo = false
    }
  }, [querVisita, esc.prof, esc.data, esc.hora, chaveIds, chaveExtras, comEspera, fimDasPartes])
  const visita = querVisita ? (visitaDe?.lista ?? []) : []

  const precoDe = (x: Servico) => (descontos[x.id] ? descontos[x.id]!.preco_com_desconto_cents / 100 : Number(x.price ?? 0))
  const totalCheio = servico ? Number(servico.price ?? 0) : 0
  const totalComDesconto = servico ? servico.lista.reduce((a, x) => a + precoDe(x), 0) : 0
  const economia = totalCheio - totalComDesconto
  const sugVisita = visita.filter((v) => !extras.some((x) => x.servico === v.service_id) && !ids.includes(v.service_id)).slice(0, 4)
  const fimPrincipal = esc.hora && servico ? somarMin(esc.hora, servico.duration_minutes) : ''

  // mudar os serviços principais muda a hora em que ela termina: as partes saem
  const irCom = (novos: string[]) => router.setParams({ servico: novos.join(','), extra: '' })
  const irComExtras = (lista: { servico: string; prof: string; hora: string }[]) => router.setParams({ extra: escreverExtras(lista) })
  const juntarParte = (v: Sugestao) => {
    if (extras.length < 3) irComExtras([...extras, { servico: v.service_id, prof: v.professional_id, hora: String(v.hora_sugerida).slice(0, 5) }])
  }
  const tirarParte = (i: number) => irComExtras(extras.filter((_, k) => k !== i))
  const partesDetalhadas = extras.map((x) => ({ ...x, s: detalhes.servicos[x.servico], p: detalhes.profs[x.prof] }))
  const totalVisita = totalComDesconto + partesDetalhadas.reduce((a, x) => a + Number(x.s?.price ?? 0), 0)
  const adicionar = (id: string) => {
    if (ids.length < 6 && !ids.includes(id)) irCom([...ids, id])
  }
  const tirar = (id: string) => {
    if (ids.length > 1) irCom(ids.filter((x) => x !== id))
  }
  const peso = (x: Servico) => (juntos.includes(x.id) ? 0 : servico?.lista.some((s) => s.categoria_id && s.categoria_id === x.categoria_id) ? 1 : 2)
  const sugestoes = outros
    .filter((x) => !ids.includes(x.id))
    .sort((a, b) => peso(a) - peso(b) || a.name.localeCompare(b.name))
    .slice(0, 4)
  const ultimo = servico?.lista[servico.lista.length - 1]

  // deu certo: a pilha do fluxo vai embora e a tela de sucesso fica sozinha por cima das abas
  const terminar = (id: string) => {
    router.dismissTo('/')
    router.push({ pathname: '/agendar/sucesso', params: { id } })
  }

  async function confirmar() {
    if (!servico || !esc.data || !esc.hora) return
    setSalvando(true)
    setErro('')
    if (esc.remarcar) {
      // remarcação: o banco cria o pedido ligado ao horário atual e decide,
      // pela configuração da profissional, se espera o aceite
      const { data, error } = await supabase.rpc('pedir_remarcacao', { appt: esc.remarcar, nova_data: esc.data, nova_hora: esc.hora })
      setSalvando(false)
      if (error) {
        setErro('Não deu para pedir a remarcação: ' + error.message)
        return
      }
      const r = data as Resposta | null
      if (!r?.ok) {
        setErro(capitalizar(r?.motivo || 'não deu para remarcar') + '.')
        return
      }
      terminar(r.appointment_id ?? 'novo')
      return
    }
    // um ou vários serviços: o banco soma duração e preço e guarda os itens (079);
    // com outras profissionais na sequência é uma visita: cada parte vira um pedido (081)
    const partes = lerExtras(esc.extra)
    const { data, error } = partes.length
      ? await supabase.rpc('marcar_visita', { dia: esc.data, partes: [{ prof: esc.prof, servicos: ids, hora: esc.hora }, ...partes.map((x) => ({ prof: x.prof, servicos: [x.servico], hora: x.hora }))], obs: obs.trim() || null })
      : await supabase.rpc('marcar_servicos', { prof: esc.prof, servicos: ids, dia: esc.data, hora: esc.hora, obs: obs.trim() || null, pagar: querPagar })
    setSalvando(false)
    if (error) {
      const ocupado = error.code === '23505' || error.code === '23P01' || /^ocupado:/.test(error.message)
      setErro(
        ocupado
          ? partes.length
            ? 'Um dos horários acabou de ser reservado por outra pessoa. Nada foi marcado: tire essa parte ou escolha outro horário.'
            : 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.'
          : 'Erro ao agendar: ' + error.message,
      )
      return
    }
    const r = data as Resposta | null
    if (r?.ok === false) {
      setErro(r.motivo === 'ocupado' ? 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.' : capitalizar(r.motivo || 'não deu para marcar') + '.')
      return
    }
    if (r?.pagar && r.appointment_id) {
      // reserva com pagamento: o PIX do sinal, nativo
      router.dismissTo('/')
      router.push({ pathname: '/pagamento/[id]', params: { id: r.appointment_id } })
      return
    }
    terminar(r?.appointment_id ?? 'novo')
  }

  const pagaAgora = (pagamento?.modo === 'obrigatorio' || querPagar) && partesDetalhadas.length === 0 && !credito
  const rotuloBotao = salvando ? 'Enviando…' : remarcando ? 'Pedir a troca' : pagaAgora ? 'Reservar e pagar' : 'Confirmar pedido'
  const sinalCents = pagamento ? Math.round((totalComDesconto * 100 * pagamento.sinal_pct) / 100) : 0

  return (
    <Tela
      titulo={remarcando ? 'Confirmar troca' : 'Confirmar pedido'}
      rodape={<Botao titulo={rotuloBotao} icone={remarcando ? 'swap-horizontal-outline' : 'checkmark-circle-outline'} onPress={confirmar} carregando={salvando} desabilitado={!servico || !cabe || conferindo} />}
    >
      <Trilha passo={4} remarcar={remarcando} />
      {erro ? <Aviso tom="erro" texto={erro} /> : null}

      <Text style={[e.secao, { color: t.texto }]}>{remarcando ? 'Resumo da troca' : 'Resumo do pedido'}</Text>
      <Cartao estilo={{ gap: 8 }}>
        {servico && servico.lista.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.texto2 }}>Serviços</Text>
            {servico.lista.map((x) => (
              <View key={x.id} style={e.item}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[e.itemNome, { color: t.texto, flexShrink: 1 }]}>{x.name}</Text>
                    {descontos[x.id] ? <Selo texto={`-${descontos[x.id]!.desconto_pct}%`} tom="acento" /> : null}
                  </View>
                  <Text style={{ color: t.texto2, fontSize: 13 }}>
                    {labelDuracao(x)} ·{' '}
                    {descontos[x.id] ? (
                      <>
                        <Text style={{ textDecorationLine: 'line-through' }}>{formatPreco(x.price)}</Text> {formatPreco(precoDe(x))}
                      </>
                    ) : (
                      formatPreco(x.price)
                    )}
                  </Text>
                </View>
                {!remarcando ? (
                  <Pressable onPress={() => tirar(x.id)} hitSlop={8} accessibilityLabel={`Tirar ${x.name}`} style={[e.tirar, { backgroundColor: t.superficie2 }]}>
                    <Ionicons name="close" size={16} color={t.texto2} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <LinhaResumo rotulo="Serviço" valor={servico?.name ?? '…'} />
        )}
        <LinhaResumo rotulo="Profissional" valor={prof?.name ?? '…'} />
        {remarcando ? (
          <>
            <LinhaResumo rotulo="Era" valor={origem ? `${curta(origem.date)} às ${origem.start_time.slice(0, 5)}` : '…'} />
            <LinhaResumo rotulo="Passa para" valor={`${esc.data ? curta(esc.data) : ''} às ${esc.hora}`} destaque />
          </>
        ) : (
          <>
            <LinhaResumo rotulo="Data" valor={esc.data ? capitalizar(formatDataLonga(esc.data)) : '…'} />
            <LinhaResumo rotulo="Horário" valor={esc.hora} />
          </>
        )}
        {servico ? (
          <LinhaResumo
            rotulo={servico.lista.length > 1 ? 'Duração total' : 'Duração'}
            valor={formatDuracao(servico.duration_minutes) + (servico.lista.length > 1 ? ` (${servico.lista.map((x) => formatDuracao(x.duration_minutes)).join(' + ')})` : '')}
          />
        ) : null}
        {economia > 0 && !remarcando ? (
          <LinhaResumo
            rotulo={Object.values(descontos)
              .map((d) => d.titulo)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(', ')}
            valor={`− ${formatPreco(economia)}`}
            cor={t.acento}
          />
        ) : null}
        <View style={[e.linha, { borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 }]}>
          <Text style={{ color: t.texto, fontWeight: '700' }}>{servico && servico.lista.length > 1 ? 'Valor total' : 'Valor'}</Text>
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17 }}>
            {servico ? (
              economia > 0 && !remarcando ? (
                <>
                  <Text style={{ color: t.texto3, textDecorationLine: 'line-through', fontSize: 14, fontWeight: '600' }}>{formatPreco(totalCheio)}</Text> {formatPreco(totalComDesconto)}
                </>
              ) : (
                formatPreco(servico.price)
              )
            ) : (
              '…'
            )}
          </Text>
        </View>
      </Cartao>

      {partesDetalhadas.length > 0 ? (
        <Cartao estilo={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="people-outline" size={18} color={t.acento} />
            <Text style={{ color: t.texto, fontWeight: '800' }}>Na mesma visita</Text>
            <Text style={{ color: t.texto2, fontSize: 12.5, flex: 1 }}>cada profissional confirma a parte dela</Text>
          </View>
          {partesDetalhadas.map((x, i) => {
            const antes = i === 0 ? fimPrincipal : somarMin(partesDetalhadas[i - 1]!.hora, partesDetalhadas[i - 1]!.s?.duration_minutes ?? 0)
            const espera = fimPrincipal ? diffMin(antes, x.hora) : 0
            return (
              <View key={x.servico + x.prof} style={e.item}>
                <Text style={[e.parteHora, { color: t.acento }]}>{x.hora}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[e.itemNome, { color: t.texto }]}>{x.s?.name ?? '…'}</Text>
                  <Text style={{ color: t.texto2, fontSize: 13 }}>
                    com {x.p?.name ?? '…'}
                    {x.s ? ` · ${formatDuracao(x.s.duration_minutes)} · ${formatPreco(x.s.price)}` : ''}
                    {espera > 0 ? ` · espera de ${formatDuracao(espera)}` : ''}
                  </Text>
                </View>
                <Pressable onPress={() => tirarParte(i)} hitSlop={8} accessibilityLabel={`Tirar ${x.s?.name ?? 'parte'}`} style={[e.tirar, { backgroundColor: t.superficie2 }]}>
                  <Ionicons name="close" size={16} color={t.texto2} />
                </Pressable>
              </View>
            )
          })}
          <View style={[e.linha, { borderTopColor: t.fio, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 }]}>
            <Text style={{ color: t.texto, fontWeight: '700' }}>Valor da visita</Text>
            <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17 }}>{formatPreco(totalVisita)}</Text>
          </View>
        </Cartao>
      ) : null}

      {!remarcando && !cabe && servico && ultimo ? (
        <Cartao estilo={{ borderColor: t.erro }}>
          <Text style={{ color: t.texto, lineHeight: 20 }}>
            Com {ultimo.name}, o atendimento fica com {formatDuracao(servico.duration_minutes)} e não cabe às {esc.hora}.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Botao titulo="Escolher outro horário" onPress={() => router.back()} estilo={{ flex: 1, minHeight: 42 }} />
            <Botao titulo={`Tirar ${ultimo.name}`} tipo="fantasma" onPress={() => tirar(ultimo.id)} estilo={{ flex: 1, minHeight: 42 }} />
          </View>
        </Cartao>
      ) : null}

      {!remarcando && sugestoes.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View>
            <Text style={[e.secao, { color: t.texto }]}>Quer aproveitar e adicionar?</Text>
            <Text style={{ color: t.texto2, fontSize: 13 }}>Entra no mesmo horário, um atrás do outro.</Text>
          </View>
          {sugestoes.map((x) => (
            <Cartao key={x.id} onPress={() => adicionar(x.id)} estilo={e.sugestao}>
              <View style={e.foto}>{x.images?.[0] ? <Image source={{ uri: x.images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={18} color={MARCA.rosa} />}</View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[e.itemNome, { color: t.texto }]} numberOfLines={2}>
                  {x.name}
                </Text>
                <Text style={{ color: t.texto2, fontSize: 13 }}>
                  +{formatDuracao(x.duration_minutes)} · {formatPreco(x.price)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Ionicons name="add" size={18} color={t.acento} />
                <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>Adicionar</Text>
              </View>
            </Cartao>
          ))}
        </View>
      ) : null}

      {!remarcando && (sugVisita.length > 0 || comEspera) ? (
        <View style={{ gap: 10 }}>
          <View>
            <Text style={[e.secao, { color: t.texto }]}>No salão, aproveita e faz também</Text>
            <Text style={{ color: t.texto2, fontSize: 13, lineHeight: 18 }}>Com outra profissional, na sequência do seu horário. Cada uma confirma a parte dela.</Text>
          </View>
          <Caixa marcado={comEspera} onPress={() => setComEspera((v) => !v)} titulo="Aceito esperar um pouco" sub="abre mais horários no mesmo dia" />
          {sugVisita.length === 0 ? (
            <Text style={{ color: t.texto2, fontSize: 13 }}>Ninguém livre na sequência neste dia.</Text>
          ) : (
            sugVisita.map((v) => {
              const hora = String(v.hora_sugerida).slice(0, 5)
              const espera = diffMin(extras.length ? fimDasPartes : fimPrincipal, hora)
              const naSequencia = v.modo === 'logo_depois' || espera <= 0
              return (
                <Cartao key={v.service_id + v.professional_id} onPress={() => juntarParte(v)} estilo={e.sugestao}>
                  <View style={e.foto}>{v.photo_url ? <Image source={{ uri: v.photo_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="sparkles" size={18} color={MARCA.rosa} />}</View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[e.itemNome, { color: t.texto }]} numberOfLines={2}>
                      {v.service_name}
                    </Text>
                    <Text style={{ color: t.texto2, fontSize: 13 }}>
                      com {v.professional_name} · {formatDuracao(v.duration_minutes)} · {formatPreco(v.price)}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name={naSequencia ? 'checkmark' : 'hourglass-outline'} size={13} color={naSequencia ? t.ok : t.aviso} />
                      <Text style={{ color: naSequencia ? t.ok : t.aviso, fontSize: 12.5, fontWeight: '600' }}>{naSequencia ? `às ${hora}, na sequência` : `às ${hora}, espera de ${formatDuracao(espera)}`}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Ionicons name="add" size={18} color={t.acento} />
                    <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>Juntar</Text>
                  </View>
                </Cartao>
              )
            })
          )}
        </View>
      ) : null}

      {!remarcando ? <Entrada rotulo="Observação (opcional)" placeholder="Alguma preferência ou aviso para a profissional?" value={obs} onChangeText={setObs} multiline /> : null}

      {!remarcando && credito ? (
        <Cartao tom="acento">
          <Text style={{ color: t.texto, fontWeight: '800' }}>Você tem {formatPreco(credito.valor_cents / 100)} de crédito aqui</Text>
          <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>
            Do sinal de {credito.de ?? 'um horário'} que você cancelou. Ele entra como sinal deste pedido e você não paga nada agora. Vale até {dataCurta(credito.ate)}.
          </Text>
        </Cartao>
      ) : null}
      {!remarcando && !credito && partesDetalhadas.length === 0 && pagamento && pagamento.modo !== 'nao' ? (
        <Cartao tom={pagamento.modo === 'obrigatorio' || querPagar ? 'acento' : 'normal'}>
          {pagamento.modo === 'obrigatorio' ? (
            <>
              <Text style={{ color: t.texto, fontWeight: '800' }}>Reserva com pagamento</Text>
              <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>
                Aqui o horário só fica guardado depois do PIX: {textoSinal(pagamento.sinal_pct)}, {formatPreco(sinalCents / 100)} agora, pelo app. Você tem 15 minutos para pagar.
              </Text>
            </>
          ) : (
            <Caixa marcado={querPagar} onPress={() => setQuerPagar((v) => !v)} titulo="Pagar agora pelo app" sub={`${textoSinal(pagamento.sinal_pct)}, ${formatPreco(sinalCents / 100)} por PIX. Sem obrigação: dá para pagar no atendimento.`} />
          )}
          {pagamento.modo === 'obrigatorio' || querPagar ? <Text style={{ color: t.texto2, fontSize: 12.5, lineHeight: 17 }}>{textoPolitica(pagamento.politica)}</Text> : null}
        </Cartao>
      ) : null}

      <Cartao>
        <Text style={{ color: t.texto, fontWeight: '800' }}>{remarcando ? 'Seu horário atual continua guardado' : 'A profissional confirma'}</Text>
        <Text style={{ color: t.texto2, fontSize: 13.5, lineHeight: 19 }}>
          {remarcando
            ? 'A profissional recebe o pedido de troca e responde. Enquanto isso, nada muda. Se ela não responder no prazo dela, o sistema decide sozinho.'
            : 'A profissional confirma o pedido e você recebe um aviso aqui no app. Se ela não responder no prazo dela, o sistema decide sozinho.'}
        </Text>
      </Cartao>
    </Tela>
  )
}

function LinhaResumo({ rotulo, valor, destaque = false, cor }: { rotulo: string; valor: string; destaque?: boolean; cor?: string }) {
  const t = useTema()
  return (
    <View style={e.linha}>
      <Text style={{ color: cor ?? t.texto2, flexShrink: 1 }}>{rotulo}</Text>
      <Text style={{ color: cor ?? (destaque ? t.acento : t.texto), fontWeight: '700', textAlign: 'right', flexShrink: 1 }}>{valor}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  secao: { fontSize: 16, fontWeight: '800' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemNome: { fontSize: 14.5, fontWeight: '700' },
  tirar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  parteHora: { fontSize: 14, fontWeight: '800', width: 44 },
  sugestao: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  foto: { width: 44, height: 44, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,45,122,0.08)', alignItems: 'center', justifyContent: 'center' },
})
