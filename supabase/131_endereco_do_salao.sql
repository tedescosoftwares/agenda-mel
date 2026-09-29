-- 131: endereço próprio do salão (2.80)
--
-- O salão assinante ganha um subdomínio: studiomel.mimo.com.vc abre a
-- página da casa, studiomel.mimo.com.vc/ana-oliveira abre a vitrine da
-- profissional. O /v/CÓDIGO impresso e o /p/<slug> continuam valendo
-- para sempre. A autônoma segue com mimo.com.vc/p/<slug>: o endereço
-- próprio é da assinatura, não vem de graça.
--
--   • salons.subdominio              o nome escolhido (único, minúsculo)
--   • subdominios_reservados         www, pro, api… ninguém pega
--   • subdominios_antigos            quem trocou: o antigo redireciona
--   • subdominio_disponivel(nome)    checagem ao vivo enquanto digita
--   • subdominio_definir(salao, n)   só a dona, só com assinatura ativa
--   • resolver_endereco(nome, prof)  o que o app pergunta ao abrir
--
-- Fora do banco: registro A curinga *.mimo.com.vc na Cloudflare, o token
-- de DNS no .env da VPS (CLOUDFLARE_API_TOKEN) e o bloco do Caddy.

alter table public.salons add column if not exists subdominio text;
alter table public.salons drop constraint if exists salons_subdominio_check;
alter table public.salons add constraint salons_subdominio_check
  check (subdominio is null or subdominio ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$');
create unique index if not exists salons_subdominio_idx on public.salons (subdominio) where subdominio is not null;
grant select (subdominio) on public.salons to authenticated;
comment on column public.salons.subdominio is 'endereço próprio: <subdominio>.mimo.com.vc (só assinante)';

create table if not exists public.subdominios_reservados (
  nome text primary key,
  motivo text
);
alter table public.subdominios_reservados enable row level security;
insert into public.subdominios_reservados (nome, motivo) values
  ('www', 'site'), ('pro', 'painel'), ('api', 'infra'), ('app', 'infra'), ('mail', 'e-mail'),
  ('smtp', 'e-mail'), ('imap', 'e-mail'), ('pop', 'e-mail'), ('pop3', 'e-mail'), ('email', 'e-mail'),
  ('webmail', 'e-mail'), ('mx', 'e-mail'), ('ns', 'infra'), ('ns1', 'infra'), ('ns2', 'infra'),
  ('ftp', 'infra'), ('sftp', 'infra'), ('ssh', 'infra'), ('vpn', 'infra'), ('cdn', 'infra'),
  ('static', 'infra'), ('assets', 'infra'), ('img', 'infra'), ('imagens', 'infra'), ('media', 'infra'),
  ('autoconfig', 'e-mail'), ('autodiscover', 'e-mail'), ('dev', 'infra'), ('teste', 'infra'),
  ('staging', 'infra'), ('homolog', 'infra'), ('status', 'infra'), ('docs', 'site'), ('ajuda', 'site'),
  ('suporte', 'site'), ('help', 'site'), ('blog', 'site'), ('mimo', 'marca'), ('mimoapp', 'marca'),
  ('admin', 'painel'), ('painel', 'painel'), ('plataforma', 'painel'), ('cliente', 'app'),
  ('clientes', 'app'), ('agenda', 'app'), ('login', 'app'), ('entrar', 'app'), ('cadastro', 'app'),
  ('conta', 'app'), ('pagamento', 'app'), ('pagamentos', 'app'), ('pix', 'app'), ('cobranca', 'app'),
  ('evolution', 'infra'), ('manager', 'infra'), ('ia', 'infra'), ('m', 'site'), ('mobile', 'site'),
  ('news', 'site'), ('loja', 'site'), ('shop', 'site'), ('contato', 'site'), ('sobre', 'site'),
  ('planos', 'site'), ('termos', 'site'), ('privacidade', 'site'), ('lgpd', 'site'), ('afiliados', 'site'),
  ('parceiros', 'site'), ('salao', 'marca'), ('saloes', 'marca'), ('profissional', 'marca'),
  ('profissionais', 'marca'), ('autonoma', 'marca'), ('beta', 'infra'), ('demo', 'infra'),
  ('sandbox', 'infra'), ('secure', 'infra'), ('auth', 'infra'), ('oauth', 'infra'), ('sso', 'infra'),
  ('null', 'esquisito'), ('undefined', 'esquisito'), ('localhost', 'esquisito'), ('sexo', 'feio'),
  ('porno', 'feio'), ('puta', 'feio'), ('xxx', 'feio')
on conflict (nome) do nothing;

create table if not exists public.subdominios_antigos (
  subdominio text primary key,
  salon_id uuid not null references public.salons (id) on delete cascade,
  trocado_em timestamptz not null default now()
);
alter table public.subdominios_antigos enable row level security;
create index if not exists subdominios_antigos_salao_idx on public.subdominios_antigos (salon_id);

-- ---------------------------------------------------------------------------
-- O nome limpo e a checagem
-- ---------------------------------------------------------------------------
create or replace function public.subdominio_limpar(texto text)
returns text
language sql
immutable
as $$
  select left(public.slug_de(texto), 40);
$$;

-- {ok, nome} ou {ok:false, nome, motivo}. `salao` (opcional) deixa passar o
-- nome que já é do próprio salão.
create or replace function public.subdominio_disponivel(nome text, salao uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  n text := public.subdominio_limpar(nome);
  dono uuid;
begin
  if n is null or length(n) < 3 then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Use pelo menos 3 letras ou números.');
  end if;
  if n !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Só letras, números e hífen no meio.');
  end if;
  if exists (select 1 from public.subdominios_reservados r where r.nome = n) then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Esse nome é reservado.');
  end if;
  select s.id into dono from public.salons s where s.subdominio = n;
  if dono is not null and dono is distinct from salao then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Já tem salão com esse endereço.');
  end if;
  select a.salon_id into dono from public.subdominios_antigos a where a.subdominio = n;
  if dono is not null and dono is distinct from salao then
    return jsonb_build_object('ok', false, 'nome', n, 'motivo', 'Esse endereço já foi usado por outro salão.');
  end if;
  return jsonb_build_object('ok', true, 'nome', n);
end;
$$;
grant execute on function public.subdominio_disponivel(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Definir (ou trocar). Só a dona, só salão (não autônoma), só assinatura ativa.
-- O endereço antigo passa a redirecionar para o novo.
-- ---------------------------------------------------------------------------
create or replace function public.subdominio_definir(salao uuid, nome text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  chk jsonb;
  n text;
  fase text;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona muda o endereço do salão.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'O endereço próprio é para salão. A autônoma usa o link mimo.com.vc/p/…'; end if;
  fase := coalesce(public.acesso_do_salao(salao) ->> 'fase', '');
  if fase <> 'ativa' and not public.eh_plataforma() then
    raise exception 'O endereço próprio faz parte da assinatura. Assine para escolher o seu.';
  end if;
  chk := public.subdominio_disponivel(nome, salao);
  if not (chk ->> 'ok')::boolean then raise exception '%', chk ->> 'motivo'; end if;
  n := chk ->> 'nome';
  if s.subdominio = n then
    return jsonb_build_object('ok', true, 'subdominio', n, 'mudou', false);
  end if;
  -- reclamando um antigo seu: sai da lista de antigos
  delete from public.subdominios_antigos where subdominio = n and salon_id = salao;
  if s.subdominio is not null then
    insert into public.subdominios_antigos (subdominio, salon_id) values (s.subdominio, salao)
    on conflict (subdominio) do update set salon_id = excluded.salon_id, trocado_em = now();
  end if;
  update public.salons set subdominio = n where id = salao;
  return jsonb_build_object('ok', true, 'subdominio', n, 'mudou', true, 'antigo', s.subdominio);
end;
$$;
revoke execute on function public.subdominio_definir(uuid, text) from public, anon;
grant execute on function public.subdominio_definir(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- O que o app pergunta ao abrir <nome>.mimo.com.vc[/<prof>]
--   null                             não existe
--   {redirecionar: 'novo'}           endereço antigo: vai para o novo
--   {tipo:'indisponivel', nome}      salão pausado (assinatura parada)
--   {tipo:'salao', codigo, …}        igual ao resolver_codigo do salão
--   {tipo:'profissional', slug, …}   igual ao resolver_codigo da profissional
-- ---------------------------------------------------------------------------
create or replace function public.resolver_endereco(nome text, prof text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  n text := lower(btrim(coalesce(nome, '')));
  s public.salons%rowtype;
  p public.professionals%rowtype;
  fase text;
  base jsonb;
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
  if nullif(btrim(coalesce(prof, '')), '') is null then
    return jsonb_build_object(
      'tipo', 'salao', 'codigo', s.codigo, 'subdominio', s.subdominio,
      'nome', s.name, 'foto', s.logo_url, 'especialidade', null, 'profissional_id', null,
      'descricao', s.descricao, 'cidade', s.city, 'endereco', s.address,
      'salao', base);
  end if;
  select * into p from public.professionals where salon_id = s.id and slug = lower(btrim(prof)) and active;
  if not found then return null; end if;
  return jsonb_build_object(
    'tipo', 'profissional', 'codigo', p.codigo, 'slug', p.slug, 'subdominio', s.subdominio,
    'nome', p.name, 'foto', p.photo_url, 'especialidade', p.especialidade, 'profissional_id', p.id,
    'salao', base);
end;
$$;
grant execute on function public.resolver_endereco(text, text) to anon, authenticated;
