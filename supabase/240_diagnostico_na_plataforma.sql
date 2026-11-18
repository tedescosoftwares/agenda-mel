-- 240 · O diagnóstico técnico do WhatsApp vai para a Plataforma (3.96)
--
-- A área WhatsApp do salão fica com o que a dona usa (Assistente, Pedidos de horário, Mensagens). O diagnóstico
-- técnico (o canal, as regras, o relógio, a fila crua, o que a IA leu) passa a ser da Plataforma, na página de cada
-- salão. As três consultas, que só respondiam a quem administra o salão, passam a responder também à Plataforma.

create or replace function public.diagnostico_whatsapp(salao uuid)
returns table (
  item text,
  situacao text,
  detalhe text
)
language plpgsql
stable
security definer set search_path = public
as $fn$
begin
  -- SECURITY DEFINER sem esta linha entrega a configuração de qualquer
  -- salão para qualquer pessoa logada. A RLS não protege o que roda como
  -- dono; a trava tem que ser explícita.
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    return;
  end if;

  return query
  with c as (
    select * from public.whatsapp_channels where salon_id = salao
  )
  select 'Canal do salão',
         case when (select count(*) from c) = 0 then 'falta'
              when (select ativo from c) then 'ok' else 'desligado' end,
         coalesce((select 'canal ' || canal ||
                   coalesce(' · ' || numero_exibicao, '') from c),
                  'nenhum canal cadastrado')
  union all
  select 'Endereço público do app',
         case when (select app_url from public.salons where id = salao) is null
              then 'falta' else 'ok' end,
         coalesce((select app_url from public.salons where id = salao),
                  'sem isso as mensagens saem sem o link da agenda')
  union all
  select 'Regra novo_agendamento',
         case when (select envia from public.whatsapp_regras
                     where kind = 'novo_agendamento') then 'ok' else 'desligado' end,
         'avisa a profissional quando alguém marca'
  union all
  select 'Profissionais que recebem',
         case when count(*) filter (where tem_tudo) = 0 then 'falta'
              when count(*) filter (where not tem_tudo) > 0 then 'parcial'
              else 'ok' end,
         count(*) filter (where tem_tudo) || ' de ' || count(*) ||
         ' com conta, telefone e avisos ligados'
  from (
    select p.id,
           (p.user_id is not null
            and public.telefone_e164(pf.phone) is not null
            and coalesce(pf.accepts_reminders, false)) as tem_tudo
    from public.professionals p
    left join public.profiles pf on pf.id = p.user_id
    where p.salon_id = salao and p.active
  ) x
  union all
  select 'Telefones repetidos',
         case when count(*) = 0 then 'ok' else 'atenção' end,
         case when count(*) = 0 then 'cada telefone pertence a uma pessoa só'
              else 'o mesmo número está em ' || count(*) ||
                   ' perfis; a resposta "1" no WhatsApp vira ambígua' end
  from (
    select public.telefone_e164(phone) t
    from public.profiles where phone is not null
    group by 1 having count(*) > 1
  ) y
  union all
  select 'Fila de hoje',
         'ok',
         count(*) filter (where status = 'na_fila') || ' esperando · ' ||
         count(*) filter (where status in ('enviado','entregue','lido')) || ' enviadas · ' ||
         count(*) filter (where status = 'falhou') || ' falharam'
  from public.message_outbox
  where salon_id = salao
    and (criado_em at time zone 'America/Sao_Paulo')::date
        = (public.agora_local())::date;
end;
$fn$;
revoke execute on function public.diagnostico_whatsapp(uuid) from public, anon;
grant execute on function public.diagnostico_whatsapp(uuid) to authenticated;

create or replace function public.fila_do_salao(salao uuid, quantas integer default 30)
returns table (
  id uuid,
  quando timestamptz,
  para text,
  telefone text,
  tipo text,
  status text,
  corpo text,
  link_wa text
)
language sql
stable
security definer set search_path = public
as $$
  select o.id,
         coalesce(o.enviado_em, o.criado_em),
         coalesce(nullif(btrim(pf.full_name), ''), 'sem nome'),
         o.telefone,
         o.kind,
         o.status,
         o.corpo,
         'https://wa.me/' || o.telefone || '?text=' || public.url_encode_simples(o.corpo)
  from public.message_outbox o
  left join public.profiles pf on pf.id = o.client_id
  where o.salon_id = salao
    and (public.is_admin_do_salao(salao) or public.eh_plataforma())
  order by coalesce(o.enviado_em, o.criado_em) desc
  limit greatest(1, least(coalesce(quantas, 30), 200));
$$;
revoke execute on function public.fila_do_salao(uuid, integer) from public, anon;
grant execute on function public.fila_do_salao(uuid, integer) to authenticated;

create or replace function public.leituras_recentes(salao uuid, quantas integer default 20)
returns table (
  quando timestamptz,
  telefone text,
  texto text,
  entendeu text,
  via text,
  intencao text
)
language sql
stable
security definer set search_path = public
as $$
  select i.recebido_em, i.telefone, i.texto, i.acao, i.via, i.intencao_ia
  from public.whatsapp_inbox i
  where (public.is_admin_do_salao(salao) or public.eh_plataforma())
    and (
      i.client_id in (
        select a.client_id from public.appointments a where a.salon_id = salao
      )
      or exists (
        select 1 from public.message_outbox o
        where o.telefone = i.telefone and o.salon_id = salao
      )
      or i.via = 'ia'
    )
  order by i.recebido_em desc
  limit greatest(1, least(coalesce(quantas, 20), 100));
$$;
revoke execute on function public.leituras_recentes(uuid, integer) from public, anon;
grant execute on function public.leituras_recentes(uuid, integer) to authenticated;
