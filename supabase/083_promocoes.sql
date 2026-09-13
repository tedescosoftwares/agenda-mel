-- 083 · Promoções
--
-- Salão, profissional e plataforma sobem um criativo (1200×600, 2:1) com
-- título, texto curto, período e, se quiser, o serviço que ela vai
-- marcar ao tocar. A cliente vê, na home, um carrossel só com as
-- promoções de quem ela tem na carteira:
--   · da plataforma (salon_id nulo): todo mundo
--   · do salão (professional_id nulo): quem tem vínculo com o salão ou
--     já marcou/favoritou alguém de lá
--   · de uma profissional: quem já marcou ou favoritou ela, ou entrou
--     no salão pelo código dela
--
-- O que muda:
--   promocoes, bucket 'promocoes'
--   pode_mexer_promocao(salao, prof)     quem cria/edita/apaga
--   promocoes_para_mim()                 o carrossel da cliente
--   promocao_vista(ids), promocao_clicada(id)   contadores

create table if not exists public.promocoes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  titulo text not null check (length(btrim(titulo)) between 1 and 60),
  texto text check (texto is null or length(texto) <= 140),
  imagem_url text not null,
  inicio date not null default (public.agora_local())::date,
  fim date check (fim is null or fim >= inicio),
  ativa boolean not null default true,
  vistas integer not null default 0,
  cliques integer not null default 0,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (professional_id is null or salon_id is not null)
);
create index if not exists promocoes_salao_idx on public.promocoes (salon_id) where ativa;
create index if not exists promocoes_prof_idx on public.promocoes (professional_id) where ativa;

-- quem pode mexer: a plataforma em tudo; a dona/admins do salão nas do
-- salão e das profissionais dele; a profissional nas dela
create or replace function public.pode_mexer_promocao(salao uuid, prof uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.eh_plataforma()
      or (salao is not null and public.is_admin_do_salao(salao))
      or (prof is not null and public.is_professional(prof));
$$;
revoke execute on function public.pode_mexer_promocao(uuid, uuid) from public, anon;
grant execute on function public.pode_mexer_promocao(uuid, uuid) to authenticated;

alter table public.promocoes enable row level security;
drop policy if exists "promocoes sao publicas" on public.promocoes;
create policy "promocoes sao publicas" on public.promocoes for select to anon, authenticated using (true);
drop policy if exists "quem cuida cria promocao" on public.promocoes;
create policy "quem cuida cria promocao" on public.promocoes for insert to authenticated
  with check (public.pode_mexer_promocao(salon_id, professional_id));
drop policy if exists "quem cuida muda promocao" on public.promocoes;
create policy "quem cuida muda promocao" on public.promocoes for update to authenticated
  using (public.pode_mexer_promocao(salon_id, professional_id))
  with check (public.pode_mexer_promocao(salon_id, professional_id));
drop policy if exists "quem cuida apaga promocao" on public.promocoes;
create policy "quem cuida apaga promocao" on public.promocoes for delete to authenticated
  using (public.pode_mexer_promocao(salon_id, professional_id));
grant select on public.promocoes to anon, authenticated;
grant insert, update, delete on public.promocoes to authenticated;

-- a promoção de uma profissional é do salão dela; o serviço tem de ser do salão
create or replace function public.confere_promocao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.professional_id is not null then
    select p.salon_id into new.salon_id from public.professionals p where p.id = new.professional_id;
  end if;
  if new.service_id is not null and (new.salon_id is null
     or not exists (select 1 from public.services s where s.id = new.service_id and s.salon_id = new.salon_id)) then
    new.service_id := null;
  end if;
  new.titulo := btrim(new.titulo);
  new.texto := nullif(btrim(coalesce(new.texto, '')), '');
  return new;
end;
$$;
drop trigger if exists confere_promocao on public.promocoes;
create trigger confere_promocao before insert or update on public.promocoes
  for each row execute function public.confere_promocao();

-- o bucket dos criativos
insert into storage.buckets (id, name, public) values ('promocoes', 'promocoes', true) on conflict (id) do nothing;
drop policy if exists "criativos sao publicos" on storage.objects;
create policy "criativos sao publicos" on storage.objects for select using (bucket_id = 'promocoes');
drop policy if exists "quem atende envia criativo" on storage.objects;
create policy "quem atende envia criativo" on storage.objects for insert to authenticated
  with check (bucket_id = 'promocoes' and (public.eh_plataforma() or public.is_admin()
              or exists (select 1 from public.professionals p where p.user_id = auth.uid())));
drop policy if exists "quem atende troca criativo" on storage.objects;
create policy "quem atende troca criativo" on storage.objects for update to authenticated
  using (bucket_id = 'promocoes' and (public.eh_plataforma() or public.is_admin()
         or exists (select 1 from public.professionals p where p.user_id = auth.uid())));
drop policy if exists "quem atende remove criativo" on storage.objects;
create policy "quem atende remove criativo" on storage.objects for delete to authenticated
  using (bucket_id = 'promocoes' and (public.eh_plataforma() or public.is_admin()
         or exists (select 1 from public.professionals p where p.user_id = auth.uid())));

-- o carrossel da cliente
create or replace function public.promocoes_para_mim()
returns table (
  id uuid, titulo text, texto text, imagem_url text,
  salon_id uuid, salao text, professional_id uuid, profissional text, service_id uuid, servico text,
  fim date
)
language sql
stable
security definer set search_path = public
as $$
  with minhas_profs as (
    select f.professional_id from public.client_favorites f where f.client_id = auth.uid()
    union
    select a.professional_id from public.appointments a where a.client_id = auth.uid() and a.professional_id is not null
    union
    select v.trazida_por from public.vinculos v where v.client_id = auth.uid() and v.saiu_em is null and v.trazida_por is not null
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v where v.client_id = auth.uid() and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id
  ),
  hoje as (select (public.agora_local())::date as d)
  select pr.id, pr.titulo, pr.texto, pr.imagem_url,
         pr.salon_id, s.name,
         coalesce(pr.professional_id,
                  (select ps.professional_id from public.professional_services ps
                     join public.professionals p2 on p2.id = ps.professional_id and p2.active and p2.salon_id = pr.salon_id
                    where ps.service_id = pr.service_id
                    order by (ps.professional_id in (select professional_id from minhas_profs)) desc, p2.name limit 1)),
         p.name, pr.service_id, sv.name, pr.fim
  from public.promocoes pr
  cross join hoje
  left join public.salons s on s.id = pr.salon_id
  left join public.professionals p on p.id = pr.professional_id
  left join public.services sv on sv.id = pr.service_id and sv.active
  where auth.uid() is not null
    and pr.ativa and pr.inicio <= hoje.d and (pr.fim is null or pr.fim >= hoje.d)
    and (p.id is null or p.active)
    and (pr.salon_id is null
         or (pr.professional_id is not null and pr.professional_id in (select professional_id from minhas_profs))
         or (pr.professional_id is null and pr.salon_id in (select salon_id from meus_saloes)))
  order by (pr.professional_id is not null) desc, (pr.salon_id is not null) desc, pr.created_at desc
  limit 12;
$$;
revoke execute on function public.promocoes_para_mim() from public, anon;
grant execute on function public.promocoes_para_mim() to authenticated;

create or replace function public.promocao_vista(ids uuid[])
returns void
language sql
security definer set search_path = public
as $$
  update public.promocoes set vistas = vistas + 1 where id = any (coalesce(ids, '{}')) and auth.uid() is not null;
$$;
revoke execute on function public.promocao_vista(uuid[]) from public, anon;
grant execute on function public.promocao_vista(uuid[]) to authenticated;

create or replace function public.promocao_clicada(promo uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.promocoes set cliques = cliques + 1 where id = promo and auth.uid() is not null;
$$;
revoke execute on function public.promocao_clicada(uuid) from public, anon;
grant execute on function public.promocao_clicada(uuid) to authenticated;
