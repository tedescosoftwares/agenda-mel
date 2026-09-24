-- 119: a equipe é configurada pelo salão. A dona adiciona a profissional
-- com tudo pronto (vínculo, serviços, horários, repasse, permissões) e a
-- profissional só ativa o acesso: abre o link, confirma o WhatsApp, cria a
-- senha e encontra a agenda montada. Aqui entram:
--   1. a situação da profissional como máquina de estados
--      (rascunho → configurada → ativa → inativa), mantida em par com
--      `active`, que o resto do banco já usa;
--   2. o vínculo operacional (preset), as permissões mínimas que o app
--      respeita, a cota de repasse própria e as exceções por serviço;
--   3. preço e duração por profissional, sem duplicar o serviço;
--   4. o token de acesso, guardado fora da tabela pública;
--   5. horário herdado do salão que acompanha mudanças;
--   6. o link genérico da equipe vira coleta de dados (rascunho);
--   7. o que o painel mostra depois: primeiros passos e equipe pendente.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------
alter table public.professionals add column if not exists vinculo text;
alter table public.professionals add column if not exists situacao text not null default 'configurada';
alter table public.professionals add column if not exists permissoes jsonb not null default '{}'::jsonb;
alter table public.professionals add column if not exists cota_pct numeric(5,2);
alter table public.professionals add column if not exists cota_excecoes jsonb not null default '[]'::jsonb;
alter table public.professionals add column if not exists usa_horario_salao boolean not null default false;
alter table public.professionals add column if not exists email text;
alter table public.professionals add column if not exists configurada_em timestamptz;
alter table public.professionals add column if not exists ativada_em timestamptz;
do $$ begin
  alter table public.professionals add constraint professionals_vinculo_conhecido
    check (vinculo is null or vinculo in ('parceira', 'funcionaria', 'autonoma', 'aluga', 'temporaria'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.professionals add constraint professionals_situacao_conhecida
    check (situacao in ('rascunho', 'configurada', 'ativa', 'inativa'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.professionals add constraint professionals_cota_razoavel
    check (cota_pct is null or (cota_pct >= 0 and cota_pct <= 100));
exception when duplicate_object then null; end $$;

-- quem já existe: com conta está ativa; sem conta, configurada (esperando
-- entrar); desligada é inativa. E as permissões de quem já existe são o
-- que o app já deixava fazer — nada muda para elas.
update public.professionals
set situacao = case when not active then 'inativa' when user_id is not null then 'ativa' else 'configurada' end
where situacao = 'configurada' and (not active or user_id is not null);
update public.professionals
set permissoes = '{"confirmar": true, "bloquear": true, "clientes": "salao", "servicos": true, "ver_repasse": true}'::jsonb
where permissoes = '{}'::jsonb;

-- preço e duração por profissional: vazio = o do salão
alter table public.professional_services add column if not exists preco_cents integer;
alter table public.professional_services add column if not exists duracao_minutos integer;
do $$ begin
  alter table public.professional_services add constraint professional_services_preco_razoavel check (preco_cents is null or preco_cents >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.professional_services add constraint professional_services_duracao_razoavel check (duracao_minutos is null or duracao_minutos between 5 and 720);
exception when duplicate_object then null; end $$;
drop policy if exists "admin ou dona ajusta servicos" on public.professional_services;
create policy "admin ou dona ajusta servicos"
  on public.professional_services for update
  to authenticated
  using (public.is_professional(professional_id) or public.is_admin_do_salao((select p.salon_id from public.professionals p where p.id = professional_id)))
  with check (public.is_professional(professional_id) or public.is_admin_do_salao((select p.salon_id from public.professionals p where p.id = professional_id)));

-- "a partir de": o preço do serviço é o mínimo, o final depende do caso
alter table public.services add column if not exists a_partir boolean not null default false;

-- o que a dona já fez depois do onboarding (agendamento teste, QR baixado…)
alter table public.salons add column if not exists primeiros_passos jsonb not null default '{}'::jsonb;
grant select (primeiros_passos) on public.salons to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A situação anda junto com `active`
-- ---------------------------------------------------------------------------
create or replace function public.professionals_situacao()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.situacao = 'rascunho' then new.active := false;
    elsif not new.active then new.situacao := 'inativa';
    elsif new.user_id is not null then new.situacao := 'ativa';
    else new.situacao := 'configurada';
    end if;
  else
    if new.situacao is distinct from old.situacao then
      new.active := new.situacao in ('configurada', 'ativa');
    elsif new.active is distinct from old.active then
      new.situacao := case when not new.active then 'inativa' when new.user_id is not null then 'ativa' else 'configurada' end;
    end if;
    -- estava esperando entrar e a conta chegou: está ativa
    if new.situacao = 'configurada' and new.user_id is not null then new.situacao := 'ativa'; new.active := true; end if;
  end if;
  if new.situacao in ('configurada', 'ativa') then new.configurada_em := coalesce(new.configurada_em, now()); end if;
  if new.situacao = 'ativa' then new.ativada_em := coalesce(new.ativada_em, now()); end if;
  return new;
end;
$$;
drop trigger if exists professionals_situacao_tg on public.professionals;
create trigger professionals_situacao_tg before insert or update on public.professionals
  for each row execute function public.professionals_situacao();

-- ---------------------------------------------------------------------------
-- 3. Permissões que o app respeita
-- ---------------------------------------------------------------------------
-- chaves: confirmar (aceitar pedidos), bloquear (horários próprios), servicos
-- (escolher o que faz), ver_repasse, e clientes = 'proprias' | 'salao'. A
-- chave que não está gravada vale como sempre valeu (liberada). A dona do
-- negócio nunca se restringe.
create or replace function public.pode(prof uuid, chave text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when p.id is null then false
    when s.owner_id is not null and s.owner_id = p.user_id then true
    when chave = 'clientes_do_salao' then coalesce(p.permissoes ->> 'clientes', 'salao') = 'salao'
    else coalesce((p.permissoes ->> chave)::boolean, true)
  end
  from public.professionals p
  left join public.salons s on s.id = p.salon_id
  where p.id = prof;
$$;
grant execute on function public.pode(uuid, text) to anon, authenticated;

-- bloquear os próprios horários
drop policy if exists "equipe gerencia bloqueios" on public.professional_blocks;
create policy "equipe gerencia bloqueios"
  on public.professional_blocks for all
  to authenticated
  using (
    (public.is_professional(professional_id) and public.pode(professional_id, 'bloquear'))
    or public.is_admin_do_salao((select salon_id from public.professionals where id = professional_id))
  )
  with check (
    (public.is_professional(professional_id) and public.pode(professional_id, 'bloquear'))
    or public.is_admin_do_salao((select salon_id from public.professionals where id = professional_id))
  );

-- escolher os serviços que faz
drop policy if exists "admin ou dona define servicos" on public.professional_services;
create policy "admin ou dona define servicos"
  on public.professional_services for insert
  to authenticated
  with check ((public.is_professional(professional_id) and public.pode(professional_id, 'servicos'))
              or public.is_admin_do_salao((select p.salon_id from public.professionals p where p.id = professional_id)));
drop policy if exists "admin ou dona remove servicos" on public.professional_services;
create policy "admin ou dona remove servicos"
  on public.professional_services for delete
  to authenticated
  using ((public.is_professional(professional_id) and public.pode(professional_id, 'servicos'))
         or public.is_admin_do_salao((select p.salon_id from public.professionals p where p.id = professional_id)));

-- as clientes que ela vê: todas do salão, ou só as ligadas a ela (que ela
-- trouxe ou já atendeu)
drop policy if exists "cada uma ve seus vinculos" on public.vinculos;
create policy "cada uma ve seus vinculos"
  on public.vinculos for select
  to authenticated
  using (client_id = auth.uid()
         or public.is_admin_do_salao(salon_id)
         or exists (select 1 from public.professionals p
                    where p.salon_id = vinculos.salon_id and p.user_id = auth.uid()
                      and (public.pode(p.id, 'clientes_do_salao')
                           or vinculos.trazida_por = p.id
                           or exists (select 1 from public.appointments a where a.client_id = vinculos.client_id and a.professional_id = p.id))));

-- ---------------------------------------------------------------------------
-- 4. Token de acesso, fora da tabela pública
-- ---------------------------------------------------------------------------
create table if not exists public.acessos_equipe (
  token text primary key,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  usado_em timestamptz
);
create index if not exists acessos_equipe_prof_idx on public.acessos_equipe (professional_id);
alter table public.acessos_equipe enable row level security;
revoke all on public.acessos_equipe from anon, authenticated;

create or replace function public.gerar_token_acesso()
returns text
language plpgsql
volatile
as $$
declare t text;
begin
  loop
    t := left(replace(gen_random_uuid()::text, '-', ''), 16);
    exit when not exists (select 1 from public.acessos_equipe where token = t);
  end loop;
  return t;
end;
$$;
revoke execute on function public.gerar_token_acesso() from public, anon, authenticated;

-- o token vivo da profissional (cria se não houver)
create or replace function public.token_da_profissional(prof uuid)
returns text
language plpgsql
volatile
security definer set search_path = public
as $$
declare t text;
begin
  select token into t from public.acessos_equipe where professional_id = prof and usado_em is null order by criado_em desc limit 1;
  if t is null then
    t := public.gerar_token_acesso();
    insert into public.acessos_equipe (token, professional_id) values (t, prof);
  end if;
  return t;
end;
$$;
revoke execute on function public.token_da_profissional(uuid) from public, anon, authenticated;

-- toda profissional configurada ganha o token na hora
create or replace function public.professionals_token()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.situacao = 'configurada' and new.user_id is null then perform public.token_da_profissional(new.id); end if;
  return new;
end;
$$;
drop trigger if exists professionals_token_tg on public.professionals;
create trigger professionals_token_tg after insert or update of situacao on public.professionals
  for each row execute function public.professionals_token();
-- e quem já estava esperando também
do $$
declare r record;
begin
  for r in select id from public.professionals where situacao = 'configurada' and user_id is null loop
    perform public.token_da_profissional(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. O horário herdado acompanha o salão
-- ---------------------------------------------------------------------------
create or replace function public.business_hours_propagar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform set_config('mimo.propagando', '1', true);
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
  select p.id, new.weekday, new.open, new.start_time, new.end_time
  from public.professionals p where p.salon_id = new.salon_id and p.usa_horario_salao
  on conflict (professional_id, weekday) do update set open = excluded.open, start_time = excluded.start_time, end_time = excluded.end_time;
  perform set_config('mimo.propagando', '', true);
  return new;
end;
$$;
drop trigger if exists business_hours_propagar_tg on public.business_hours;
create trigger business_hours_propagar_tg after insert or update on public.business_hours
  for each row execute function public.business_hours_propagar();

-- mexeu no horário dela por fora: passa a ser próprio
create or replace function public.professional_hours_proprio()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('mimo.propagando', true), '') <> '1' then
    update public.professionals set usa_horario_salao = false where id = new.professional_id and usa_horario_salao;
  end if;
  return new;
end;
$$;
drop trigger if exists professional_hours_proprio_tg on public.professional_hours;
create trigger professional_hours_proprio_tg after update on public.professional_hours
  for each row execute function public.professional_hours_proprio();

-- ---------------------------------------------------------------------------
-- 6. Montar a equipe: a dona salva a profissional inteira de uma vez
-- ---------------------------------------------------------------------------
create or replace function public.equipe_salvar_profissional(salao uuid, dados jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; pid uuid; base text; sl text; i integer := 0; h jsonb; nome text; fone text; e164 text; dup uuid; herda boolean; novo_slug text;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão monta a equipe.'; end if;
  nome := nullif(btrim(dados ->> 'name'), '');
  if nome is null then raise exception 'Diga o nome da profissional.'; end if;
  fone := nullif(btrim(dados ->> 'phone'), '');
  if fone is null then raise exception 'Diga o WhatsApp: é por ele que ela ativa o acesso.'; end if;
  e164 := public.telefone_e164(fone);
  if e164 is null then raise exception 'Confere o WhatsApp.'; end if;
  if nullif(dados ->> 'vinculo', '') is not null and dados ->> 'vinculo' not in ('parceira', 'funcionaria', 'autonoma', 'aluga', 'temporaria') then raise exception 'Vínculo desconhecido.'; end if;
  pid := nullif(dados ->> 'id', '')::uuid;
  if pid is not null then
    select * into p from public.professionals where id = pid and salon_id = salao;
    if p.id is null then raise exception 'Profissional não encontrada.'; end if;
  end if;
  select x.id into dup from public.professionals x
  where x.salon_id = salao and x.id is distinct from pid and x.situacao <> 'inativa' and public.telefone_e164(x.phone) = e164 limit 1;
  if dup is not null then raise exception 'Já existe alguém na equipe com esse WhatsApp.'; end if;

  if pid is null then
    base := coalesce(nullif(public.slug_de(nome), ''), 'profissional'); sl := base;
    while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
    insert into public.professionals (salon_id, name, slug, phone, email, especialidade, photo_url, bio, vinculo, usa_horario_salao, cota_pct, cota_excecoes, permissoes, situacao)
    values (salao, nome, sl, fone,
            nullif(lower(btrim(dados ->> 'email')), ''), nullif(btrim(dados ->> 'especialidade'), ''), nullif(dados ->> 'photo_url', ''), nullif(btrim(dados ->> 'bio'), ''),
            nullif(dados ->> 'vinculo', ''), coalesce((dados ->> 'usa_horario_salao')::boolean, true),
            nullif(dados ->> 'cota_pct', '')::numeric, coalesce(dados -> 'cota_excecoes', '[]'::jsonb), coalesce(dados -> 'permissoes', '{}'::jsonb),
            case when dados ->> 'situacao' = 'rascunho' then 'rascunho' else 'configurada' end)
    returning * into p;
  else
    -- o link dela (/p/slug) só muda se a dona pedir e estiver livre
    novo_slug := nullif(public.slug_de(coalesce(dados ->> 'slug', '')), '');
    if novo_slug is not null and novo_slug <> p.slug and exists (select 1 from public.professionals x where x.slug = novo_slug) then raise exception 'Já existe uma profissional com esse link. Escolha outro.'; end if;
    update public.professionals set
      name = nome, phone = fone,
      slug = coalesce(novo_slug, slug),
      bio = case when dados ? 'bio' then nullif(btrim(dados ->> 'bio'), '') else bio end,
      email = case when dados ? 'email' then nullif(lower(btrim(dados ->> 'email')), '') else email end,
      especialidade = case when dados ? 'especialidade' then nullif(btrim(dados ->> 'especialidade'), '') else especialidade end,
      photo_url = case when dados ? 'photo_url' then nullif(dados ->> 'photo_url', '') else photo_url end,
      vinculo = case when dados ? 'vinculo' then nullif(dados ->> 'vinculo', '') else vinculo end,
      usa_horario_salao = coalesce((dados ->> 'usa_horario_salao')::boolean, usa_horario_salao),
      cota_pct = case when dados ? 'cota_pct' then nullif(dados ->> 'cota_pct', '')::numeric else cota_pct end,
      cota_excecoes = case when dados ? 'cota_excecoes' then coalesce(dados -> 'cota_excecoes', '[]'::jsonb) else cota_excecoes end,
      permissoes = case when dados ? 'permissoes' then coalesce(dados -> 'permissoes', permissoes) else permissoes end,
      -- o rascunho vira configurada ao ser salvo pela dona
      situacao = case when situacao = 'rascunho' and coalesce(dados ->> 'situacao', 'configurada') <> 'rascunho' then 'configurada' else situacao end
    where id = p.id returning * into p;
  end if;

  -- os serviços que ela faz, com preço/duração próprios quando houver
  if dados ? 'servicos' and jsonb_typeof(dados -> 'servicos') = 'array' then
    delete from public.professional_services where professional_id = p.id;
    insert into public.professional_services (professional_id, service_id, preco_cents, duracao_minutos)
    select p.id, s.id, nullif(it ->> 'preco_cents', '')::integer, nullif(it ->> 'duracao_minutos', '')::integer
    from jsonb_array_elements(dados -> 'servicos') it
    join public.services s on s.id = (it ->> 'service_id')::uuid and s.salon_id = salao and s.active;
  end if;

  -- horários: os dela, ou os do salão (e aí acompanha quando o salão mudar)
  herda := coalesce((dados ->> 'usa_horario_salao')::boolean, p.usa_horario_salao);
  if dados ? 'horarios' and jsonb_typeof(dados -> 'horarios') = 'array' and not herda then
    for h in select * from jsonb_array_elements(dados -> 'horarios') loop
      insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
      values (p.id, (h ->> 'weekday')::smallint, coalesce((h ->> 'open')::boolean, false),
              case when coalesce((h ->> 'open')::boolean, false) then coalesce(nullif(h ->> 'start_time', '')::time, time '09:00') else time '09:00' end,
              case when coalesce((h ->> 'open')::boolean, false) then coalesce(nullif(h ->> 'end_time', '')::time, time '18:00') else time '18:00' end)
      on conflict (professional_id, weekday) do update set open = excluded.open, start_time = excluded.start_time, end_time = excluded.end_time;
    end loop;
    update public.professionals set usa_horario_salao = false where id = p.id;
  elsif herda then
    perform set_config('mimo.propagando', '1', true);
    insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
    select p.id, b.weekday, b.open, b.start_time, b.end_time from public.business_hours b where b.salon_id = salao
    on conflict (professional_id, weekday) do update set open = excluded.open, start_time = excluded.start_time, end_time = excluded.end_time;
    perform set_config('mimo.propagando', '', true);
    update public.professionals set usa_horario_salao = true where id = p.id;
  end if;

  select * into p from public.professionals where id = p.id;
  return jsonb_build_object('ok', true, 'id', p.id, 'situacao', p.situacao, 'slug', p.slug,
                            'token', case when p.situacao = 'configurada' then public.token_da_profissional(p.id) end);
end;
$$;
revoke execute on function public.equipe_salvar_profissional(uuid, jsonb) from public, anon;
grant execute on function public.equipe_salvar_profissional(uuid, jsonb) to authenticated;

-- a lista da equipe, com tudo que a tela mostra
create or replace function public.equipe_da_casa(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email, 'photo_url', p.photo_url, 'especialidade', p.especialidade, 'slug', p.slug, 'bio', p.bio,
    'user_id', p.user_id, 'vinculo', p.vinculo, 'situacao', p.situacao, 'permissoes', p.permissoes, 'cota_pct', p.cota_pct, 'cota_excecoes', p.cota_excecoes,
    'usa_horario_salao', p.usa_horario_salao, 'configurada_em', p.configurada_em, 'ativada_em', p.ativada_em, 'created_at', p.created_at,
    'dona', p.user_id is not null and p.user_id = s.owner_id,
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object('service_id', ps.service_id, 'preco_cents', ps.preco_cents, 'duracao_minutos', ps.duracao_minutos) order by sv.name), '[]'::jsonb)
                 from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
                 from public.professional_hours h where h.professional_id = p.id),
    'token', (select a.token from public.acessos_equipe a where a.professional_id = p.id and a.usado_em is null order by a.criado_em desc limit 1),
    'acesso_enviado_em', (select max(a.enviado_em) from public.acessos_equipe a where a.professional_id = p.id),
    'parceria', (select x.status from public.parcerias x where x.professional_id = p.id order by x.inicio desc limit 1),
    'tem_historico', exists (select 1 from public.appointments a where a.professional_id = p.id)
  ) order by (p.situacao = 'inativa'), p.created_at), '[]'::jsonb)
  from public.professionals p
  join public.salons s on s.id = p.salon_id
  where p.salon_id = salao and public.is_admin_do_salao(salao);
$$;
revoke execute on function public.equipe_da_casa(uuid) from public, anon;
grant execute on function public.equipe_da_casa(uuid) to authenticated;

-- marcou como enviado (WhatsApp ou link copiado)
create or replace function public.equipe_acesso_enviado(prof uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; t text;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.is_admin_do_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  if p.situacao <> 'configurada' then raise exception 'Essa profissional não está esperando ativação.'; end if;
  t := public.token_da_profissional(p.id);
  update public.acessos_equipe set enviado_em = now() where token = t;
  return jsonb_build_object('ok', true, 'token', t);
end;
$$;
revoke execute on function public.equipe_acesso_enviado(uuid) from public, anon;
grant execute on function public.equipe_acesso_enviado(uuid) to authenticated;

-- desativar, reativar, remover (a história dela nunca some)
create or replace function public.equipe_situacao(prof uuid, acao text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; s public.salons%rowtype; tem boolean;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.is_admin_do_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  select * into s from public.salons where id = p.salon_id;
  if p.user_id is not null and p.user_id = s.owner_id then raise exception 'Você é a dona: não dá pra se tirar da equipe.'; end if;
  if acao = 'desativar' then
    update public.professionals set situacao = 'inativa' where id = p.id;
  elsif acao = 'reativar' then
    update public.professionals set situacao = case when user_id is not null then 'ativa' else 'configurada' end where id = p.id;
  elsif acao = 'remover' then
    tem := exists (select 1 from public.appointments a where a.professional_id = p.id)
        or exists (select 1 from public.comanda_itens ci where ci.professional_id = p.id)
        or exists (select 1 from public.vinculos v where v.trazida_por = p.id);
    if p.user_id is not null then delete from public.salon_members where salon_id = p.salon_id and user_id = p.user_id and papel = 'profissional'; end if;
    if tem then
      update public.professionals set situacao = 'inativa' where id = p.id;
    else
      delete from public.professionals where id = p.id;
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;
  return jsonb_build_object('ok', true, 'acao', acao, 'apagada', acao = 'remover' and not coalesce(tem, true));
end;
$$;
revoke execute on function public.equipe_situacao(uuid, text) from public, anon;
grant execute on function public.equipe_situacao(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. A profissional ativa o acesso
-- ---------------------------------------------------------------------------
create or replace function public.acesso_por_token(token text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'logo_url', s.logo_url, 'cidade', s.city),
    'profissional', jsonb_build_object('id', p.id, 'nome', p.name, 'especialidade', p.especialidade, 'vinculo', p.vinculo, 'foto', p.photo_url,
      'telefone_final', right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 4),
      'servicos', (select count(*) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
      'dias', (select coalesce(jsonb_agg(h.weekday order by h.weekday), '[]'::jsonb) from public.professional_hours h where h.professional_id = p.id and h.open)),
    'situacao', p.situacao, 'tem_conta', p.user_id is not null, 'usado', a.usado_em is not null)
  from public.acessos_equipe a
  join public.professionals p on p.id = a.professional_id
  join public.salons s on s.id = p.salon_id
  where a.token = lower(btrim(token));
$$;
grant execute on function public.acesso_por_token(text) to anon, authenticated;

create or replace function public.ativar_acesso_interno(conta uuid, token text, fone text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.acessos_equipe%rowtype; p public.professionals%rowtype; s public.salons%rowtype; e164 text; papel_atual text; outra uuid;
begin
  select * into a from public.acessos_equipe where acessos_equipe.token = lower(btrim(ativar_acesso_interno.token));
  if a.token is null then raise exception 'Link de acesso não encontrado.'; end if;
  select * into p from public.professionals where id = a.professional_id;
  select * into s from public.salons where id = p.salon_id;
  if p.user_id is not null and p.user_id = conta then
    return jsonb_build_object('ok', true, 'ja', true, 'salao', s.name, 'professional_id', p.id, 'situacao', p.situacao);
  end if;
  if a.usado_em is not null or p.user_id is not null then raise exception 'Esse link já foi usado. Entre com a sua conta.'; end if;
  if p.situacao = 'inativa' then raise exception 'Essa agenda está desativada. Fale com o salão.'; end if;
  -- o WhatsApp informado tem de ser o que o salão cadastrou
  e164 := public.telefone_e164(coalesce(nullif(btrim(fone), ''), (select phone from public.profiles where id = conta)));
  if e164 is null or e164 is distinct from public.telefone_e164(p.phone) then raise exception 'O WhatsApp não confere com o que o salão cadastrou.'; end if;
  select role into papel_atual from public.profiles where id = conta;
  if papel_atual in ('admin', 'plataforma') or exists (select 1 from public.salons x where x.owner_id = conta) then
    raise exception 'Essa conta já é dona de um negócio. Pra entrar numa equipe, use outra conta.';
  end if;
  select id into outra from public.professionals where user_id = conta and id <> p.id;
  if outra is not null then raise exception 'Essa conta já tem agenda em outro salão.'; end if;

  update public.professionals set user_id = conta, situacao = 'ativa' where id = p.id;
  insert into public.salon_members (salon_id, user_id, papel) values (p.salon_id, conta, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = conta and role = 'cliente';
  update public.acessos_equipe set usado_em = now() where acessos_equipe.token = a.token;
  return jsonb_build_object('ok', true, 'salao', s.name, 'salao_id', s.id, 'professional_id', p.id, 'situacao', 'ativa');
end;
$$;
revoke execute on function public.ativar_acesso_interno(uuid, text, text) from public, anon, authenticated;

create or replace function public.ativar_acesso(token text, fone text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para ativar o acesso.'; end if;
  return public.ativar_acesso_interno(auth.uid(), token, fone);
end;
$$;
revoke execute on function public.ativar_acesso(text, text) from public, anon;
grant execute on function public.ativar_acesso(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. O link genérico da equipe agora só recolhe nome e WhatsApp
-- ---------------------------------------------------------------------------
create or replace function public.equipe_informar_dados(convite text, nome text, fone text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; e164 text; base text; sl text; i integer := 0; ja uuid;
begin
  select * into s from public.salons where codigo_equipe = upper(btrim(convite)) and active;
  if s.id is null then raise exception 'Convite não encontrado.'; end if;
  if nullif(btrim(nome), '') is null then raise exception 'Diga o seu nome.'; end if;
  e164 := public.telefone_e164(fone);
  if e164 is null then raise exception 'Confere o WhatsApp.'; end if;
  select id into ja from public.professionals p where p.salon_id = s.id and p.situacao <> 'inativa' and public.telefone_e164(p.phone) = e164 limit 1;
  if ja is not null then return jsonb_build_object('ok', true, 'ja', true, 'salao', s.name); end if;
  if (select count(*) from public.professionals p where p.salon_id = s.id and p.situacao = 'rascunho') >= 50 then raise exception 'O salão já tem muitos cadastros esperando. Fale com a dona.'; end if;
  base := coalesce(nullif(public.slug_de(nome), ''), 'profissional'); sl := base;
  while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
  insert into public.professionals (salon_id, name, slug, phone, situacao) values (s.id, btrim(nome), sl, btrim(fone), 'rascunho');
  return jsonb_build_object('ok', true, 'ja', false, 'salao', s.name);
end;
$$;
grant execute on function public.equipe_informar_dados(text, text, text) to anon, authenticated;

-- quem já tem conta e entra pelo link: se o salão já a cadastrou pelo
-- telefone, ativa; senão fica como rascunho até a dona configurar
create or replace function public.entrar_na_equipe_interno(conta uuid, convite text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; nome_pessoa text; fone text; e164 text; prof uuid; base text; sl text; i integer := 0; papel_atual text; sit text;
begin
  select * into s from public.salons where codigo_equipe = upper(btrim(convite)) and active;
  if s.id is null then raise exception 'Convite não encontrado.'; end if;
  select full_name, phone, role into nome_pessoa, fone, papel_atual from public.profiles where id = conta;
  if papel_atual in ('admin', 'plataforma') or exists (select 1 from public.salons x where x.owner_id = conta) then
    raise exception 'Essa conta já é dona de um negócio.';
  end if;
  select id into prof from public.professionals where salon_id = s.id and user_id = conta;
  if prof is null then
    e164 := public.telefone_e164(fone);
    if e164 is not null then
      select id into prof from public.professionals p where p.salon_id = s.id and p.user_id is null and p.situacao <> 'inativa' and public.telefone_e164(p.phone) = e164 limit 1;
    end if;
    if prof is not null then
      update public.professionals set user_id = conta where id = prof;
      update public.acessos_equipe set usado_em = coalesce(usado_em, now()) where professional_id = prof;
    else
      base := coalesce(nullif(public.slug_de(nome_pessoa), ''), 'profissional'); sl := base;
      while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
      insert into public.professionals (salon_id, user_id, name, slug, phone, situacao)
      values (s.id, conta, coalesce(nome_pessoa, 'Profissional'), sl, fone, 'rascunho') returning id into prof;
    end if;
  end if;
  insert into public.salon_members (salon_id, user_id, papel) values (s.id, conta, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = conta and role = 'cliente';
  select situacao into sit from public.professionals where id = prof;
  return jsonb_build_object('ok', true, 'salao_id', s.id, 'salao', s.name, 'professional_id', prof, 'situacao', sit);
end;
$$;
revoke execute on function public.entrar_na_equipe_interno(uuid, text) from public, anon, authenticated;

-- o cadastro novo com token de acesso já ativa (handle_new_user, passo e)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  convite text := nullif(upper(btrim(meta ->> 'codigo_convite')), '');
  papel text := nullif(meta ->> 'papel_desejado', '');
  alvo jsonb;
  fone text;
  quem text;
  base text;
  e record;
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    meta ->> 'full_name',
    meta ->> 'phone',
    public.gerar_codigo_indicacao(meta ->> 'full_name')
  );

  -- (a) veio por um código: entra na agenda antes de abrir o app
  if convite is not null then
    begin
      alvo := public.resolver_codigo(convite);
      if alvo is not null then
        perform public.vincular_interno(new.id, (alvo -> 'salao' ->> 'id')::uuid,
                                        (alvo ->> 'profissional_id')::uuid, 'cadastro');
        quem := alvo ->> 'nome';
        base := rtrim((select s.app_url from public.salons s where s.id = (alvo -> 'salao' ->> 'id')::uuid), '/');
      end if;
    exception when others then
      raise notice 'convite % não aplicado: %', convite, sqlerrm;
    end;
  end if;

  -- (b) já foi encaixada pelo telefone: os horários passam a ser dela, e o
  --     salão que a encaixou vira vínculo
  fone := public.telefone_e164(meta ->> 'phone');
  if fone is not null then
    begin
      update public.appointments a
      set client_id = new.id
      where a.client_id is null
        and public.telefone_e164(a.guest_phone) = fone;

      perform public.vincular_interno(new.id, a.salon_id, a.professional_id, 'encaixe')
      from (select distinct on (salon_id) salon_id, professional_id
            from public.appointments
            where client_id = new.id
            order by salon_id, date) a;
    exception when others then
      raise notice 'encaixes de % não amarrados: %', fone, sqlerrm;
    end;
  end if;

  -- (c) escolheu "sou profissional" / "tenho um salão" no cadastro
  if papel in ('autonoma', 'salao') then
    begin
      perform public.abrir_negocio_interno(new.id, papel, meta ->> 'nome_negocio', meta ->> 'cidade');
      -- (c2) o cadastro do onboarding público já traz os dados do salão (115): grava e pula pro passo 3
      if jsonb_typeof(meta -> 'salao') = 'object' then
        perform public.onboarding_salvar_interno(s.id, meta -> 'salao', 3)
        from public.salons s where s.owner_id = new.id order by s.created_at desc limit 1;
      end if;
    exception when others then
      raise notice 'negócio de % não aberto: %', new.id, sqlerrm;
    end;
  end if;

  -- (d) veio pelo convite da equipe de um salão: entra (ou fica esperando a dona configurar)
  if nullif(upper(btrim(meta ->> 'equipe_codigo')), '') is not null then
    begin
      perform public.entrar_na_equipe_interno(new.id, upper(btrim(meta ->> 'equipe_codigo')));
    exception when others then
      raise notice 'convite de equipe % não aplicado: %', meta ->> 'equipe_codigo', sqlerrm;
    end;
  end if;

  -- (e) veio pelo link de acesso que o salão mandou (119): a agenda já está pronta
  if nullif(btrim(meta ->> 'ativar_token'), '') is not null then
    begin
      perform public.ativar_acesso_interno(new.id, meta ->> 'ativar_token', meta ->> 'phone');
    exception when others then
      raise notice 'acesso % não ativado: %', meta ->> 'ativar_token', sqlerrm;
    end;
  end if;

  -- (f) boas-vindas na fila de e-mail
  begin
    if base is null then
      select rtrim(s.app_url, '/') into base from public.salons s where s.app_url is not null order by s.created_at limit 1;
    end if;
    select * into e from public.email_boas_vindas(meta ->> 'full_name', quem, papel, coalesce(base, '') || '/');
    perform public.enfileirar_email(new.email, e.assunto, e.html, 'boas_vindas', e.texto, meta ->> 'full_name', new.id);
  exception when others then
    raise notice 'boas-vindas de % não enfileirado: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Preço e duração da profissional valem na hora de marcar
-- ---------------------------------------------------------------------------
create or replace function public.marcar_servicos(prof uuid, servicos uuid[], dia date, hora time, obs text default null, pagar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  itens record;
  total_min integer := 0;
  total_cents integer := 0;
  total_desconto integer := 0;
  nomes text := '';
  novo uuid;
  n integer := 0;
  sal uuid;
  pg jsonb;
  st text := 'pendente';
  cred public.pagamentos%rowtype;
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if servicos is null or array_length(servicos, 1) is null then raise exception 'Escolha pelo menos um serviço.'; end if;
  if array_length(servicos, 1) > 6 then raise exception 'No máximo 6 serviços por horário.'; end if;
  select p.salon_id into sal from public.professionals p where p.id = prof and p.active;
  if sal is null and not exists (select 1 from public.professionals p where p.id = prof and p.active) then raise exception 'Profissional não encontrada.'; end if;

  create temp table if not exists itens_do_pedido (
    ord integer, service_id uuid, name text, cents integer, cheio integer, promocao_id uuid, duration_minutes integer
  ) on commit drop;
  delete from itens_do_pedido where true;
  -- o preço cheio é o dela, quando tem; a promoção (em %) desconta sobre ele
  insert into itens_do_pedido (ord, service_id, name, cents, cheio, promocao_id, duration_minutes)
  select x.ord, s.id, s.name,
         case when d.promocao_id is null then coalesce(ps.preco_cents, round(s.price * 100)::integer)
              when ps.preco_cents is not null and d.desconto_pct is not null then round(ps.preco_cents * (100 - d.desconto_pct) / 100.0)::integer
              else coalesce(d.preco_com_desconto_cents, round(s.price * 100)::integer) end,
         coalesce(ps.preco_cents, round(s.price * 100)::integer),
         d.promocao_id,
         coalesce(ps.duracao_minutos, s.duration_minutes)
  from unnest(servicos) with ordinality as x(id, ord)
  join public.services s on s.id = x.id and s.active
  join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof
  left join public.descontos_para_mim(servicos) d on d.service_id = s.id;

  for itens in select * from itens_do_pedido order by ord loop
    n := n + 1;
    total_min := total_min + coalesce(itens.duration_minutes, 0);
    total_cents := total_cents + coalesce(itens.cents, 0);
    total_desconto := total_desconto + (coalesce(itens.cheio, 0) - coalesce(itens.cents, 0));
    nomes := nomes || case when nomes = '' then '' else ' + ' end || itens.name;
  end loop;
  if n <> array_length(servicos, 1) then raise exception 'Algum serviço não está disponível com essa profissional.'; end if;
  if total_min <= 0 then raise exception 'Serviço sem duração.'; end if;

  -- pagamento pelo app: só fora de visita e com valor para cobrar
  if sal is not null and total_cents > 0 and coalesce(current_setting('agenda_mel.em_visita', true), '') <> '1' then
    -- um crédito de remarcação com esta casa vale como sinal: não paga de novo
    select * into cred from public.pagamentos
    where client_id = eu and salon_id = sal and status = 'credito' and credito_ate >= public.agora_local()::date
    order by credito_ate, valor_cents desc limit 1;
    if cred.id is null then
      pg := public.pagamento_do_salao(sal);
      if pg ->> 'modo' = 'obrigatorio' or (pg ->> 'modo' = 'opcional' and coalesce(pagar, false)) then
        st := 'aguardando_pagamento';
      end if;
    end if;
  end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, desconto_cents, date, start_time, end_time, notes, status, pago_cents)
    values
      (eu, prof, servicos[1], nomes, total_cents, total_desconto, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), st,
       coalesce(cred.valor_cents, 0))
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
  select novo, i.service_id, i.name, i.cents, i.cheio, i.promocao_id, i.duration_minutes, i.ord
  from itens_do_pedido i order by i.ord;

  if cred.id is not null then
    update public.pagamentos
    set appointment_id = novo, status = 'pago', remarcado_de = coalesce(remarcado_de, cred.appointment_id), credito_ate = null,
        motivo_estorno = null, atualizado_em = now()
    where id = cred.id;
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents, 'desconto_cents', total_desconto,
                            'pagar', st = 'aguardando_pagamento', 'credito_usado', coalesce(cred.valor_cents, 0));
end;
$$;
grant execute on function public.marcar_servicos(uuid, uuid[], date, time, text, boolean) to authenticated;

-- a página do salão mostra o preço e a duração de cada uma, e o "a partir de"
create or replace function public.pagina_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', (select jsonb_build_object(
        'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'descricao', s.descricao, 'fotos', to_jsonb(s.fotos), 'logo_url', s.logo_url,
        'endereco', s.address, 'cidade', s.city, 'cep', s.cep, 'lat', s.lat, 'lng', s.lng, 'telefone', s.phone, 'whatsapp', coalesce(s.whatsapp, s.phone), 'instagram', s.instagram,
        'pagamento', public.pagamento_do_salao(s.id))
      from public.salons s where s.id = salao and s.active),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
      from public.business_hours h where h.salon_id = salao),
    'nota', (select jsonb_build_object('media', round(avg(r.nota)::numeric, 1), 'quantas', count(*))
      from public.reviews r join public.professionals p on p.id = r.professional_id where p.salon_id = salao),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'foto', p.photo_url, 'bio', p.bio,
        'faz', (select coalesce(jsonb_agg(sv.name order by sv.name), '[]'::jsonb) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
        'nota', (select round(avg(r.nota)::numeric, 1) from public.reviews r where r.professional_id = p.id)
      ) order by p.name), '[]'::jsonb)
      from public.professionals p where p.salon_id = salao and p.active),
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', sv.id, 'name', sv.name, 'price', sv.price, 'duration_minutes', sv.duration_minutes, 'images', to_jsonb(sv.images),
        'description', sv.description, 'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'destaque', sv.destaque, 'a_partir', sv.a_partir,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'foto', p.photo_url, 'preco_cents', ps.preco_cents, 'duracao_minutos', ps.duracao_minutos) order by p.name), '[]'::jsonb)
                 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'capas', (select coalesce(jsonb_object_agg(k.categoria_id, to_jsonb(k.imagens)), '{}'::jsonb) from public.capas_do_salao(salao) k),
    'preferida', (select professional_id from public.profissional_preferida where client_id = auth.uid() and salon_id = salao),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
grant execute on function public.pagina_do_salao(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Repasse: contrato, senão a cota dela, senão o padrão da casa
-- ---------------------------------------------------------------------------
create or replace function public.cota_da_profissional(prof public.professionals, servico uuid)
returns numeric
language sql
immutable
as $$
  select coalesce(
    (select (e ->> 'cota_pct')::numeric from jsonb_array_elements(coalesce(prof.cota_excecoes, '[]'::jsonb)) e
      where nullif(e ->> 'service_id', '')::uuid = servico limit 1),
    prof.cota_pct);
$$;

create or replace function public.pdv_repasse(salao uuid, de date, ate date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê o repasse.'; end if;
    if not public.pode(minha, 'ver_repasse') then raise exception 'O salão não liberou o repasse pra você.'; end if;
  end if;
  if ate < de then raise exception 'O período está invertido.'; end if;
  if ate - de > 92 then raise exception 'Escolha um período de até 3 meses.'; end if;

  with itens as (
    select ci.*, coalesce(nullif(btrim(pf.full_name), ''), c.cliente_nome, 'Cliente') cliente, p.name profissional, c.fechada_em,
           pa.id parceria_id,
           case when pa.id is not null then 'contrato' when p.cota_pct is not null then 'profissional' else 'casa' end origem,
           coalesce(pa.cota_pct, p.cota_pct, s.cota_padrao_pct) cota_pct, coalesce(pa.base_calculo, s.base_padrao) base_calculo, pa.periodicidade,
           case when pa.id is not null then public.cota_do_item(pa, ci.nome) else coalesce(public.cota_da_profissional(p, ci.service_id), s.cota_padrao_pct) end cota,
           round((case when coalesce(pa.base_calculo, s.base_padrao) = 'liquido' then ci.liquido_cents else ci.valor_cents end)
                 * (case when pa.id is not null then public.cota_do_item(pa, ci.nome) else coalesce(public.cota_da_profissional(p, ci.service_id), s.cota_padrao_pct) end) / 100.0)::integer repasse_cents
    from public.comanda_itens ci
    join public.comandas c on c.id = ci.comanda_id
    join public.salons s on s.id = salao
    left join public.profiles pf on pf.id = c.client_id
    left join public.professionals p on p.id = ci.professional_id
    left join lateral (select * from public.parcerias x where x.salon_id = salao and x.professional_id = ci.professional_id and x.status = 'vigente' and x.inicio <= ci.dia order by x.inicio desc limit 1) pa on true
    where ci.salon_id = salao and ci.status = 'fechada' and ci.dia between de and ate
      and (minha is null or ci.professional_id = minha)
  )
  select jsonb_build_object(
    'de', de, 'ate', ate,
    'padrao', (select jsonb_build_object('cota_pct', s2.cota_padrao_pct, 'base', s2.base_padrao) from public.salons s2 where s2.id = salao),
    'total', (select jsonb_build_object('bruto_cents', coalesce(sum(valor_cents), 0), 'desconto_cents', coalesce(sum(desconto_cents), 0), 'liquido_cents', coalesce(sum(liquido_cents), 0),
                                        'repasse_cents', coalesce(sum(repasse_cents), 0), 'comandas', count(distinct comanda_id), 'itens', count(*)) from itens),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'comandas', g.comandas, 'itens', g.n,
        'bruto_cents', g.bruto, 'desconto_cents', g.desc_, 'liquido_cents', g.liq,
        'contrato', jsonb_build_object('origem', g.origem, 'parceria_id', g.parceria_id, 'cota_pct', g.cota_pct, 'base_calculo', g.base_calculo, 'periodicidade', g.periodicidade),
        'repasse_cents', g.repasse, 'casa_cents', g.liq - g.repasse
      ) order by g.liq desc), '[]'::jsonb)
      from (select professional_id, profissional, count(distinct comanda_id) comandas, count(*) n, sum(valor_cents) bruto, sum(desconto_cents) desc_, sum(liquido_cents) liq,
                   max(parceria_id::text)::uuid parceria_id, max(origem) origem, max(cota_pct) cota_pct, max(base_calculo) base_calculo, max(periodicidade) periodicidade, sum(repasse_cents) repasse
            from itens group by professional_id, profissional) g),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'dia', i.dia, 'fechada_em', i.fechada_em, 'comanda_id', i.comanda_id, 'appointment_id', i.appointment_id, 'cliente', i.cliente,
        'professional_id', i.professional_id, 'profissional', i.profissional, 'nome', i.nome, 'qtd', i.qtd,
        'valor_cents', i.valor_cents, 'desconto_cents', i.desconto_cents, 'liquido_cents', i.liquido_cents, 'cota_pct', i.cota, 'repasse_cents', i.repasse_cents
      ) order by i.fechada_em desc, i.ordem), '[]'::jsonb) from itens i)
  ) into r;
  return r;
end;
$$;

-- a projeção da semana usa a mesma cascata
create or replace function public.projecao_semanal(salao uuid, inicio date default null, prof uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean; d0 date; d1 date; filtro uuid;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê a projeção.'; end if;
  end if;
  filtro := coalesce(minha, prof);
  d0 := coalesce(inicio, public.agora_local()::date);
  d0 := d0 - ((extract(isodow from d0)::integer) - 1);   -- segunda-feira
  d1 := d0 + 6;

  with s as (select * from public.salons where id = salao),
  h as (
    select a.id, a.date, a.status, a.professional_id, p.name profissional, coalesce(a.price_cents, 0) preco, coalesce(a.pago_cents, 0) sinal,
           greatest(0, extract(epoch from (a.end_time - a.start_time)) / 60)::integer minutos,
           (select coalesce(sum(ci.liquido_cents), 0) from public.comanda_itens ci where ci.appointment_id = a.id and ci.status = 'fechada') fechado,
           coalesce(pa.cota_pct, p.cota_pct, (select cota_padrao_pct from s)) cota, pa.id parceria_id
    from public.appointments a
    left join public.professionals p on p.id = a.professional_id
    left join lateral (select * from public.parcerias x where x.salon_id = salao and x.professional_id = a.professional_id and x.status = 'vigente' and x.inicio <= a.date order by x.inicio desc limit 1) pa on true
    where a.salon_id = salao and a.date between d0 and d1 and a.status <> 'cancelado'
      and (filtro is null or a.professional_id = filtro)
  ),
  v as (
    select *,
      case when status = 'concluido' then (case when fechado > 0 then fechado else preco end) else 0 end realizado,
      case when status in ('confirmado', 'pendente') then preco else 0 end a_vir,
      case when status = 'faltou' then preco else 0 end perdido,
      case when status in ('confirmado', 'pendente', 'concluido') then minutos else 0 end marcados
    from h
  ),
  dias as (select generate_series(d0, d1, interval '1 day')::date dia),
  exp as (
    select p.id professional_id, ds.dia,
      case when ph.professional_id is not null then (case when ph.open then extract(epoch from (ph.end_time - ph.start_time)) / 60 else 0 end)
           when bh.salon_id is not null then (case when bh.open then extract(epoch from (bh.end_time - bh.start_time)) / 60 else 0 end)
           else 0 end::integer abertos
    from public.professionals p
    cross join dias ds
    left join public.professional_hours ph on ph.professional_id = p.id and ph.weekday = extract(dow from ds.dia)::integer
    left join public.business_hours bh on bh.salon_id = salao and bh.weekday = extract(dow from ds.dia)::integer
    where p.salon_id = salao and p.active and (filtro is null or p.id = filtro)
  )
  select jsonb_build_object(
    'inicio', d0, 'fim', d1, 'hoje', public.agora_local()::date, 'filtro', filtro,
    'padrao', (select jsonb_build_object('cota_pct', cota_padrao_pct, 'base', base_padrao) from s),
    'dias', (select jsonb_agg(jsonb_build_object(
        'dia', ds.dia,
        'horarios', (select count(*) from v where v.date = ds.dia and v.status <> 'faltou'),
        'confirmados', (select count(*) from v where v.date = ds.dia and v.status = 'confirmado'),
        'pendentes', (select count(*) from v where v.date = ds.dia and v.status = 'pendente'),
        'concluidos', (select count(*) from v where v.date = ds.dia and v.status = 'concluido'),
        'faltas', (select count(*) from v where v.date = ds.dia and v.status = 'faltou'),
        'previsto_cents', (select coalesce(sum(realizado + a_vir), 0) from v where v.date = ds.dia),
        'confirmado_cents', (select coalesce(sum(preco), 0) from v where v.date = ds.dia and v.status = 'confirmado'),
        'pendente_cents', (select coalesce(sum(preco), 0) from v where v.date = ds.dia and v.status = 'pendente'),
        'realizado_cents', (select coalesce(sum(realizado), 0) from v where v.date = ds.dia),
        'sinal_cents', (select coalesce(sum(sinal), 0) from v where v.date = ds.dia and v.status in ('confirmado', 'pendente')),
        'perdido_cents', (select coalesce(sum(perdido), 0) from v where v.date = ds.dia),
        'minutos_marcados', (select coalesce(sum(marcados), 0) from v where v.date = ds.dia),
        'minutos_abertos', (select coalesce(sum(abertos), 0) from exp where exp.dia = ds.dia)
      ) order by ds.dia) from dias ds),
    'total', (select jsonb_build_object(
        'horarios', count(*) filter (where status <> 'faltou'), 'confirmados', count(*) filter (where status = 'confirmado'), 'pendentes', count(*) filter (where status = 'pendente'),
        'concluidos', count(*) filter (where status = 'concluido'), 'faltas', count(*) filter (where status = 'faltou'),
        'previsto_cents', coalesce(sum(realizado + a_vir), 0),
        'confirmado_cents', coalesce(sum(preco) filter (where status = 'confirmado'), 0),
        'pendente_cents', coalesce(sum(preco) filter (where status = 'pendente'), 0),
        'realizado_cents', coalesce(sum(realizado), 0),
        'sinal_cents', coalesce(sum(sinal) filter (where status in ('confirmado', 'pendente')), 0),
        'perdido_cents', coalesce(sum(perdido), 0),
        'equipe_cents', coalesce(sum(round((realizado + a_vir) * cota / 100.0)), 0),
        'casa_cents', coalesce(sum(realizado + a_vir) - sum(round((realizado + a_vir) * cota / 100.0)), 0),
        'ticket_medio_cents', case when count(*) filter (where status in ('confirmado', 'pendente', 'concluido')) > 0 then round(sum(realizado + a_vir) / count(*) filter (where status in ('confirmado', 'pendente', 'concluido'))) else 0 end,
        'minutos_marcados', coalesce(sum(marcados), 0),
        'minutos_abertos', (select coalesce(sum(abertos), 0) from exp)
      ) from v),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'horarios', g.n, 'pendentes', g.pend,
        'previsto_cents', g.previsto, 'realizado_cents', g.realizado, 'sinal_cents', g.sinal,
        'cota_pct', g.cota, 'contrato', g.contrato, 'equipe_cents', g.equipe, 'casa_cents', g.previsto - g.equipe,
        'minutos_marcados', g.marcados, 'minutos_abertos', (select coalesce(sum(abertos), 0) from exp where exp.professional_id = g.professional_id)
      ) order by g.previsto desc), '[]'::jsonb)
      from (select professional_id, profissional, count(*) filter (where status <> 'faltou') n, count(*) filter (where status = 'pendente') pend,
                   sum(realizado + a_vir) previsto, sum(realizado) realizado, coalesce(sum(sinal) filter (where status in ('confirmado', 'pendente')), 0) sinal,
                   max(cota) cota, bool_or(parceria_id is not null) contrato, sum(round((realizado + a_vir) * cota / 100.0)) equipe, sum(marcados) marcados
            from v group by 1, 2) g),
    'semanas', (select jsonb_agg(jsonb_build_object('inicio', w.ini, 'previsto_cents', n.previsto_cents, 'realizado_cents', n.realizado_cents, 'horarios', n.horarios) order by w.ini)
      from (select d0 - 7 * k ini from generate_series(4, 0, -1) k) w
      cross join lateral public.semana_numeros(salao, w.ini, filtro) n),
    'semana_passada', (select jsonb_build_object('realizado_cents', n.realizado_cents, 'horarios', n.horarios) from public.semana_numeros(salao, d0 - 7, filtro) n)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.projecao_semanal(uuid, date, uuid) from public, anon;
grant execute on function public.projecao_semanal(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Depois do onboarding: primeiros passos e equipe pendente
-- ---------------------------------------------------------------------------
create or replace function public.primeiros_passos(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'tipo', s.tipo, 'codigo', s.codigo, 'nome', s.name,
    'dados', s.name is not null and coalesce(s.whatsapp, s.phone) is not null and s.city is not null,
    'horarios', exists (select 1 from public.business_hours b where b.salon_id = s.id and b.open),
    'servicos', (select count(*) from public.services sv where sv.salon_id = s.id and sv.active),
    'equipe', (select count(*) from public.professionals p where p.salon_id = s.id and p.situacao in ('configurada', 'ativa')),
    'equipe_pendente', (select count(*) from public.professionals p where p.salon_id = s.id and p.situacao = 'configurada' and p.user_id is null),
    'equipe_rascunho', (select count(*) from public.professionals p where p.salon_id = s.id and p.situacao = 'rascunho'),
    'agendamentos', (select count(*) from public.appointments a where a.salon_id = s.id),
    'avisos', exists (select 1 from public.push_subscriptions ps where ps.user_id = auth.uid()),
    'feitos', s.primeiros_passos,
    'onboarding_concluido_em', s.onboarding_concluido_em)
  from public.salons s where s.id = salao and public.is_admin_do_salao(salao);
$$;
revoke execute on function public.primeiros_passos(uuid) from public, anon;
grant execute on function public.primeiros_passos(uuid) to authenticated;

create or replace function public.primeiro_passo_feito(salao uuid, chave text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão.'; end if;
  if chave !~ '^[a-z_]{1,40}$' then raise exception 'Chave inválida.'; end if;
  update public.salons set primeiros_passos = primeiros_passos || jsonb_build_object(chave, now()) where id = salao returning * into s;
  return s.primeiros_passos;
end;
$$;
revoke execute on function public.primeiro_passo_feito(uuid, text) from public, anon;
grant execute on function public.primeiro_passo_feito(uuid, text) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('119_equipe_configurada.sql') on conflict (arquivo) do nothing;
