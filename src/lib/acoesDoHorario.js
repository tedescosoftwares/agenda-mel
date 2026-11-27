import { supabase } from './supabase'
import { formatarCents } from './indicacao'

// 4.0: as ações sobre um horário, num lugar só (o quadro da Agenda no computador, a lista do celular e a folha de
// ações). As mesmas regras da AgendaDia: concluir oferece o crédito de indicação; não veio e cancelar pedem
// confirmação; pedido pendente passa pela casa_decide (avisa a cliente e completa a troca); remarcar usa a
// mover_horario (cancela o antigo e avisa o novo). Cada uma devolve { ok, erro } — ok false sem erro é "desistiu".
// O horário pode vir da pdv_dia (cliente, price_cents) ou da tabela crua (profiles.full_name, services.price).

const nome = (a) => a.cliente || a.profiles?.full_name || a.guest_name || 'A cliente'
const hora = (a) => String(a.start_time ?? '').slice(0, 5)
const precoCents = (a) => (a.price_cents != null ? Number(a.price_cents) : Math.round(Number(a.services?.price ?? 0) * 100))
const desistiu = { ok: false }
const falhou = (e) => ({ ok: false, erro: e?.message ?? String(e) })

// o horário marcado, no fuso do aparelho (dia + start_time, sem Z)
export const inicioDe = (a, dia) => new Date(`${dia ?? a.date}T${String(a.start_time).slice(0, 8)}`).getTime()
export const fimDe = (a, dia) => new Date(`${dia ?? a.date}T${String(a.end_time).slice(0, 8)}`).getTime()
// "Concluir" só depois que o horário começou (o banco também recusa antes)
export const jaComecou = (a, dia, agora = Date.now()) => agora >= inicioDe(a, dia)
// "Não veio" só depois do horário + a tolerância
export const passouDaTolerancia = (a, dia, toleranciaMin = 15, agora = Date.now()) => agora > inicioDe(a, dia) + toleranciaMin * 60000
export const atendendoAgora = (a, dia, agora = Date.now()) => a.status === 'confirmado' && agora >= inicioDe(a, dia) && agora < fimDe(a, dia)
export const ativo = (a) => a.status === 'pendente' || a.status === 'confirmado'

export async function concluirHorario(a, confirmar) {
  try {
    if (a.client_id) {
      const { data: saldo } = await supabase.rpc('saldo_creditos', { cliente: a.client_id })
      if (Number(saldo) > 0) {
        const preco = precoCents(a)
        const maximo = Math.min(Number(saldo), preco || Number(saldo))
        const usar = await confirmar({
          titulo: 'Ela tem crédito',
          texto: `${nome(a)} tem ${formatarCents(Number(saldo))} de crédito. Abater ${formatarCents(maximo)} neste atendimento?`,
          ok: 'Abater', cancelar: 'Cobrar tudo',
        })
        if (usar) {
          const { error } = await supabase.rpc('usar_credito', { appt_id: a.id, valor_cents: maximo })
          if (error) return { ok: false, erro: 'Erro ao abater o crédito: ' + error.message }
        }
      }
    }
    const { error } = await supabase.from('appointments').update({ status: 'concluido' }).eq('id', a.id)
    return error ? falhou(error) : { ok: true }
  } catch (e) { return falhou(e) }
}

export async function marcarFalta(a, confirmar) {
  const ok = await confirmar({
    titulo: 'Ela não veio?',
    texto: `Marcar que ${nome(a)} não veio? O horário volta a ficar livre e quem está na lista de espera é avisada.`,
    ok: 'Marcar falta', perigo: true,
  })
  if (!ok) return desistiu
  const { error } = await supabase.from('appointments').update({ status: 'faltou' }).eq('id', a.id)
  return error ? falhou(error) : { ok: true }
}

export async function cancelarHorario(a, confirmar) {
  const ok = await confirmar({
    titulo: 'Cancelar este horário?',
    texto: `${nome(a)}, às ${hora(a)}. O horário volta a ficar livre e ela é avisada.`,
    ok: 'Cancelar horário', perigo: true,
  })
  if (!ok) return desistiu
  const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', a.id)
  return error ? falhou(error) : { ok: true }
}

// a casa decide um pedido pendente: confirma ou recusa (a cliente é avisada; troca completa)
export async function decidirPedido(a, aceitou, confirmar) {
  if (!aceitou) {
    const ok = await confirmar({
      titulo: a.remarca_de ? 'Recusar a troca?' : 'Recusar este pedido?',
      texto: a.remarca_de
        ? `${nome(a)} pediu para trocar para as ${hora(a)}. O horário de antes continua valendo e ela é avisada.`
        : `${nome(a)}, às ${hora(a)}. O horário volta a ficar livre e ela recebe o aviso para escolher outro.`,
      ok: 'Recusar', perigo: true,
    })
    if (!ok) return desistiu
  }
  const { data, error } = await supabase.rpc('casa_decide', { appt: a.id, aceitou })
  if (error) return falhou(error)
  if (data?.ok === false) return { ok: false, erro: data.motivo ? 'Não deu: ' + data.motivo + '.' : 'Não deu para decidir esse pedido.' }
  return { ok: true }
}

export async function perdoarFalta(a) {
  const { data, error } = await supabase.rpc('perdoar_falta', { appt_id: a.id })
  if (error) return falhou(error)
  if (data === 'ocupado') return { ok: false, erro: 'O horário já foi ocupado por outra pessoa: não dá para voltar atrás.' }
  return { ok: true }
}

// mover para outro dia, hora ou profissional (o antigo é cancelado). 4.30: quem move escolhe se avisa a cliente e a
// profissional. O "avisar" só vai na chamada quando é falso, para o banco de antes da 271 continuar aceitando.
export const SEM_271 = 'Para mover sem avisar, o banco precisa da atualização 271 (opção B do .bat). Nada foi movido.'
export const pedeAviso = { rotulo: 'Avisar a cliente e a profissional', nota: 'Desmarque se foi só um acerto e ninguém precisa receber notificação.' }
export async function moverNoBanco(a, { dia, hora: novaHora, prof, avisar = true }) {
  const r = await supabase.rpc('mover_horario', { appt: a.id, nova_data: dia, nova_hora: novaHora, nova_prof: prof, ...(avisar ? {} : { avisar: false }) })
  if (r.error && !avisar && (r.error.code === 'PGRST202' || /avisar|schema cache|does not exist/i.test(r.error.message ?? ''))) return { data: null, error: { message: SEM_271 } }
  return r
}
export async function remarcarHorario(a, { dia, hora: novaHora, prof, avisar = true }) {
  const { data, error } = await moverNoBanco(a, { dia, hora: novaHora, prof, avisar })
  if (error) return falhou(error)
  if (data && data.ok === false) {
    return { ok: false, erro: data.motivo === 'ocupado' ? 'Esse horário já está ocupado.' : data.motivo === 'nao_faz' ? `${data.profissional ?? 'Essa profissional'} não faz esse serviço.` : 'Não deu para mover.' }
  }
  return { ok: true }
}

// o link do WhatsApp da cliente (null sem telefone)
export function zapDaCliente(a) {
  const d = String(a.telefone ?? a.profiles?.phone ?? a.guest_phone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return d.length >= 10 ? `https://wa.me/55${d}` : null
}
