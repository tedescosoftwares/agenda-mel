-- 082 · Categorias de serviço
--
-- Um salão com 300 serviços vira bagunça numa lista só. Cada serviço
-- entra numa categoria: a plataforma já traz as comuns (Cabelo, Unhas,
-- Sobrancelhas e cílios…) e cada salão pode criar as suas. O que não
-- tiver categoria cai em "Outros".
--
-- O que muda:
--   categorias_de_servico     salon_id nulo = da plataforma; preenchido = do salão
--   services.categoria_id     a categoria do serviço
--   categoria_sugerida(nome)  chuta a categoria pelo nome (só quando ninguém escolheu)
--   trigger classifica_servico
--
-- Quem mexe: a dona/admins do salão nas categorias do salão (direto na
-- tabela, por RLS); a plataforma nas pré-definidas. Todo mundo lê.

create table if not exists public.categorias_de_servico (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons (id) on delete cascade,
  nome text not null check (btrim(nome) <> '' and length(nome) <= 40),
  ordem integer not null default 100,
  criada_em timestamptz not null default now()
);
create unique index if not exists categorias_de_servico_nome_idx
  on public.categorias_de_servico (coalesce(salon_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nome)));
create index if not exists categorias_de_servico_salao_idx on public.categorias_de_servico (salon_id);

alter table public.categorias_de_servico enable row level security;
drop policy if exists "categorias sao publicas" on public.categorias_de_servico;
create policy "categorias sao publicas" on public.categorias_de_servico
  for select to anon, authenticated using (true);
drop policy if exists "salao cria categoria" on public.categorias_de_servico;
create policy "salao cria categoria" on public.categorias_de_servico
  for insert to authenticated
  with check ((salon_id is not null and public.is_admin_do_salao(salon_id)) or (salon_id is null and public.eh_plataforma()));
drop policy if exists "salao muda categoria" on public.categorias_de_servico;
create policy "salao muda categoria" on public.categorias_de_servico
  for update to authenticated
  using ((salon_id is not null and public.is_admin_do_salao(salon_id)) or (salon_id is null and public.eh_plataforma()))
  with check ((salon_id is not null and public.is_admin_do_salao(salon_id)) or (salon_id is null and public.eh_plataforma()));
drop policy if exists "salao apaga categoria" on public.categorias_de_servico;
create policy "salao apaga categoria" on public.categorias_de_servico
  for delete to authenticated
  using ((salon_id is not null and public.is_admin_do_salao(salon_id)) or (salon_id is null and public.eh_plataforma()));
grant select on public.categorias_de_servico to anon, authenticated;
grant insert, update, delete on public.categorias_de_servico to authenticated;

-- as pré-definidas (a ordem é a ordem em que aparecem)
insert into public.categorias_de_servico (salon_id, nome, ordem)
select null, x.nome, x.ordem from (values
  ('Cabelo', 10), ('Unhas', 20), ('Sobrancelhas e cílios', 30), ('Rosto', 40), ('Corpo', 50),
  ('Depilação', 60), ('Maquiagem', 70), ('Massagem e bem-estar', 80), ('Barba', 90), ('Outros', 999)
) as x (nome, ordem)
where not exists (select 1 from public.categorias_de_servico c where c.salon_id is null and lower(c.nome) = lower(x.nome));

alter table public.services add column if not exists categoria_id uuid references public.categorias_de_servico (id) on delete set null;
create index if not exists services_categoria_idx on public.services (categoria_id);

-- chute pelo nome, para o serviço já cadastrado e para quem não escolher
create or replace function public.categoria_sugerida(nome text)
returns uuid
language sql
stable
as $$
  with n as (select lower(coalesce(nome, '')) as t)
  select c.id from public.categorias_de_servico c, n
  where c.salon_id is null and lower(c.nome) = (
    case
      when n.t ~ '(barba|bigode)' then 'barba'
      when n.t ~ '(sobrancelha|c[ií]lio|lash|brow|micropigmenta)' then 'sobrancelhas e cílios'
      when n.t ~ '(manicure|pedicure|unha|esmalt|gel|alongamento de unha|fibra|spa dos p[ée]s|p[ée]s|m[ãa]os)' then 'unhas'
      when n.t ~ '(cabelo|corte|escova|hidrata|progressiva|colora|mecha|luzes|tintura|penteado|tran[çc]a|botox capilar|cauteriza|reconstru|selagem|alisamento|franja|ondula|cachos)' then 'cabelo'
      when n.t ~ '(depila|laser|cera)' then 'depilação'
      when n.t ~ '(maquiagem|make)' then 'maquiagem'
      when n.t ~ '(massagem|relaxante|drenagem|reflexo|spa |bem-estar|ventosa|pedras)' then 'massagem e bem-estar'
      when n.t ~ '(limpeza de pele|facial|peeling|pele|rosto|dermaplan|microagulh|skincare|acne)' then 'rosto'
      when n.t ~ '(corporal|corpo|modeladora|gordura|celulite|bronze|estria|flacidez)' then 'corpo'
      else 'outros'
    end)
  limit 1;
$$;

create or replace function public.classifica_servico()
returns trigger
language plpgsql
as $$
begin
  if new.categoria_id is null then
    new.categoria_id := public.categoria_sugerida(new.name);
  end if;
  return new;
end;
$$;
drop trigger if exists classifica_servico on public.services;
create trigger classifica_servico before insert or update of name, categoria_id on public.services
  for each row execute function public.classifica_servico();

-- os já cadastrados
update public.services set categoria_id = public.categoria_sugerida(name) where categoria_id is null;
