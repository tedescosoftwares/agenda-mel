-- 233 · O link de ativar mostrava a profissional errada (3.89.3)
--
-- acesso_por_token(token) é uma função SQL, e numa função SQL a coluna ganha do parâmetro quando têm o mesmo nome:
-- "where a.token = lower(btrim(token))" comparava a coluna com ela mesma, então valia para todas as linhas e a
-- função devolvia a primeira profissional da tabela, para qualquer link (até para um link que não existe). A página
-- /ativar mostrava o nome, o e-mail e o telefone dessa outra profissional e preenchia o cadastro com eles; o botão
-- de ativar usava o link certo (ativar_acesso_interno qualifica o parâmetro). Agora o parâmetro vem qualificado.
-- Conferido: é a única função SQL em que um parâmetro tem o nome de uma coluna das tabelas que ela consulta.

CREATE OR REPLACE FUNCTION public.acesso_por_token(token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'logo_url', s.logo_url, 'cidade', s.city),
    'profissional', jsonb_build_object('id', p.id, 'nome', p.name, 'especialidade', p.especialidade, 'vinculo', p.vinculo, 'foto', p.photo_url,
      'email', p.email, 'telefone', p.phone,
      'telefone_final', right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 4),
      'servicos', (select count(*) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
      'dias', (select coalesce(jsonb_agg(h.weekday order by h.weekday), '[]'::jsonb) from public.professional_hours h where h.professional_id = p.id and h.open)),
    'situacao', p.situacao, 'tem_conta', p.user_id is not null, 'usado', a.usado_em is not null)
  from public.acessos_equipe a
  join public.professionals p on p.id = a.professional_id
  join public.salons s on s.id = p.salon_id
  where a.token = lower(btrim(acesso_por_token.token));
$function$;

do $$ begin raise notice '233: acesso_por_token procura pelo link pedido (antes devolvia sempre a primeira profissional)'; end $$;
