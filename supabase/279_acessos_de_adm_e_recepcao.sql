-- 279 · Acessos ao painel: administração e recepção (4.51)
--
-- Até aqui só a dona entrava no painel do salão. Agora ela convida, em Equipe › Acessos ao painel:
--   • Administração: vê e faz tudo o que ela faz (menos transferir o salão);
--   • Recepção: agenda de todas, clientes, encaixe, comanda e fechar o dia. Não mexe em equipe, serviços, plano,
--     financeiro nem configurações.
-- Nenhum dos dois tem agenda própria, então não conta como agenda do plano. São 3 acessos por salão
-- (salons.acessos_painel_max; o suporte aumenta). Quem atende continua sendo profissional, na Equipe.
--
-- Como é guardado: salon_members.papel ganha 'recepcao' (o 'admin' já existia). A recepção passa pelas mesmas
-- funções do painel (agenda, comanda, clientes), e o que ela não pode mudar é barrado por gatilho nas tabelas
-- (equipe, serviços, acessos, cobranças), valha o caminho que for. As telas de números e financeiro ficam fora do
-- menu dela; a leitura desses números ainda não é barrada no banco (fica para a próxima etapa).

alter table public.salon_members drop constraint if exists salon_members_papel_check;
alter table public.salon_members add constraint salon_members_papel_check check (papel in ('admin', 'profissional', 'recepcao'));
alter table public.salons add column if not exists acessos_painel_max integer not null default 3;

create table if not exists public.acessos_painel (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  papel text not null check (papel in ('admin', 'recepcao')),
  nome text not null,
  email text not null,
  telefone text,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  user_id uuid,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  usado_em timestamptz
);
create unique index if not exists acessos_painel_um_por_email on public.acessos_painel (salon_id, lower(email));
alter table public.acessos_painel enable row level security;
revoke all on public.acessos_painel from public, anon, authenticated;

-- a recepção também abre o painel (as funções da agenda, da comanda e das clientes perguntam por aqui)
create or replace function public.meus_saloes()
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  select salon_id from public.salon_members
  where user_id = auth.uid() and papel in ('admin', 'recepcao')
  union
  select id from public.salons where owner_id = auth.uid();
$$;
grant execute on function public.meus_saloes() to authenticated;

create or replace function public.papel_no_salao(salao uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.salons s where s.id = salao and s.owner_id = auth.uid()) then 'dona'
    else (select m.papel from public.salon_members m where m.salon_id = salao and m.user_id = auth.uid() and m.papel in ('admin', 'recepcao') limit 1)
  end;
$$;
revoke execute on function public.papel_no_salao(uuid) from public, anon;
grant execute on function public.papel_no_salao(uuid) to authenticated;

create or replace function public.manda_no_salao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$ select coalesce(public.papel_no_salao(salao) in ('dona', 'admin'), false) or public.eh_plataforma(); $$;
revoke execute on function public.manda_no_salao(uuid) from public, anon;
grant execute on function public.manda_no_salao(uuid) to authenticated;

-- o que a recepção não muda, por onde quer que venha
create or replace function public.tg_recepcao_nao_mexe()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare salao uuid := case when tg_op = 'DELETE' then old.salon_id else new.salon_id end;
begin
  if auth.uid() is not null
     and exists (select 1 from public.salon_members m where m.salon_id = salao and m.user_id = auth.uid() and m.papel = 'recepcao')
     and not exists (select 1 from public.salons s where s.id = salao and s.owner_id = auth.uid()) then
    raise exception 'O acesso de recepção não muda isso. Fale com quem administra o salão.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.tg_recepcao_nao_mexe() from public, anon, authenticated;

drop trigger if exists aa_recepcao_nao_mexe on public.salon_members;
create trigger aa_recepcao_nao_mexe before insert or update or delete on public.salon_members for each row execute function public.tg_recepcao_nao_mexe();
drop trigger if exists aa_recepcao_nao_mexe on public.acessos_painel;
create trigger aa_recepcao_nao_mexe before insert or update or delete on public.acessos_painel for each row execute function public.tg_recepcao_nao_mexe();
drop trigger if exists aa_recepcao_nao_mexe on public.services;
create trigger aa_recepcao_nao_mexe before insert or update or delete on public.services for each row execute function public.tg_recepcao_nao_mexe();
drop trigger if exists aa_recepcao_nao_mexe on public.professionals;
create trigger aa_recepcao_nao_mexe before insert or delete on public.professionals for each row execute function public.tg_recepcao_nao_mexe();
drop trigger if exists aa_recepcao_nao_mexe on public.cobrancas_mimo;
create trigger aa_recepcao_nao_mexe before insert on public.cobrancas_mimo for each row execute function public.tg_recepcao_nao_mexe();
drop trigger if exists aa_recepcao_nao_mexe on public.agendas_compras;
create trigger aa_recepcao_nao_mexe before insert on public.agendas_compras for each row execute function public.tg_recepcao_nao_mexe();

-- a lista da tela: quem já entrou e quem ainda não abriu o convite
create or replace function public.acessos_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.manda_no_salao(salao) then raise exception 'Só quem administra o salão vê os acessos.'; end if;
  return jsonb_build_object(
    'limite', (select s.acessos_painel_max from public.salons s where s.id = salao),
    'lista', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'papel', a.papel, 'nome', a.nome, 'email', a.email, 'telefone', a.telefone,
                 'ativo', a.user_id is not null, 'token', case when a.user_id is null then a.token end, 'criado_em', a.criado_em, 'usado_em', a.usado_em) order by a.criado_em)
               from public.acessos_painel a where a.salon_id = salao), '[]'::jsonb));
end;
$$;
revoke execute on function public.acessos_do_salao(uuid) from public, anon;
grant execute on function public.acessos_do_salao(uuid) to authenticated;

create or replace function public.acesso_painel_criar(salao uuid, papel_ text, nome_ text, email_ text, telefone_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; em text := lower(btrim(coalesce(email_, ''))); nm text := btrim(coalesce(nome_, '')); a public.acessos_painel%rowtype; quantos integer;
begin
  if not public.manda_no_salao(salao) then raise exception 'Só quem administra o salão cria acessos.'; end if;
  if papel_ not in ('admin', 'recepcao') then raise exception 'Escolha administração ou recepção.'; end if;
  if length(nm) < 3 or position(' ' in nm) = 0 then raise exception 'Diga o nome e o sobrenome.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Confira o e-mail.'; end if;
  select * into s from public.salons where id = salao;
  if exists (select 1 from auth.users u where u.id = s.owner_id and lower(u.email) = em) then raise exception 'Esse e-mail é o da dona do salão: ela já tem acesso a tudo.'; end if;
  select * into a from public.acessos_painel x where x.salon_id = salao and lower(x.email) = em;
  if a.id is not null then
    if a.user_id is not null then raise exception 'Esse e-mail já tem acesso ao painel. Para mudar o tipo, tire o acesso e crie outro.'; end if;
    update public.acessos_painel set papel = papel_, nome = nm, telefone = nullif(btrim(coalesce(telefone_, '')), '') where id = a.id returning * into a;
  else
    select count(*) into quantos from public.acessos_painel x where x.salon_id = salao;
    if quantos >= coalesce(s.acessos_painel_max, 3) then
      raise exception 'Seu salão já usa os % acessos ao painel. Precisa de mais? Fale com o suporte.', coalesce(s.acessos_painel_max, 3);
    end if;
    insert into public.acessos_painel (salon_id, papel, nome, email, telefone, criado_por)
    values (salao, papel_, nm, em, nullif(btrim(coalesce(telefone_, '')), ''), auth.uid()) returning * into a;
  end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'token', a.token, 'papel', a.papel, 'nome', a.nome, 'email', a.email, 'telefone', a.telefone);
end;
$$;
revoke execute on function public.acesso_painel_criar(uuid, text, text, text, text) from public, anon;
grant execute on function public.acesso_painel_criar(uuid, text, text, text, text) to authenticated;

create or replace function public.acesso_painel_tirar(id_ uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.acessos_painel%rowtype;
begin
  select * into a from public.acessos_painel where id = id_;
  if a.id is null or not public.manda_no_salao(a.salon_id) then raise exception 'Acesso não encontrado.'; end if;
  if a.user_id is not null then
    delete from public.salon_members m where m.salon_id = a.salon_id and m.user_id = a.user_id and m.papel in ('admin', 'recepcao')
       and not exists (select 1 from public.salons s where s.id = a.salon_id and s.owner_id = a.user_id);
    -- sem nenhum outro painel para abrir, a conta volta a ser de cliente
    update public.profiles p set role = 'cliente'
     where p.id = a.user_id and p.role = 'admin'
       and not exists (select 1 from public.salons s where s.owner_id = a.user_id)
       and not exists (select 1 from public.salon_members m where m.user_id = a.user_id and m.papel in ('admin', 'recepcao'));
  end if;
  delete from public.acessos_painel where id = a.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.acesso_painel_tirar(uuid) from public, anon;
grant execute on function public.acesso_painel_tirar(uuid) to authenticated;

-- quem abre o link vê de quem é o convite (só o necessário)
create or replace function public.acesso_painel_ver(token_ text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object('salao', jsonb_build_object('nome', s.name, 'logo_url', s.logo_url, 'cidade', s.city),
           'papel', a.papel, 'nome', a.nome, 'email', a.email, 'usado', a.user_id is not null)
    from public.acessos_painel a join public.salons s on s.id = a.salon_id
   where a.token = lower(btrim(token_));
$$;
revoke execute on function public.acesso_painel_ver(text) from public;
grant execute on function public.acesso_painel_ver(text) to anon, authenticated;

create or replace function public.acesso_painel_ativar_interno(conta uuid, token_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.acessos_painel%rowtype; s public.salons%rowtype; em text; papel_atual text;
begin
  select * into a from public.acessos_painel where token = lower(btrim(token_)) for update;
  if a.id is null then raise exception 'Convite não encontrado. Confira o link com o salão.'; end if;
  select * into s from public.salons where id = a.salon_id;
  if a.user_id is not null then
    if a.user_id = conta then return jsonb_build_object('ok', true, 'ja', true, 'salao', s.name, 'papel', a.papel); end if;
    raise exception 'Esse convite já foi usado. Entre com a sua conta.';
  end if;
  select lower(u.email) into em from auth.users u where u.id = conta;
  if em is distinct from lower(a.email) then raise exception 'Esse convite é para %. Entre com a conta desse e-mail.', a.email; end if;
  select role into papel_atual from public.profiles where id = conta;
  if papel_atual = 'profissional' then raise exception 'Essa conta já é de profissional. Para o acesso ao painel, peça o convite em outro e-mail.'; end if;
  if papel_atual = 'plataforma' then raise exception 'Essa conta é da plataforma.'; end if;
  insert into public.salon_members (salon_id, user_id, papel) values (a.salon_id, conta, a.papel)
  on conflict (salon_id, user_id) do update set papel = excluded.papel;
  update public.profiles set role = 'admin', full_name = coalesce(nullif(btrim(coalesce(full_name, '')), ''), a.nome) where id = conta and role in ('cliente', 'admin');
  update public.acessos_painel set user_id = conta, usado_em = now() where id = a.id;
  return jsonb_build_object('ok', true, 'salao', s.name, 'salao_id', s.id, 'papel', a.papel);
end;
$$;
revoke execute on function public.acesso_painel_ativar_interno(uuid, text) from public, anon, authenticated;

create or replace function public.acesso_painel_ativar(token_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  return public.acesso_painel_ativar_interno(auth.uid(), token_);
end;
$$;
revoke execute on function public.acesso_painel_ativar(text) from public, anon;
grant execute on function public.acesso_painel_ativar(text) to authenticated;

notify pgrst, 'reload schema';
