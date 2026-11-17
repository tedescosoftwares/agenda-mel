-- Ensaio do link de ativar (233): cada link mostra a própria profissional. Roda no banco de teste e desfaz.
begin;
do $$
declare sal uuid; p1 uuid; p2 uuid; t1 text; t2 text;
begin
  select id into sal from public.salons where owner_id is not null limit 1;
  insert into public.professionals (salon_id, name, slug, phone, email, situacao)
  values (sal, 'Ensaio Primeira', 'ensaio-primeira-233', '13990005551', 'primeira.233@exemplo.com', 'configurada') returning id into p1;
  insert into public.professionals (salon_id, name, slug, phone, email, situacao)
  values (sal, 'Ensaio Segunda', 'ensaio-segunda-233', '13990005552', 'segunda.233@exemplo.com', 'configurada') returning id into p2;
  t1 := public.token_da_profissional(p1);
  t2 := public.token_da_profissional(p2);
  if public.acesso_por_token(t2) -> 'profissional' ->> 'nome' <> 'Ensaio Segunda' then raise exception 'o link da segunda mostrou outra: %', public.acesso_por_token(t2) -> 'profissional' ->> 'nome'; end if;
  if public.acesso_por_token(t1) -> 'profissional' ->> 'nome' <> 'Ensaio Primeira' then raise exception 'o link da primeira mostrou outra'; end if;
  if public.acesso_por_token(upper(t2)) -> 'profissional' ->> 'nome' <> 'Ensaio Segunda' then raise exception 'maiúsculas no link deviam valer'; end if;
  if public.acesso_por_token('naoexiste0000000') is not null then raise exception 'link que não existe devia voltar vazio'; end if;
  raise notice 'acesso_por_token: cada link mostra a própria profissional (ok)';
end $$;
rollback;
