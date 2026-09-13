-- 087 · Capas de categoria
--
-- Cada categoria tem uma imagem larga que vira o cabeçalho do cartão da
-- categoria na página do salão (estilo iFood). A plataforma define a
-- padrão em categorias_de_servico.imagem_url; o salão pode trocar a
-- dele em capas_de_categoria (vale para qualquer categoria, da
-- plataforma ou própria). Sem imagem, o app desenha um gradiente.

alter table public.categorias_de_servico add column if not exists imagem_url text;

create table if not exists public.capas_de_categoria (
  salon_id uuid not null references public.salons (id) on delete cascade,
  categoria_id uuid not null references public.categorias_de_servico (id) on delete cascade,
  imagem_url text not null,
  primary key (salon_id, categoria_id)
);
alter table public.capas_de_categoria enable row level security;
drop policy if exists "capas sao publicas" on public.capas_de_categoria;
create policy "capas sao publicas" on public.capas_de_categoria for select to anon, authenticated using (true);
drop policy if exists "salao poe capa" on public.capas_de_categoria;
create policy "salao poe capa" on public.capas_de_categoria for insert to authenticated with check (public.is_admin_do_salao(salon_id));
drop policy if exists "salao troca capa" on public.capas_de_categoria;
create policy "salao troca capa" on public.capas_de_categoria for update to authenticated using (public.is_admin_do_salao(salon_id)) with check (public.is_admin_do_salao(salon_id));
drop policy if exists "salao tira capa" on public.capas_de_categoria;
create policy "salao tira capa" on public.capas_de_categoria for delete to authenticated using (public.is_admin_do_salao(salon_id));
grant select on public.capas_de_categoria to anon, authenticated;
grant insert, update, delete on public.capas_de_categoria to authenticated;

-- a página do salão entrega as capas resolvidas (a do salão, senão a padrão)
-- (o 088 muda o retorno: por isso o drop)
drop function if exists public.capas_do_salao(uuid);
create function public.capas_do_salao(salao uuid)
returns table (categoria_id uuid, imagem_url text)
language sql
stable
security definer set search_path = public
as $$
  select c.id, coalesce(k.imagem_url, c.imagem_url)
  from public.categorias_de_servico c
  left join public.capas_de_categoria k on k.categoria_id = c.id and k.salon_id = salao
  where (c.salon_id is null or c.salon_id = salao)
    and coalesce(k.imagem_url, c.imagem_url) is not null;
$$;
grant execute on function public.capas_do_salao(uuid) to anon, authenticated;

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
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name) order by p.name), '[]'::jsonb)
                   from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'capas', (select coalesce(jsonb_object_agg(k.categoria_id, k.imagem_url), '{}'::jsonb) from public.capas_do_salao(salao) k),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
