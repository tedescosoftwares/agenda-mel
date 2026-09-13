-- 085 · A página do salão
--
-- O salão como um todo, não só as profissionais: fotos, descrição,
-- contatos, horário, equipe, serviços e promoções, numa página que a
-- cliente abre no app. A dona preenche em Admin › Ajustes › Página do
-- salão.
--
-- O que muda:
--   salons.descricao, fotos, instagram, whatsapp
--   bucket 'saloes' (fotos e logo)
--   pagina_do_salao(salao)   tudo que a página precisa, numa chamada

alter table public.salons add column if not exists descricao text check (descricao is null or length(descricao) <= 800);
alter table public.salons add column if not exists fotos text[] not null default '{}';
alter table public.salons add column if not exists instagram text check (instagram is null or length(instagram) <= 60);
alter table public.salons add column if not exists whatsapp text check (whatsapp is null or length(whatsapp) <= 30);

insert into storage.buckets (id, name, public) values ('saloes', 'saloes', true) on conflict (id) do nothing;
drop policy if exists "fotos de saloes sao publicas" on storage.objects;
create policy "fotos de saloes sao publicas" on storage.objects for select using (bucket_id = 'saloes');
drop policy if exists "dona envia foto do salao" on storage.objects;
create policy "dona envia foto do salao" on storage.objects for insert to authenticated
  with check (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma()));
drop policy if exists "dona troca foto do salao" on storage.objects;
create policy "dona troca foto do salao" on storage.objects for update to authenticated
  using (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma()));
drop policy if exists "dona remove foto do salao" on storage.objects;
create policy "dona remove foto do salao" on storage.objects for delete to authenticated
  using (bucket_id = 'saloes' and (public.is_admin() or public.eh_plataforma()));

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
        'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'description', sv.description,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name) order by p.name), '[]'::jsonb)
                   from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
revoke execute on function public.pagina_do_salao(uuid) from public;
grant execute on function public.pagina_do_salao(uuid) to anon, authenticated;
