-- 076 · A ficha da cliente: faltas, cancelamentos e remarcações
--
-- Falta, cancelamento e remarcação passam a ser medidos por cliente.
-- A cliente nunca vê isso; a profissional, a dona do salão e a
-- plataforma veem, na hora de aceitar um pedido e na lista de
-- clientes. Nada desconta da cliente por enquanto: é registro.
--
--   appointments.cancelado_por / cancelado_em / faltou_em   quem e quando (gatilho)
--   ficha_da_cliente(cliente, salao)   os números de uma cliente
--   clientes_do_salao / meus_pedidos / plataforma_pessoas   ganham as colunas
--   plataforma_confiabilidade(dias)    o retrato do MIMO inteiro
--   lembrar_fechar_dia()               no fim do expediente, "quem veio hoje?"
--                                      para a profissional (push fechar_dia)

alter table public.appointments add column if not exists cancelado_por text;
alter table public.appointments add column if not exists cancelado_em timestamptz;
alter table public.appointments add column if not exists faltou_em timestamptz;

create or replace function public.marca_quem_cancelou()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    new.cancelado_por := coalesce(new.cancelado_por, public.quem_age_e(new));
    new.cancelado_em := coalesce(new.cancelado_em, now());
  end if;
  if new.status = 'faltou' and old.status is distinct from 'faltou' then
    new.faltou_em := now();
  end if;
  if new.status not in ('faltou') and old.status = 'faltou' then
    new.faltou_em := null;                      -- falta perdoada
  end if;
  return new;
end;
$$;
drop trigger if exists tg_aa_marca_quem_cancelou on public.appointments;
create trigger tg_aa_marca_quem_cancelou
  before update of status on public.appointments
  for each row execute function public.marca_quem_cancelou();

-- cancelamento "tardio": a cliente cancelou com menos de 24 h
create or replace function public.cancelou_tarde(a public.appointments)
returns boolean
language sql
immutable
as $$
  select a.status = 'cancelado' and a.cancelado_por = 'cliente'
     and a.cancelado_em is not null
     and (a.cancelado_em at time zone 'America/Sao_Paulo') > (a.date + a.start_time) - interval '24 hours';
$$;

-- quem pode ver a ficha: a plataforma (qualquer salão, ou geral), a dona
-- do salão, e a profissional que já atendeu ou vai atender essa cliente
create or replace function public.pode_ver_ficha(cliente uuid, salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.eh_plataforma()
      or (salao is not null and public.is_admin_do_salao(salao))
      or exists (select 1 from public.appointments a join public.professionals p on p.id = a.professional_id
                  where a.client_id = cliente and p.user_id = auth.uid()
                    and (salao is null or a.salon_id = salao));
$$;
revoke execute on function public.pode_ver_ficha(uuid, uuid) from public, anon, authenticated;

create or replace function public.ficha_da_cliente(cliente uuid, salao uuid default null)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when public.pode_ver_ficha(cliente, salao) then jsonb_build_object(
    'concluidos', count(*) filter (where a.status = 'concluido'),
    'faltas', count(*) filter (where a.status = 'faltou'),
    'cancelamentos', count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente'),
    'cancelamentos_tardios', count(*) filter (where public.cancelou_tarde(a)),
    'remarcacoes', count(*) filter (where a.remarca_de is not null),
    'ultima_visita', max(a.date) filter (where a.status = 'concluido'),
    'primeira_visita', min(a.date) filter (where a.status = 'concluido'),
    'ultima_falta', max(a.date) filter (where a.status = 'faltou'))
  end
  from public.appointments a
  where a.client_id = cliente and (salao is null or a.salon_id = salao);
$$;
revoke execute on function public.ficha_da_cliente(uuid, uuid) from public, anon;
grant execute on function public.ficha_da_cliente(uuid, uuid) to authenticated;

-- ---- as listas ganham as colunas ------------------------------------------
drop function if exists public.clientes_do_salao(uuid);
create function public.clientes_do_salao(salao uuid)
returns table (
  client_id uuid, nome text, telefone text, entrou_em timestamptz, como text,
  trazida_por text, trazida_por_ativa boolean, servico_de_entrada text, com_quem text,
  atendimentos integer, ultima_visita date,
  faltas integer, cancelamentos integer, cancelamentos_tardios integer, remarcacoes integer
)
language sql
stable
security definer set search_path = public
as $$
  select v.client_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Sem nome'),
         pf.phone,
         v.criado_em,
         v.como,
         tp.name,
         coalesce(tp.active, false),
         (select coalesce(a.service_name, sv.name)
          from public.appointments a left join public.services sv on sv.id = a.service_id
          where a.client_id = v.client_id and a.salon_id = salao and a.status <> 'cancelado'
          order by a.date, a.start_time limit 1),
         (select p2.name
          from public.appointments a join public.professionals p2 on p2.id = a.professional_id
          where a.client_id = v.client_id and a.salon_id = salao and a.status = 'concluido'
          group by p2.name order by count(*) desc, max(a.date) desc limit 1),
         f.concluidos, f.ultima_visita, f.faltas, f.cancelamentos, f.tardios, f.remarcacoes
  from public.vinculos v
  join public.profiles pf on pf.id = v.client_id
  left join public.professionals tp on tp.id = v.trazida_por
  cross join lateral (
    select count(*) filter (where a.status = 'concluido')::integer as concluidos,
           max(a.date) filter (where a.status = 'concluido') as ultima_visita,
           count(*) filter (where a.status = 'faltou')::integer as faltas,
           count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where public.cancelou_tarde(a))::integer as tardios,
           count(*) filter (where a.remarca_de is not null)::integer as remarcacoes
    from public.appointments a where a.client_id = v.client_id and a.salon_id = salao
  ) f
  where v.salon_id = salao and v.saiu_em is null
    and public.is_admin_do_salao(salao)
  order by v.criado_em desc;
$$;
revoke execute on function public.clientes_do_salao(uuid) from public, anon;
grant execute on function public.clientes_do_salao(uuid) to authenticated;

drop function if exists public.meus_pedidos();
create function public.meus_pedidos()
returns table (
  appointment_id uuid, cliente text, servico text, quando text, faltam_min integer,
  remarcacao boolean, antes text,
  atendimentos integer, faltas integer, cancelamentos integer, remarcacoes integer
)
language sql
stable
security definer set search_path = public
as $$
  select ac.appointment_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         greatest(0, extract(epoch from (ac.expira_em - now()))/60)::integer,
         a.remarca_de is not null,
         case when o.id is not null
              then public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') end,
         f.concluidos, f.faltas, f.cancelamentos, f.remarcacoes
  from public.aceites ac
  join public.appointments a on a.id = ac.appointment_id
  left join public.appointments o on o.id = a.remarca_de
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  cross join lateral (
    select count(*) filter (where h.status = 'concluido')::integer as concluidos,
           count(*) filter (where h.status = 'faltou')::integer as faltas,
           count(*) filter (where h.status = 'cancelado' and h.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where h.remarca_de is not null and h.id <> a.id)::integer as remarcacoes
    from public.appointments h where h.client_id = a.client_id and h.salon_id = ac.salon_id
  ) f
  where ac.resultado is null
    and (public.is_professional(ac.professional_id)
         or public.is_admin_do_salao(ac.salon_id))
  order by ac.expira_em;
$$;
revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;

drop function if exists public.plataforma_pessoas(text, integer);
create function public.plataforma_pessoas(busca text default null, quantas integer default 100)
returns table (
  id uuid, nome text, email text, telefone text, papel text, desde date,
  saloes text, vinculos integer, atendimentos integer, ultimo_acesso timestamptz,
  faltas integer, cancelamentos integer, remarcacoes integer
)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.full_name, u.email, p.phone, p.role, p.created_at::date,
         (select string_agg(distinct s.name, ', ')
          from public.salon_members m join public.salons s on s.id = m.salon_id where m.user_id = p.id),
         (select count(*)::integer from public.vinculos v where v.client_id = p.id and v.saiu_em is null),
         f.concluidos,
         (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz,
         f.faltas, f.cancelamentos, f.remarcacoes
  from public.profiles p
  left join auth.users u on u.id = p.id
  cross join lateral (
    select count(*) filter (where a.status = 'concluido')::integer as concluidos,
           count(*) filter (where a.status = 'faltou')::integer as faltas,
           count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where a.remarca_de is not null)::integer as remarcacoes
    from public.appointments a where a.client_id = p.id
  ) f
  where public.eh_plataforma()
    and (busca is null or btrim(busca) = ''
         or p.full_name ilike '%' || btrim(busca) || '%'
         or u.email ilike '%' || btrim(busca) || '%'
         or p.phone ilike '%' || btrim(busca) || '%')
  order by p.created_at desc
  limit greatest(1, least(coalesce(quantas, 100), 500));
$$;
revoke execute on function public.plataforma_pessoas(text, integer) from public, anon;
grant execute on function public.plataforma_pessoas(text, integer) to authenticated;

-- o retrato do MIMO: quantas faltas, cancelamentos e remarcações nos últimos dias
create or replace function public.plataforma_confiabilidade(dias integer default 30)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with base as (
    select a.* from public.appointments a
    where a.date >= current_date - greatest(1, coalesce(dias, 30)) and a.date <= current_date
  )
  select case when public.eh_plataforma() then jsonb_build_object(
    'dias', greatest(1, coalesce(dias, 30)),
    'concluidos', (select count(*) from base where status = 'concluido'),
    'faltas', (select count(*) from base where status = 'faltou'),
    'cancelamentos', (select count(*) from base where status = 'cancelado' and cancelado_por = 'cliente'),
    'cancelamentos_tardios', (select count(*) from base b where public.cancelou_tarde(b)),
    'cancelamentos_da_casa', (select count(*) from base where status = 'cancelado' and cancelado_por in ('profissional', 'salao')),
    'remarcacoes', (select count(*) from base where remarca_de is not null),
    'faltosas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.client_id, 'nome', x.nome, 'faltas', x.faltas, 'salao', x.salao) order by x.faltas desc), '[]'::jsonb)
                 from (select b.client_id, coalesce(p.full_name, 'Sem nome') as nome, count(*) as faltas,
                              (select s.name from public.salons s where s.id = max(b.salon_id::text)::uuid) as salao
                       from base b join public.profiles p on p.id = b.client_id
                       where b.status = 'faltou' group by b.client_id, p.full_name
                       order by count(*) desc limit 8) x))
  end;
$$;
revoke execute on function public.plataforma_confiabilidade(integer) from public, anon;
grant execute on function public.plataforma_confiabilidade(integer) to authenticated;

-- ---- fim do expediente: "quem veio hoje?" -----------------------------------
create table if not exists public.fechamentos_lembrados (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  dia date not null,
  lembrado_em timestamptz not null default now(),
  primary key (professional_id, dia)
);
alter table public.fechamentos_lembrados enable row level security;
revoke all on public.fechamentos_lembrados from anon, authenticated;

-- 30 min depois do último horário do dia, se sobrou atendimento confirmado
-- sem baixa, a profissional recebe um push com a lista. Uma vez por dia.
create or replace function public.lembrar_fechar_dia()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; agora timestamp := public.agora_local(); hoje date := public.agora_local()::date;
begin
  for r in
    select p.id as professional_id, p.user_id, p.name,
           count(*) as quantos, max(a.end_time) as ultimo
    from public.appointments a
    join public.professionals p on p.id = a.professional_id
    where a.date = hoje and a.status = 'confirmado' and p.user_id is not null
      and not exists (select 1 from public.fechamentos_lembrados f where f.professional_id = p.id and f.dia = hoje)
    group by p.id, p.user_id, p.name
    having (hoje + max(a.end_time)) + interval '30 minutes' < agora
  loop
    insert into public.fechamentos_lembrados (professional_id, dia) values (r.professional_id, hoje) on conflict do nothing;
    perform public.notificar(r.user_id, 'fechar_dia', 'Como foi hoje?',
      r.quantos || case when r.quantos = 1 then ' atendimento' else ' atendimentos' end
        || ' sem baixa. Confira quem veio e marque quem não veio; em 3 horas o resto conclui sozinho.',
      '/pro/agenda', jsonb_build_object('dia', hoje, 'quantos', r.quantos));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.lembrar_fechar_dia() from public, anon, authenticated;

insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.fechar_dia', 'push', 'Fechar o dia', 'Fim do expediente com atendimento sem baixa: a profissional confere quem veio.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 830,
  '{"titulo":"Como foi hoje?","texto":"3 atendimentos sem baixa. Confira quem veio e marque quem não veio; em 3 horas o resto conclui sozinho."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, padrao = excluded.padrao, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('fechar_dia', true) on conflict (kind) do nothing;

create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  concluidos integer := 0;
  fechamentos integer := 0;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;
