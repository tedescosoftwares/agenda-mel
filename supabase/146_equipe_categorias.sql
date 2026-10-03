-- 146: A profissional atende categorias (2.93)
-- Agenda Mel — 146: professionals.categorias (o que ela atende), equipe_definir_categorias, equipe_da_casa com categorias e cobertura_por_categoria (serviços e quem atende por categoria)
--
-- O fluxo Categorias → Serviços → Equipe passa a fechar: a profissional
-- diz quais categorias atende e os serviços delas vêm pré-marcados; a
-- lista de serviços (professional_services) continua sendo a verdade,
-- porque atender a categoria não quer dizer fazer todos os serviços dela.
-- Serviço novo numa categoria pré-marca quem a atende, no formulário,
-- nunca às escondidas.

alter table public.professionals add column if not exists categorias uuid[] not null default '{}';

-- a dona (ou a própria profissional) define o que ela atende; ids que não
-- são categoria da plataforma nem do salão são ignorados
create or replace function public.equipe_definir_categorias(prof uuid, categorias uuid[])
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; validas uuid[];
begin
  select * into p from public.professionals where id = prof;
  if p.id is null then raise exception 'Profissional não encontrada.'; end if;
  if not (public.is_admin_do_salao(p.salon_id) or coalesce(p.user_id = auth.uid(), false)) then raise exception 'Só a dona do salão ou a própria profissional define o que ela atende.'; end if;
  select coalesce(array_agg(distinct c.id), '{}') into validas
  from public.categorias_de_servico c
  where c.id = any (coalesce(categorias, '{}')) and (c.salon_id is null or c.salon_id = p.salon_id);
  update public.professionals set categorias = validas where id = p.id;
  return jsonb_build_object('ok', true, 'categorias', to_jsonb(validas));
end;
$$;
revoke execute on function public.equipe_definir_categorias(uuid, uuid[]) from public, anon;
grant execute on function public.equipe_definir_categorias(uuid, uuid[]) to authenticated;

-- quem já estava na equipe: as categorias saem dos serviços que ela já faz (uma vez só)
update public.professionals p set categorias = sub.cats
from (
  select ps.professional_id, array_agg(distinct sv.categoria_id) as cats
  from public.professional_services ps
  join public.services sv on sv.id = ps.service_id and sv.active and sv.categoria_id is not null
  group by ps.professional_id
) sub
where sub.professional_id = p.id and p.categorias = '{}';

-- equipe_da_casa (119) passa a trazer as categorias
create or replace function public.equipe_da_casa(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email, 'photo_url', p.photo_url, 'especialidade', p.especialidade, 'slug', p.slug, 'bio', p.bio,
    'user_id', p.user_id, 'vinculo', p.vinculo, 'situacao', p.situacao, 'permissoes', p.permissoes, 'cota_pct', p.cota_pct, 'cota_excecoes', p.cota_excecoes,
    'usa_horario_salao', p.usa_horario_salao, 'configurada_em', p.configurada_em, 'ativada_em', p.ativada_em, 'created_at', p.created_at,
    'categorias', to_jsonb(p.categorias),
    'dona', p.user_id is not null and p.user_id = s.owner_id,
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object('service_id', ps.service_id, 'preco_cents', ps.preco_cents, 'duracao_minutos', ps.duracao_minutos) order by sv.name), '[]'::jsonb)
                 from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
                 from public.professional_hours h where h.professional_id = p.id),
    'token', (select a.token from public.acessos_equipe a where a.professional_id = p.id and a.usado_em is null order by a.criado_em desc limit 1),
    'acesso_enviado_em', (select max(a.enviado_em) from public.acessos_equipe a where a.professional_id = p.id),
    'parceria', (select x.status from public.parcerias x where x.professional_id = p.id order by x.inicio desc limit 1),
    'tem_historico', exists (select 1 from public.appointments a where a.professional_id = p.id)
  ) order by (p.situacao = 'inativa'), p.created_at), '[]'::jsonb)
  from public.professionals p
  join public.salons s on s.id = p.salon_id
  where p.salon_id = salao and public.is_admin_do_salao(salao);
$$;

-- a cobertura: por categoria com serviço ativo, quantos serviços, quantos
-- sem ninguém que faça e quem atende (para o resumo do "Pronto" e a Mel)
create or replace function public.cobertura_por_categoria(salao uuid)
returns table (categoria_id uuid, nome text, ordem integer, servicos integer, sem_profissional integer, profissionais text[])
language sql
stable
security definer set search_path = public
as $$
  select c.id, c.nome, c.ordem,
         count(sv.id)::integer,
         count(sv.id) filter (where not exists (select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active and p.situacao <> 'inativa' where ps.service_id = sv.id))::integer,
         coalesce((select array_agg(distinct p.name order by p.name) from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active and p.situacao <> 'inativa' join public.services s2 on s2.id = ps.service_id and s2.active and s2.categoria_id = c.id and s2.salon_id = salao), '{}')
  from public.services sv
  join public.categorias_de_servico c on c.id = sv.categoria_id
  where sv.salon_id = salao and sv.active and (public.is_admin_do_salao(salao) or public.eh_plataforma())
  group by c.id, c.nome, c.ordem
  order by c.ordem, c.nome;
$$;
revoke execute on function public.cobertura_por_categoria(uuid) from public, anon;
grant execute on function public.cobertura_por_categoria(uuid) to authenticated;
