// Drena a fila de saída.
//
// Puxa um lote de mensagens que já podem sair, manda pelo canal de cada
// salão, e escreve o resultado de volta. Roda de dois jeitos:
//
//   • pelo pg_cron, de minuto em minuto (veja o SQL no fim do 023)
//   • na unha:  curl -X POST .../functions/v1/enviar-whatsapp \
//                    -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// É idempotente por construção: puxar_da_fila() marca as linhas como
// 'enviando' na mesma transação em que as devolve, com skip locked, e
// duas execuções ao mesmo tempo nunca pegam a mesma mensagem.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPor } from '../_shared/canais.ts'

const LOTE = 20

Deno.serve(async (req) => {
  // só quem tem a chave de serviço drena a fila
  const auth = req.headers.get('Authorization') ?? ''
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!chave || auth !== `Bearer ${chave}`) {
    return new Response(JSON.stringify({ erro: 'não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', chave, {
    auth: { persistSession: false },
  })

  // Pedido de horário com prazo vencido vira resolvido aqui. Enquanto o
  // pg_cron não existe, este é o único ponto que roda de tempos em
  // tempos — e deixar a cliente esperando resposta de um prazo que já
  // passou é o pior dos mundos. A falha não derruba o envio.
  try {
    const { data: vencidos } = await db.rpc('resolver_aceites_vencidos')
    if (vencidos) console.log(`aceites vencidos resolvidos: ${vencidos}`)
  } catch (e) {
    console.error('falha ao resolver aceites vencidos', e)
  }

  const { data: fila, error } = await db.rpc('puxar_da_fila', { quantas: LOTE })
  if (error) {
    return new Response(JSON.stringify({ erro: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let enviadas = 0
  let falhas = 0

  for (const m of fila ?? []) {
    const r = await enviarPor(m.canal, {
      telefone: m.telefone,
      titulo: m.titulo,
      corpo: m.corpo,
      botoes: m.botoes,
      estilo: m.estilo_botao,
      identificador: m.identificador,
    })

    if (r.ok) {
      await db.rpc('confirmar_envio', { mensagem_id: m.id, id_provedor: r.providerId })
      enviadas++
    } else {
      falhas++
      // erro que não melhora tentando de novo desiste na hora;
      // o resto volta para a fila com espera crescente
      const fn = r.permanente ? 'falhar_de_vez' : 'devolver_para_fila'
      await db.rpc(fn, { mensagem_id: m.id, motivo: r.erro })
    }

    // ninguém dispara 20 mensagens no mesmo segundo sem parecer robô
    await new Promise((r) => setTimeout(r, 900))
  }

  return new Response(
    JSON.stringify({ puxadas: fila?.length ?? 0, enviadas, falhas }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
