-- Ensaio da 147 (dona que também atende). Roda num banco de teste com
-- as migrações aplicadas; usa o primeiro salão com dona.
do $$
declare
  salao uuid; dona uuid; r jsonb; prof uuid; sit text; n integer; outra uuid;
begin
  select id, owner_id into salao, dona from public.salons where owner_id is not null order by created_at limit 1;
  if salao is null then raise exception 'sem salão com dona para ensaiar'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  delete from public.professionals where salon_id = salao and user_id = dona;
  update public.salons set dona_atende = null where id = salao;

  -- 1. diz que atende: nasce a ficha ligada ao login dela, ativa, marcada como dona
  r := public.dona_atender(salao, true);
  prof := (r->>'professional_id')::uuid;
  if prof is null then raise exception '1: sem ficha'; end if;
  select situacao into sit from public.professionals where id = prof;
  if sit <> 'ativa' then raise exception '1: situação % (esperava ativa)', sit; end if;
  if not exists (select 1 from public.professionals where id = prof and user_id = dona and active) then raise exception '1: ficha não é da dona ou inativa'; end if;
  if (select dona_atende from public.salons where id = salao) is not true then raise exception '1: dona_atende não gravou'; end if;
  if not exists (select 1 from jsonb_array_elements(public.equipe_da_casa(salao)) e where (e->>'id')::uuid = prof and (e->>'dona')::boolean) then raise exception '1: equipe_da_casa não marca dona'; end if;
  raise notice '1 ok: ficha % ativa e marcada como dona', prof;

  -- 2. de novo: idempotente, a mesma ficha
  r := public.dona_atender(salao, true);
  if (r->>'professional_id')::uuid <> prof then raise exception '2: duplicou a ficha'; end if;
  select count(*) into n from public.professionals where salon_id = salao and user_id = dona;
  if n <> 1 then raise exception '2: % fichas', n; end if;
  raise notice '2 ok: idempotente';

  -- 3. deixa de atender: inativa (histórico fica), e volta quando quiser
  r := public.dona_atender(salao, false);
  select situacao into sit from public.professionals where id = prof;
  if sit <> 'inativa' then raise exception '3: situação % (esperava inativa)', sit; end if;
  if (select dona_atende from public.salons where id = salao) is not false then raise exception '3: dona_atende não é false'; end if;
  r := public.dona_atender(salao, true);
  select situacao into sit from public.professionals where id = prof;
  if sit <> 'ativa' then raise exception '3: não voltou a ativa'; end if;
  raise notice '3 ok: inativa e volta';

  -- 4. quem não é a dona não decide
  select id into outra from auth.users where id <> dona limit 1;
  if outra is not null then
    perform set_config('request.jwt.claim.sub', outra::text, true);
    begin
      perform public.dona_atender(salao, false);
      raise exception '4: outra conta conseguiu';
    exception when others then
      if sqlerrm not like 'Só a dona%' then raise; end if;
    end;
    raise notice '4 ok: só a dona decide';
  end if;
  raise exception 'ensaio ok (rollback proposital)';
end $$;
