-- Ensaio da 148 (autônoma vira salão). Rollback proposital no fim.
do $$
declare salao uuid; dona uuid; r jsonb; papel text; n integer;
begin
  select id, owner_id into salao, dona from public.salons where owner_id is not null order by created_at limit 1;
  if salao is null then raise exception 'sem salão com dona'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  -- vira autônoma primeiro (é o estado de partida)
  update public.salons set tipo = 'autonoma', dona_atende = null where id = salao;
  update public.profiles set role = 'profissional' where id = dona;
  r := public.virar_salao(salao);
  if (r->>'tipo') <> 'salao' then raise exception '1: tipo %', r; end if;
  if (select tipo from public.salons where id = salao) <> 'salao' then raise exception '1: salão não virou'; end if;
  if (select dona_atende from public.salons where id = salao) is not true then raise exception '1: dona_atende'; end if;
  select role into papel from public.profiles where id = dona;
  if papel <> 'admin' then raise exception '1: papel % (esperava admin)', papel; end if;
  select count(*) into n from public.professionals where salon_id = salao and user_id = dona and active;
  if n <> 1 then raise exception '1: % fichas ativas da dona', n; end if;
  raise notice '1 ok: virou salão, segue atendendo, papel admin';
  r := public.virar_salao(salao);
  if (r->>'ja_era')::boolean is not true then raise exception '2: segunda chamada'; end if;
  raise notice '2 ok: idempotente';
  raise exception 'ensaio ok (rollback proposital)';
end $$;
