-- 148 · O caminho inverso: autônoma vira salão (2.99.1)
--
-- Uma autônoma que cresce e quer equipe aperta "Virar salão" no app.
-- trocar_tipo_negocio (114) já troca o tipo e o papel para admin; aqui
-- a gente garante o resto: ela continua atendendo (dona_atende = true,
-- a ficha dela segue a mesma, nada é refeito) e a equipe prevista começa
-- em 1 (ela). O plano começa quando ela ativar o salão no painel.
create or replace function public.virar_salao(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare r jsonb; s public.salons%rowtype;
begin
  select * into s from public.salons where id = salao;
  if s.id is null then raise exception 'Salão não encontrado.'; end if;
  if s.owner_id is null or s.owner_id <> auth.uid() then raise exception 'Só a dona decide isso.'; end if;
  if s.tipo <> 'autonoma' then return jsonb_build_object('ok', true, 'tipo', s.tipo, 'ja_era', true); end if;
  r := public.trocar_tipo_negocio(salao, 'salao');
  -- ela segue atendendo: a ficha dela (cria se por acaso não existir) fica ativa e dona_atende = true
  perform public.dona_atender(salao, true);
  update public.salons set equipe_prevista = greatest(coalesce(equipe_prevista, 1), 1) where id = salao;
  return jsonb_build_object('ok', true, 'tipo', 'salao');
end;
$$;
revoke execute on function public.virar_salao(uuid) from public, anon;
grant execute on function public.virar_salao(uuid) to authenticated;
