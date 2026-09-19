-- Ensaio da 100: CEP e pino do salão. Roda no banco de teste e desfaz.
begin;
do $$
declare
  sal record; dona uuid; outra uuid; prof record; r jsonb; n integer; deu boolean;
begin
  select s.* into sal from public.salons s join public.salon_members m on m.salon_id = s.id and m.papel = 'admin' where s.active limit 1;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1;
  select id into outra from public.profiles where id <> dona and not exists (select 1 from public.salon_members m where m.user_id = profiles.id and m.salon_id = sal.id) limit 1;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active and p.slug is not null limit 1;

  -- 1. a dona grava CEP e pino
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  update public.salons set cep = '11060300', lat = -23.9668, lng = -46.3325, pino_ajustado_em = now(), address = 'Rua das Flores, 120', city = 'Santos' where id = sal.id;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '1: a dona devia conseguir gravar o pino (linhas: %)', n; end if;
  raise notice '1 dona grava o pino ok';

  -- 2. quem não é da casa não mexe (RLS: zero linhas)
  if outra is not null then
    perform set_config('request.jwt.claim.sub', outra::text, false);
    set role authenticated;
    update public.salons set lat = 0, lng = 0 where id = sal.id;
    get diagnostics n = row_count;
    reset role;
    if n <> 0 then raise exception '2: gente de fora mexeu no pino'; end if;
    raise notice '2 gente de fora nao mexe ok';
  end if;

  -- 3. a página do salão devolve o pino
  perform set_config('request.jwt.claim.sub', dona::text, false);
  r := public.pagina_do_salao(sal.id);
  if (r->'salao'->>'lat')::numeric <> -23.9668 or (r->'salao'->>'lng')::numeric <> -46.3325 or r->'salao'->>'cep' <> '11060300' then
    raise exception '3: pagina_do_salao sem o pino: %', r->'salao';
  end if;
  raise notice '3 pagina_do_salao com pino ok';

  -- 4. a vitrine pública também
  if prof.id is not null then
    r := public.vitrine_da_profissional(prof.slug);
    if (r->'salao'->>'lat')::numeric <> -23.9668 or r->'salao'->>'tipo' is null then
      raise exception '4: vitrine sem o pino: %', r->'salao';
    end if;
    raise notice '4 vitrine com pino ok';
  end if;

  -- 5. lat sem lng não entra
  deu := false;
  begin
    update public.salons set lng = null where id = sal.id;
  exception when check_violation then deu := true;
  end;
  if not deu then raise exception '5: aceitou lat sem lng'; end if;
  raise notice '5 lat sem lng recusado ok';

  -- 6. CEP fora do formato não entra
  deu := false;
  begin
    update public.salons set cep = '11060-300' where id = sal.id;
  exception when check_violation then deu := true;
  end;
  if not deu then raise exception '6: aceitou CEP com traço'; end if;
  raise notice '6 cep so digitos ok';

  -- 7. tirar o pino: os dois nulos
  update public.salons set lat = null, lng = null where id = sal.id;
  r := public.pagina_do_salao(sal.id);
  if r->'salao'->'lat' <> 'null'::jsonb then raise exception '7: pino devia ter sumido'; end if;
  raise notice '7 tirar o pino ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
