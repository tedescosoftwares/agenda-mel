-- 100 · Onde fica o salão: CEP e o pino no mapa (latitude e longitude).
--
-- A dona do salão (ou a autônoma, dona do próprio "salão de uma") define
-- o endereço e ajusta o pino no mapa pelo app: pelo CEP, pelo endereço
-- escrito, pela localização do celular dela ou arrastando o pino até a
-- porta. É esse pino que a cliente vê no "Como chegar" e que, quando o
-- MIMO virar vitrine aberta, vai dizer quem está perto de quem.
--
-- Nada aqui calcula distância ainda: é a fundação. A busca por
-- proximidade entra depois, com PostGIS, em cima destas colunas.

-- 1. Colunas ------------------------------------------------------------------------------
alter table public.salons
  add column if not exists cep text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists pino_ajustado_em timestamptz;

comment on column public.salons.cep is 'CEP do endereço, só dígitos (8). Ajuda a achar a coordenada e a preencher o endereço.';
comment on column public.salons.lat is 'Latitude do pino (WGS84). Vai junto com lng: ou os dois, ou nenhum.';
comment on column public.salons.lng is 'Longitude do pino (WGS84).';
comment on column public.salons.pino_ajustado_em is 'Quando a dona confirmou o pino pela última vez (arrastou, usou o GPS ou aceitou a sugestão).';

alter table public.salons drop constraint if exists salons_cep_digitos;
alter table public.salons add constraint salons_cep_digitos check (cep is null or cep ~ '^[0-9]{8}$');
alter table public.salons drop constraint if exists salons_pino_valido;
alter table public.salons add constraint salons_pino_valido check (
  ((lat is null) = (lng is null))
  and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
);

-- a dona edita pela tela (a política "admin edita o salao" já limita a quem manda no salão)
grant update (cep, lat, lng, pino_ajustado_em, address, city) on public.salons to authenticated;

-- 2. A página do salão devolve o pino --------------------------------------------------------
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
        'description', sv.description, 'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'destaque', sv.destaque,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'foto', p.photo_url) order by p.name), '[]'::jsonb)
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

-- 3. A vitrine pública da profissional também --------------------------------------------------
create or replace function public.vitrine_da_profissional(link text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'profissional', jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'bio', p.bio,
      'photo_url', p.photo_url, 'especialidade', p.especialidade,
      'instagram', nullif(ltrim(btrim(p.instagram), '@'), ''),
      'whatsapp', public.telefone_e164(p.whatsapp_publico),
      'aceite_manual', p.aceite_manual),
    'salao', jsonb_build_object(
      'name', s.name, 'city', s.city, 'address', s.address, 'app_url', s.app_url,
      'cep', s.cep, 'lat', s.lat, 'lng', s.lng, 'tipo', s.tipo),
    'nota', (select jsonb_build_object('media', n.media, 'quantas', n.quantas)
             from public.avaliacao_da_profissional(p.id) n),
    'avaliacoes', (select coalesce(jsonb_agg(jsonb_build_object(
                     'nota', a.nota, 'comentario', a.comentario,
                     'quem', a.quem, 'quando', a.quando)), '[]'::jsonb)
                   from public.avaliacoes_da_profissional(p.id, 10) a),
    'galeria', (select coalesce(jsonb_agg(g.img), '[]'::jsonb)
                from (select distinct unnest(sv.images) as img
                      from public.professional_services ps
                      join public.services sv on sv.id = ps.service_id
                      where ps.professional_id = p.id and sv.active
                      limit 8) g),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object(
                   'weekday', h.weekday, 'open', h.open,
                   'inicio', to_char(h.start_time, 'HH24:MI'),
                   'fim', to_char(h.end_time, 'HH24:MI'))
                   order by h.weekday), '[]'::jsonb)
                 from public.professional_hours h where h.professional_id = p.id),
    'atendimentos', (select count(*) from public.appointments a
                     where a.professional_id = p.id and a.status = 'concluido'),
    'proxima_vaga', (select jsonb_build_object(
                       'dia', d.dia,
                       'hora', (select to_char(min(v.hora), 'HH24:MI')
                                from public.horarios_livres(p.id, d.dia, dur.minutos) v))
                     from public.dias_com_vaga(p.id, dur.minutos, 1) d)
  )
  from public.professionals p
  join public.salons s on s.id = p.salon_id
  cross join lateral (
    select coalesce(min(sv.duration_minutes), 30) as minutos
    from public.professional_services ps
    join public.services sv on sv.id = ps.service_id
    where ps.professional_id = p.id and sv.active
  ) dur
  where p.slug = link and p.active;
$$;
grant execute on function public.vitrine_da_profissional(text) to anon, authenticated;
