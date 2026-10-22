-- 197: Cadastros recentes na Plataforma (3.50)
-- Uma leitura só da Plataforma: os salões que entraram, do mais novo para o mais antigo, com a dona e o contato, o
-- plano (assinatura), e o que cada um já montou — serviços (com preço e duração), profissionais, horários — para
-- saber, de relance, quem se cadastrou e o quanto configurou. Sem schema novo: lê das tabelas que já existem.

create or replace function public.plataforma_cadastros(dias_ integer default 30)
returns table (
  id uuid, nome text, tipo text, slug text, cidade text, ativo boolean, criado_em timestamptz,
  dona text, dona_email text, dona_telefone text,
  plano text, teste_ate timestamptz,
  servicos jsonb, servicos_n integer, profissionais integer, horarios integer, clientes integer, atendimentos integer
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.name, s.tipo, s.slug, s.city, s.active, s.created_at,
    (select full_name from public.profiles where id = s.owner_id),
    (select email from auth.users where id = s.owner_id),
    coalesce(s.phone, (select phone from public.profiles where id = s.owner_id)),
    (select situacao from public.assinaturas a where a.salon_id = s.id),
    (select teste_ate from public.assinaturas a where a.salon_id = s.id),
    (select coalesce(jsonb_agg(jsonb_build_object('nome', sv.name, 'preco', sv.price, 'minutos', sv.duration_minutes) order by sv.created_at), '[]'::jsonb)
       from public.services sv where sv.salon_id = s.id and sv.active),
    (select count(*)::integer from public.services sv where sv.salon_id = s.id and sv.active),
    (select count(*)::integer from public.professionals p where p.salon_id = s.id and p.active),
    (select count(*)::integer from public.business_hours b where b.salon_id = s.id and b.open),
    (select count(*)::integer from public.vinculos v where v.salon_id = s.id and v.saiu_em is null),
    (select count(*)::integer from public.appointments ap where ap.salon_id = s.id and ap.status = 'concluido')
  from public.salons s
  where public.eh_plataforma()
    and s.created_at >= now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)))
  order by s.created_at desc
$$;

revoke execute on function public.plataforma_cadastros(integer) from public, anon;
grant execute on function public.plataforma_cadastros(integer) to authenticated;

do $$
begin
  raise notice '197: plataforma_cadastros(dias) — os salões recém-cadastrados com a dona, o contato, o plano e o que montou (serviços, profissionais, horários)';
end $$;
