-- Ensaio da 118: o plano acompanha tipo e equipe; a conta bate com o site. Desfaz no fim.
begin;
do $$
declare sid uuid; p text;
begin
  select id into sid from public.salons where tipo = 'salao' limit 1;
  update public.salons set equipe_prevista = 4 where id = sid;
  select plano into p from public.salons where id = sid; if p <> 'pro' then raise exception '1: %', p; end if;
  update public.salons set equipe_prevista = 14 where id = sid;
  select plano into p from public.salons where id = sid; if p <> 'promais' then raise exception '2: %', p; end if;
  update public.salons set tipo = 'autonoma' where id = sid;
  select plano into p from public.salons where id = sid; if p <> 'autonoma' then raise exception '3: %', p; end if;
  raise notice '1-3 plano segue tipo e equipe';
  if public.mensalidade_cents('pro', 3) <> 4990 or public.mensalidade_cents('pro', 6) <> 7960 or public.mensalidade_cents('pro', 10) <> 11920
     or public.mensalidade_cents('promais', 11) <> 14990 or public.mensalidade_cents('promais', 12) <> 15780 or public.mensalidade_cents('promais', 15) <> 18150 or public.mensalidade_cents('autonoma', 1) <> 0 then
    raise exception '4: conta errada'; end if;
  raise notice '4 mensalidade: 3->49,90 6->79,60 10->119,20 11->149,90 12->157,80 15->181,50';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
