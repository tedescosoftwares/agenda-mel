-- 266: a cliente é do salão (4.11)
--   A página da profissional passa a ser a página do salão com ela na frente, e o que protege a carteira da casa:
--   1. Contato pessoal não entra na página: a apresentação e a especialidade da profissional não aceitam telefone,
--      @, nem link (professionals_sem_contato_tg). Os botões de WhatsApp e Instagram da página são os do salão.
--   2. Telefone da cliente escondido da equipe por padrão: a permissão 'telefone' nasce desligada (pode()), e sem ela
--      a profissional da equipe não lê o cadastro da cliente (as políticas de profiles). O nome continua aparecendo
--      na agenda dela por cliente_nome(appointments). O salão libera por profissional (equipe_permissao).
--      Limite conhecido: o telefone digitado num encaixe (appointments.guest_phone) continua na linha do horário;
--      as telas da equipe não mostram, mas a coluna não tem como ser escondida por profissional.
--   3. Quem saiu da equipe: o link dela abre a página do salão, com o aviso de que ela não atende mais ali
--      (resolver_endereco devolve 'saiu').
--   4. O link direto /p/<nome> abre a mesma página nova (pagina_da_profissional).
-- Idempotente.

-- ---- 2. a permissão 'telefone' nasce desligada (as outras continuam nascendo ligadas) -----------------------------
create or replace function public.pode(prof uuid, chave text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when p.id is null then false
    when s.owner_id is not null and s.owner_id = p.user_id then true
    when s.tipo = 'autonoma' then true
    when chave = 'clientes_do_salao' then coalesce(p.permissoes ->> 'clientes', 'salao') = 'salao'
    when chave = 'telefone' then coalesce((p.permissoes ->> chave)::boolean, false)
    else coalesce((p.permissoes ->> chave)::boolean, true)
  end
  from public.professionals p
  left join public.salons s on s.id = p.salon_id
  where p.id = prof;
$$;

drop policy if exists "profissional ve clientes dela" on public.profiles;
create policy "profissional ve clientes dela" on public.profiles for select using (
  exists (select 1 from public.appointments a
          where a.client_id = profiles.id and public.is_professional(a.professional_id) and public.pode(a.professional_id, 'telefone')));
drop policy if exists "profissional ve quem espera" on public.profiles;
create policy "profissional ve quem espera" on public.profiles for select using (
  exists (select 1 from public.waitlist_entries w
          where w.client_id = profiles.id and w.status = 'aguardando' and public.is_professional(w.professional_id) and public.pode(w.professional_id, 'telefone')));

-- o nome da cliente na agenda, sem abrir o cadastro dela: appointments?select=...,cliente_nome
create or replace function public.cliente_nome(a public.appointments)
returns text
language sql stable security definer set search_path = public
as $$
  select case when a.client_id = auth.uid() or public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)
    then coalesce((select nullif(btrim(pf.full_name), '') from public.profiles pf where pf.id = a.client_id), nullif(btrim(a.guest_name), ''))
  end;
$$;
revoke execute on function public.cliente_nome(public.appointments) from public, anon;
grant execute on function public.cliente_nome(public.appointments) to authenticated;

-- o salão liga ou desliga uma permissão de uma profissional
create or replace function public.equipe_permissao(prof uuid, chave text, valor boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype;
begin
  select * into p from public.professionals where id = prof;
  if not found or not public.is_admin_do_salao(p.salon_id) then raise exception 'Só quem manda no salão muda as permissões da equipe.'; end if;
  if chave not in ('telefone', 'confirmar', 'bloquear', 'servicos', 'ver_repasse') then raise exception 'Permissão desconhecida.'; end if;
  update public.professionals set permissoes = coalesce(permissoes, '{}'::jsonb) || jsonb_build_object(chave, coalesce(valor, false)) where id = prof
  returning * into p;
  return p.permissoes;
end;
$$;
revoke execute on function public.equipe_permissao(uuid, text, boolean) from public, anon;
grant execute on function public.equipe_permissao(uuid, text, boolean) to authenticated;

-- ---- 1. apresentação e especialidade sem contato pessoal ---------------------------------------------------------
create or replace function public.texto_tem_contato(t text)
returns boolean
language sql immutable
as $$
  select coalesce(t, '') ~* '(@|https?:|www\.|wa\.me|\.com\b|instagram|insta\b|whats|zap\b|telegram)'
      or regexp_replace(coalesce(t, ''), '[\s().\-]', '', 'g') ~ '\d{8,}';
$$;

create or replace function public.professionals_sem_contato()
returns trigger
language plpgsql
as $$
declare s_tipo text;
begin
  if tg_op = 'UPDATE' and new.bio is not distinct from old.bio and new.especialidade is not distinct from old.especialidade then return new; end if;
  select tipo into s_tipo from public.salons where id = new.salon_id;
  if s_tipo = 'autonoma' then return new; end if;   -- quem toca o próprio negócio divulga o que quiser
  if public.texto_tem_contato(new.bio) or public.texto_tem_contato(new.especialidade) then
    raise exception 'A apresentação não pode ter telefone, @ de rede social nem link: o contato da página é o do salão.' using errcode = 'MI004';
  end if;
  return new;
end;
$$;
drop trigger if exists professionals_sem_contato_tg on public.professionals;
create trigger professionals_sem_contato_tg before insert or update of bio, especialidade on public.professionals
  for each row execute function public.professionals_sem_contato();

-- ---- 3 e 4. o endereço de quem saiu, e o link direto da profissional ---------------------------------------------
create or replace function public.resolver_endereco(nome text, prof text default null)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare
  n text := lower(btrim(coalesce(nome, '')));
  s public.salons%rowtype;
  p public.professionals%rowtype;
  fase text;
  base jsonb;
  casa jsonb;
begin
  if n = '' then return null; end if;
  select * into s from public.salons where subdominio = n and active;
  if not found then
    select sl.* into s from public.subdominios_antigos a join public.salons sl on sl.id = a.salon_id
    where a.subdominio = n and sl.active and sl.subdominio is not null;
    if not found then return null; end if;
    return jsonb_build_object('redirecionar', s.subdominio);
  end if;
  fase := coalesce(public.acesso_do_salao(s.id) ->> 'fase', 'gratis');
  if fase = 'bloqueado' then
    return jsonb_build_object('tipo', 'indisponivel', 'nome', s.name, 'subdominio', s.subdominio);
  end if;
  base := jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city, 'tipo', s.tipo, 'logo', s.logo_url, 'subdominio', s.subdominio);
  casa := jsonb_build_object(
      'tipo', 'salao', 'codigo', s.codigo, 'subdominio', s.subdominio,
      'nome', s.name, 'foto', s.logo_url, 'especialidade', null, 'profissional_id', null,
      'descricao', s.descricao, 'cidade', s.city, 'endereco', s.address,
      'salao', base);
  if nullif(btrim(coalesce(prof, '')), '') is null then return casa; end if;
  select * into p from public.professionals where salon_id = s.id and slug = lower(btrim(prof)) and active;
  if not found then
    -- 266: ela já foi da casa e saiu: o link continua valendo para o salão
    select * into p from public.professionals where salon_id = s.id and slug = lower(btrim(prof)) order by created_at desc limit 1;
    if not found then return null; end if;
    return casa || jsonb_build_object('saiu', split_part(btrim(p.name), ' ', 1));
  end if;
  return jsonb_build_object(
    'tipo', 'profissional', 'codigo', p.codigo, 'slug', p.slug, 'subdominio', s.subdominio,
    'nome', p.name, 'foto', p.photo_url, 'especialidade', p.especialidade, 'profissional_id', p.id,
    'salao', base);
end;
$$;

-- o link direto (mimo.com.vc/p/<nome>): a mesma resposta, achando o salão pela profissional
create or replace function public.pagina_da_profissional(link text)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare p public.professionals%rowtype; s public.salons%rowtype; base jsonb;
begin
  select * into p from public.professionals where slug = lower(btrim(coalesce(link, ''))) order by active desc, created_at desc limit 1;
  if not found then return null; end if;
  select * into s from public.salons where id = p.salon_id and active;
  if not found then return null; end if;
  if s.subdominio is not null then return public.resolver_endereco(s.subdominio, p.slug); end if;
  if coalesce(public.acesso_do_salao(s.id) ->> 'fase', 'gratis') = 'bloqueado' then
    return jsonb_build_object('tipo', 'indisponivel', 'nome', s.name, 'subdominio', null);
  end if;
  base := jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city, 'tipo', s.tipo, 'logo', s.logo_url, 'subdominio', null);
  if not p.active then
    return jsonb_build_object('tipo', 'salao', 'codigo', s.codigo, 'subdominio', null, 'nome', s.name, 'foto', s.logo_url,
      'profissional_id', null, 'cidade', s.city, 'salao', base, 'saiu', split_part(btrim(p.name), ' ', 1));
  end if;
  return jsonb_build_object('tipo', 'profissional', 'codigo', p.codigo, 'slug', p.slug, 'subdominio', null,
    'nome', p.name, 'foto', p.photo_url, 'especialidade', p.especialidade, 'profissional_id', p.id, 'salao', base);
end;
$$;
revoke execute on function public.pagina_da_profissional(text) from public;
grant execute on function public.pagina_da_profissional(text) to anon, authenticated;

do $$ begin raise notice '266: página da profissional dentro do salão (sem contato pessoal, telefone da cliente por permissão, link de quem saiu, pagina_da_profissional)'; end $$;
