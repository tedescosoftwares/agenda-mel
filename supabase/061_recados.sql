-- 061 · Recados: um aviso escrito à mão para muita gente
--
-- A profissional fala com as clientes dela; o salão fala com a
-- carteira e com a equipe; a plataforma fala com todo mundo, com um
-- papel ou com um salão. O recado vira uma notificação por pessoa
-- (notificar), e chega no app e no celular de quem ligou o push.
-- Não vai por WhatsApp nem por e-mail: recado é conversa do app.
--
--   recados                      o histórico (quem mandou, para quem, quantas)
--   publico_do_recado()          quem recebe, dado o público e o filtro
--   contar_publico()             "vai para 42 pessoas, 12 com celular"
--   enviar_recado()              manda; devolve o total
--   meus_recados()               o histórico de quem está logada
--
-- Públicos:
--   profissional  minhas_clientes   quem já marcou com ela ou entrou pelo código dela
--   salão         clientes          a carteira (vínculos abertos)
--                 equipe            profissionais e admins da casa
--   plataforma    todos | so_clientes | profissionais | donas | salao (filtro.salao)

insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values ('recado', false, 'marketing', null)
on conflict (kind) do nothing;
insert into public.email_regras (kind, envia, chamada) values ('recado', false, null)
on conflict (kind) do nothing;

create table if not exists public.recados (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons (id) on delete cascade,
  autor uuid not null references public.profiles (id) on delete cascade,
  publico text not null,
  filtro jsonb not null default '{}'::jsonb,
  titulo text not null,
  corpo text not null,
  url text,
  destinatarios integer not null default 0,
  celulares integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists recados_salao_idx on public.recados (salon_id, criado_em desc);
create index if not exists recados_autor_idx on public.recados (autor, criado_em desc);
alter table public.recados enable row level security;
revoke all on public.recados from anon, authenticated;

-- 1. Quem recebe --------------------------------------------------------------------
create or replace function public.publico_do_recado(publico text, salao uuid, filtro jsonb default '{}'::jsonb)
returns setof uuid
language plpgsql
stable
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  minha uuid;
  alvo uuid;
begin
  filtro := coalesce(filtro, '{}'::jsonb);
  case publico
    when 'minhas_clientes' then
      select p.id into minha from public.professionals p where p.user_id = eu limit 1;
      if minha is null then return; end if;
      return query
        select distinct u from (
          select a.client_id as u from public.appointments a
           where a.professional_id = minha and a.status <> 'cancelado'
          union
          select v.client_id from public.vinculos v
           where v.trazida_por = minha and v.saiu_em is null
        ) q where u is not null and u <> eu;
    when 'clientes' then
      return query
        select v.client_id from public.vinculos v
         where v.salon_id = salao and v.saiu_em is null and v.client_id <> eu;
    when 'equipe' then
      return query
        select distinct u from (
          select p.user_id as u from public.professionals p where p.salon_id = salao and p.active
          union
          select m.user_id from public.salon_members m where m.salon_id = salao
        ) q where u is not null and u <> eu;
    when 'todos' then
      return query select p.id from public.profiles p;
    when 'so_clientes' then
      return query select p.id from public.profiles p where p.role = 'cliente';
    when 'profissionais' then
      return query select p.id from public.profiles p where p.role = 'profissional';
    when 'donas' then
      return query select p.id from public.profiles p where p.role = 'admin';
    when 'salao' then
      alvo := nullif(filtro ->> 'salao', '')::uuid;
      if alvo is null then return; end if;
      return query
        select distinct u from (
          select v.client_id as u from public.vinculos v where v.salon_id = alvo and v.saiu_em is null
          union
          select p.user_id from public.professionals p where p.salon_id = alvo and p.active
          union
          select m.user_id from public.salon_members m where m.salon_id = alvo
        ) q where u is not null;
    else
      raise exception 'Público desconhecido: %', publico;
  end case;
end;
$$;
revoke execute on function public.publico_do_recado(text, uuid, jsonb) from public, anon, authenticated;

-- quem pode falar com esse público?
create or replace function public.pode_mandar_recado(publico text, salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select auth.uid() is not null and case
    when publico = 'minhas_clientes' then exists (select 1 from public.professionals p where p.user_id = auth.uid())
    when publico in ('clientes', 'equipe') then public.is_admin_do_salao(salao)
    when publico in ('todos', 'so_clientes', 'profissionais', 'donas', 'salao') then public.eh_plataforma()
    else false end;
$$;
revoke execute on function public.pode_mandar_recado(text, uuid) from public, anon, authenticated;

-- 2. A prévia -----------------------------------------------------------------------
create or replace function public.contar_publico(publico text, salao uuid default null, filtro jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare pessoas integer; celulares integer;
begin
  if not public.pode_mandar_recado(publico, salao) then
    raise exception 'Você não pode mandar recado para esse público.';
  end if;
  select count(*), count(*) filter (where exists (select 1 from public.push_subscriptions s where s.user_id = q.u))
    into pessoas, celulares
    from public.publico_do_recado(publico, salao, filtro) q(u);
  return jsonb_build_object('pessoas', pessoas, 'celulares', celulares);
end;
$$;
revoke execute on function public.contar_publico(text, uuid, jsonb) from public, anon;
grant execute on function public.contar_publico(text, uuid, jsonb) to authenticated;

-- 3. O envio -------------------------------------------------------------------------
create or replace function public.enviar_recado(
  publico text, titulo text, corpo text,
  url text default null, salao uuid default null, filtro jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  eu uuid := auth.uid();
  novo uuid;
  quem uuid;
  n integer := 0;
  c integer := 0;
begin
  titulo := btrim(coalesce(titulo, ''));
  corpo := btrim(coalesce(corpo, ''));
  url := nullif(btrim(coalesce(url, '')), '');
  if not public.pode_mandar_recado(publico, salao) then
    raise exception 'Você não pode mandar recado para esse público.';
  end if;
  if length(titulo) < 3 or length(titulo) > 80 then
    raise exception 'O título precisa ter entre 3 e 80 letras.';
  end if;
  if length(corpo) > 300 then
    raise exception 'A mensagem pode ter até 300 letras.';
  end if;
  if url is not null and url !~ '^/[a-zA-Z0-9/_?=&.-]*$' then
    raise exception 'O link tem de ser uma tela do app (começa com /).';
  end if;
  if exists (select 1 from public.recados r where r.autor = eu and r.titulo = titulo and r.corpo = corpo
              and r.criado_em > now() - interval '1 hour') then
    raise exception 'Esse mesmo recado já foi enviado há menos de uma hora.';
  end if;

  insert into public.recados (salon_id, autor, publico, filtro, titulo, corpo, url)
  values (case when publico in ('clientes', 'equipe') then salao else null end, eu, publico, coalesce(filtro, '{}'::jsonb), titulo, corpo, url)
  returning id into novo;

  for quem in select u from public.publico_do_recado(publico, salao, filtro) q(u) loop
    perform public.notificar(quem, 'recado', titulo, nullif(corpo, ''), url,
                             jsonb_build_object('recado_id', novo, 'de', eu));
    n := n + 1;
    if exists (select 1 from public.push_subscriptions s where s.user_id = quem) then c := c + 1; end if;
  end loop;

  update public.recados set destinatarios = n, celulares = c where id = novo;
  return jsonb_build_object('id', novo, 'destinatarios', n, 'celulares', c);
end;
$$;
revoke execute on function public.enviar_recado(text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.enviar_recado(text, text, text, text, uuid, jsonb) to authenticated;

-- 4. O histórico ---------------------------------------------------------------------
create or replace function public.meus_recados(salao uuid default null, quantos integer default 30)
returns table (id uuid, publico text, filtro jsonb, titulo text, corpo text, url text,
               destinatarios integer, celulares integer, criado_em timestamptz, autor_nome text)
language sql
stable
security definer set search_path = public
as $$
  select r.id, r.publico, r.filtro, r.titulo, r.corpo, r.url, r.destinatarios, r.celulares, r.criado_em,
         p.full_name
    from public.recados r
    left join public.profiles p on p.id = r.autor
   where case
           when salao is not null then public.is_admin_do_salao(salao) and r.salon_id = salao
           when public.eh_plataforma() then r.salon_id is null and r.publico in ('todos', 'so_clientes', 'profissionais', 'donas', 'salao')
           else r.autor = auth.uid()
         end
   order by r.criado_em desc
   limit greatest(1, least(coalesce(quantos, 30), 200));
$$;
revoke execute on function public.meus_recados(uuid, integer) from public, anon;
grant execute on function public.meus_recados(uuid, integer) to authenticated;
