-- =============================================================
-- Agenda Mel — por que a cliente não recebeu?
--
-- Cole no SQL Editor do Supabase e Run. Não muda nada, só olha.
--
-- Percorre a cadeia inteira, do aceite até o envio, na ordem em que as
-- coisas acontecem. A PRIMEIRA linha errada é a causa — as de baixo
-- descrevem um mundo que não chegou a existir.
--
-- Cada portão está aqui porque enfileirar_whatsapp() pode desistir em
-- silêncio em qualquer um deles, e hoje não há como saber em qual.
-- =============================================================

with ultimo as (
  select ac.appointment_id, ac.resultado, ac.resolvido_em,
         ac.professional_id, ac.salon_id
  from public.aceites ac
  where ac.resultado is not null
  order by ac.resolvido_em desc nulls last
  limit 1
),
ap as (
  select a.*, u.resultado, u.resolvido_em
  from ultimo u join public.appointments a on a.id = u.appointment_id
),
cli as (
  select p.* from public.profiles p
  where p.id = (select client_id from ap)
),
avi as (
  select n.* from public.notifications n
  where n.user_id = (select id from cli)
    and n.kind in ('pedido_aceito', 'pedido_recusado')
  order by n.created_at desc limit 1
),
lin as (
  select o.* from public.message_outbox o
  where o.notification_id = (select id from avi)
  limit 1
)

select 1 as n, 'último aceite resolvido' as etapa,
       coalesce((select resultado || ' em ' || to_char(resolvido_em, 'DD/MM HH24:MI')
                   from ultimo), 'NENHUM — a Mel nunca respondeu um pedido') as resposta
union all
select 2, 'o agendamento ficou como',
       coalesce((select status from ap), '—')
union all
select 3, 'a cliente é',
       coalesce((select coalesce(full_name, '(sem nome)') from cli), '—')
union all
-- os quatro portões que fazem enfileirar_whatsapp() desistir calada
select 4, 'PORTÃO 1: ela tem telefone?',
       coalesce((select coalesce(public.telefone_e164(phone), 'NÃO — ' ||
                                 coalesce(phone, '(vazio)') || ' não vira E.164')
                   from cli), '—')
union all
select 5, 'PORTÃO 2: ela aceita avisos?',
       coalesce((select case when accepts_reminders then 'sim'
                             else 'NÃO — accepts_reminders está falso' end
                   from cli), '—')
union all
select 6, 'PORTÃO 3: a regra manda?',
       coalesce((select case when envia then 'sim, e ' ||
                                  case when respeita_silencio
                                       then 'RESPEITA silêncio' else 'sai na hora' end
                             else 'NÃO — envia está falso' end
                   from public.whatsapp_regras where kind = 'pedido_aceito'),
                'a regra pedido_aceito não existe')
union all
select 7, 'PORTÃO 4: o canal está ativo?',
       coalesce((select canal || ', ativo=' || ativo || ', silêncio ' ||
                        silencio_inicio || '-' || silencio_fim
                   from public.whatsapp_channels
                  where salon_id = (select salon_id from ultimo)),
                'NÃO EXISTE canal para esse salão')
union all
select 8, 'nasceu o aviso no app?',
       coalesce((select kind || ' em ' || to_char(created_at, 'DD/MM HH24:MI') from avi),
                'NÃO — resolver_aceite() não chegou a notificar')
union all
select 9, 'e virou linha na fila?',
       coalesce((select 'sim, ' || status ||
                        case when liberado_em > now()
                             then ' (presa até ' || to_char(liberado_em, 'DD/MM HH24:MI') || ')'
                             else ' (liberada)' end ||
                        ', tentativas=' || tentativas ||
                        coalesce(', erro: ' || erro, '')
                   from lin),
                'NÃO — passou por algum portão acima')
union all
-- e agora a fila como um todo: ela anda?
select 10, 'a fila JÁ enviou alguma coisa?',
       coalesce((select 'sim, a última saiu ' || to_char(max(enviado_em), 'DD/MM HH24:MI')
                   from public.message_outbox where enviado_em is not null),
                'NUNCA — nenhuma mensagem saiu pela fila desde sempre')
union all
select 11, 'como está a fila hoje',
       coalesce((select string_agg(s.linha, '  |  ')
                   from (select status || '=' || count(*) as linha
                           from public.message_outbox group by status order by status) s),
                'fila vazia')
union all
select 12, 'travadas em enviando',
       coalesce((select count(*)::text || ' há mais de 5 min (um envio que morreu no meio)'
                   from public.message_outbox
                  where status = 'enviando' and criado_em < now() - interval '5 minutes'),
                '0')
union all
select 13, 'desistiram (4 tentativas)',
       coalesce((select string_agg(distinct coalesce(erro, 'sem erro anotado'), ' | ')
                   from public.message_outbox where tentativas >= 4),
                'nenhuma')
order by n;
