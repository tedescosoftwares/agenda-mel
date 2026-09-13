-- 088 · Capas em carrossel e profissional de preferência
--
-- 1. A capa da categoria vira um conjunto de até 10 imagens: no cartão
--    da página do salão elas rodam, e o toque abre a página da
--    categoria com os serviços.
-- 2. A cliente pode ter uma profissional de preferência em cada salão.
--    Quando mais de uma faz o mesmo serviço, o app já leva para a
--    preferida. Muito salão trabalha assim ("agenda da Ana").

alter table public.capas_de_categoria add column if not exists imagens text[] not null default '{}';
update public.capas_de_categoria set imagens = array[imagem_url] where cardinality(imagens) = 0 and imagem_url is not null;
alter table public.capas_de_categoria alter column imagem_url drop not null;
alter table public.capas_de_categoria drop constraint if exists capas_de_categoria_ate_10;
alter table public.capas_de_categoria add constraint capas_de_categoria_ate_10 check (cardinality(imagens) <= 10);

drop function if exists public.capas_do_salao(uuid);
create function public.capas_do_salao(salao uuid)
returns table (categoria_id uuid, imagens text[])
language sql
stable
security definer set search_path = public
as $$
  select c.id,
         case when k.imagens is not null and cardinality(k.imagens) > 0 then k.imagens
              when c.imagem_url is not null then array[c.imagem_url]
              else '{}'::text[] end
  from public.categorias_de_servico c
  left join public.capas_de_categoria k on k.categoria_id = c.id and k.salon_id = salao
  where (c.salon_id is null or c.salon_id = salao)
    and ((k.imagens is not null and cardinality(k.imagens) > 0) or c.imagem_url is not null);
$$;
grant execute on function public.capas_do_salao(uuid) to anon, authenticated;

-- a preferida da cliente em cada salão
create table if not exists public.profissional_preferida (
  client_id uuid not null references public.profiles (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (client_id, salon_id)
);
alter table public.profissional_preferida enable row level security;
drop policy if exists "cliente ve a preferida dela" on public.profissional_preferida;
create policy "cliente ve a preferida dela" on public.profissional_preferida for select to authenticated
  using (client_id = auth.uid() or public.is_admin_do_salao(salon_id) or public.is_professional(professional_id));
drop policy if exists "cliente escolhe a preferida" on public.profissional_preferida;
create policy "cliente escolhe a preferida" on public.profissional_preferida for insert to authenticated with check (client_id = auth.uid());
drop policy if exists "cliente troca a preferida" on public.profissional_preferida;
create policy "cliente troca a preferida" on public.profissional_preferida for update to authenticated using (client_id = auth.uid()) with check (client_id = auth.uid());
drop policy if exists "cliente desfaz a preferida" on public.profissional_preferida;
create policy "cliente desfaz a preferida" on public.profissional_preferida for delete to authenticated using (client_id = auth.uid());
grant select, insert, update, delete on public.profissional_preferida to authenticated;

-- a profissional tem de ser do salão
create or replace function public.confere_preferida()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.professionals p where p.id = new.professional_id and p.salon_id = new.salon_id and p.active) then
    raise exception 'Essa profissional não atende nesse salão.';
  end if;
  return new;
end;
$$;
drop trigger if exists confere_preferida on public.profissional_preferida;
create trigger confere_preferida before insert or update on public.profissional_preferida
  for each row execute function public.confere_preferida();

create or replace function public.escolher_preferida(salao uuid, prof uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if prof is null then
    delete from public.profissional_preferida where client_id = auth.uid() and salon_id = salao;
  else
    insert into public.profissional_preferida (client_id, salon_id, professional_id) values (auth.uid(), salao, prof)
    on conflict (client_id, salon_id) do update set professional_id = excluded.professional_id, criado_em = now();
  end if;
end;
$$;
revoke execute on function public.escolher_preferida(uuid, uuid) from public, anon;
grant execute on function public.escolher_preferida(uuid, uuid) to authenticated;

-- a página do salão: capas em lista e a preferida da cliente
create or replace function public.pagina_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', (select jsonb_build_object(
        'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'descricao', s.descricao, 'fotos', to_jsonb(s.fotos), 'logo_url', s.logo_url,
        'endereco', s.address, 'cidade', s.city, 'telefone', s.phone, 'whatsapp', coalesce(s.whatsapp, s.phone), 'instagram', s.instagram)
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
        'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'description', sv.description, 'destaque', sv.destaque,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'foto', p.photo_url) order by p.name), '[]'::jsonb)
                   from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'capas', (select coalesce(jsonb_object_agg(k.categoria_id, to_jsonb(k.imagens)), '{}'::jsonb) from public.capas_do_salao(salao) k),
    'preferida', (select pp.professional_id from public.profissional_preferida pp where pp.client_id = auth.uid() and pp.salon_id = salao),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
