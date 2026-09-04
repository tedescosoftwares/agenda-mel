-- =============================================================
-- MIMO — 051: a vitrine da profissional
--
-- /p/<slug> é a porta de entrada de toda cliente nova: é o link que a
-- profissional cola na bio do Instagram e manda no WhatsApp. Até aqui
-- era o formulário de agendar com uma foto em cima — funcionava, mas
-- não convencia ninguém. Uma vitrine precisa de prova: nota, o que as
-- clientes disseram, fotos do trabalho, onde fica, quando abre, e uma
-- próxima vaga concreta ("amanhã às 14h") em vez de um calendário vazio.
--
-- Nada disso é dado novo, com três exceções pequenas que só a
-- profissional preenche: especialidade (a frase curta embaixo do nome),
-- instagram, e um WhatsApp que ela ESCOLHE mostrar. O telefone de
-- cadastro continua privado como sempre (013).
--
-- Tudo sai numa chamada só, vitrine_da_profissional(link), porque a
-- página abre em celular de rua com 3G, e sete idas ao banco viram
-- sete segundos de tela branca.
-- =============================================================

-- 1. O que ela conta sobre si ---------------------------------------------
alter table public.professionals add column if not exists especialidade text;
alter table public.professionals add column if not exists instagram text;
alter table public.professionals add column if not exists whatsapp_publico text;

comment on column public.professionals.especialidade is
  'uma linha embaixo do nome: "Nail designer" — a profissional escreve';
comment on column public.professionals.instagram is
  'só o @, sem link';
comment on column public.professionals.whatsapp_publico is
  'número que ela QUER mostrar na página pública; vazio = não mostra';

grant select (especialidade, instagram, whatsapp_publico)
  on public.professionals to anon, authenticated;
grant update (especialidade, instagram, whatsapp_publico, bio, photo_url)
  on public.professionals to authenticated;

-- 2. A vitrine numa chamada -------------------------------------------------
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
      'name', s.name, 'city', s.city, 'address', s.address, 'app_url', s.app_url),
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
