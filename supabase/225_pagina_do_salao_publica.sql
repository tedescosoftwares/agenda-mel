-- 225 · A página do salão aberta a quem visita (3.79)
--
-- O endereço do salão (nome.mimo.com.vc) passa a mostrar a página inteira para quem ainda não tem conta: fotos,
-- serviços com preço, equipe, avaliações, horário, mapa e as promoções da casa. Para falar com o salão ou marcar,
-- ela cria a conta (e entra na agenda do salão pelo código, como no QR). Por isso, aqui:
--   · telefone e WhatsApp do salão só saem para quem está logada (a visitante vê "entre para falar com o salão");
--   · a equipe ganha slug e especialidade (o link da profissional, nome.mimo.com.vc/<slug>, é público);
--   · as avaliações recentes da casa, com o primeiro nome de quem avaliou (como a página da profissional já mostra);
--   · as promoções da casa aparecem na página do salão para quem visita (a vitrine é da casa: não depende de vínculo),
--     menos para quem saiu da agenda do salão (099: quem saiu não vê);
--   · o salão leva o código, o endereço próprio, o bairro e as avaliações por profissional.
-- O resto é o da 126, igual.

create or replace function public.pagina_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with logada as (select auth.uid() as uid),
  saiu as (
    select exists (
      select 1 from public.vinculos v, logada l
      where l.uid is not null and v.client_id = l.uid and v.salon_id = salao and v.saiu_em is not null
        and not exists (select 1 from public.vinculos v2 where v2.client_id = l.uid and v2.salon_id = salao and v2.saiu_em is null)
    ) as sim
  ),
  hoje as (select (public.agora_local())::date as d)
  select jsonb_build_object(
    'salao', (select jsonb_build_object(
        'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'descricao', s.descricao, 'fotos', to_jsonb(s.fotos), 'logo_url', s.logo_url,
        'endereco', s.address, 'bairro', s.bairro, 'cidade', s.city, 'cep', s.cep, 'lat', s.lat, 'lng', s.lng,
        'telefone', case when l.uid is not null then s.phone end,
        'whatsapp', case when l.uid is not null then coalesce(s.whatsapp, s.phone) end,
        'tem_contato', (s.phone is not null or s.whatsapp is not null),
        'instagram', s.instagram, 'codigo', s.codigo, 'subdominio', s.subdominio,
        'pagamento', public.pagamento_do_salao(s.id),
        'aceita', public.aceita_agendamentos(s.id))
      from public.salons s cross join logada l where s.id = salao and s.active),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
      from public.business_hours h where h.salon_id = salao),
    'nota', (select jsonb_build_object('media', round(avg(r.nota)::numeric, 1), 'quantas', count(*))
      from public.reviews r join public.professionals p on p.id = r.professional_id where p.salon_id = salao),
    'avaliacoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'nota', a.nota, 'comentario', a.comentario, 'quem', a.quem, 'quando', a.quando, 'profissional', a.profissional, 'servico', a.servico)
        order by a.quando desc), '[]'::jsonb)
      from (
        select r.nota, r.comentario, split_part(coalesce(pf.full_name, 'Cliente'), ' ', 1) as quem, r.created_at as quando,
               p.name as profissional, sv.name as servico
        from public.reviews r
        join public.professionals p on p.id = r.professional_id and p.salon_id = salao
        left join public.profiles pf on pf.id = r.client_id
        left join public.appointments ap on ap.id = r.appointment_id
        left join public.services sv on sv.id = ap.service_id
        order by (nullif(btrim(coalesce(r.comentario, '')), '') is not null) desc, r.created_at desc
        limit 12
      ) a),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'foto', p.photo_url, 'bio', p.bio, 'slug', p.slug, 'especialidade', p.especialidade,
        'faz', (select coalesce(jsonb_agg(sv.name order by sv.name), '[]'::jsonb) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
        'nota', (select round(avg(r.nota)::numeric, 1) from public.reviews r where r.professional_id = p.id),
        'avaliacoes', (select count(*) from public.reviews r where r.professional_id = p.id)
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
      from public.promocoes pr
      cross join hoje
      left join public.professionals p on p.id = pr.professional_id
      where pr.salon_id = salao and pr.ativa and pr.aprovacao = 'aprovada'
        and pr.inicio <= hoje.d and (pr.fim is null or pr.fim >= hoje.d)
        and (p.id is null or p.active)
        and not (select sim from saiu))
  );
$$;
grant execute on function public.pagina_do_salao(uuid) to anon, authenticated;

do $$ begin raise notice '225: a página do salão aberta a quem visita (contato só para quem entra, avaliações, equipe com link, promoções da casa)'; end $$;
