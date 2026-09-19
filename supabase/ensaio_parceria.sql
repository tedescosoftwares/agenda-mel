-- Ensaio da 101: contrato de parceria. Roda no banco de teste e desfaz.
begin;
do $$
declare
  sal record; dona uuid; prof record; outra uuid; pid uuid; r jsonb; st text; n integer; deu boolean; msg text;
begin
  -- um salão (tipo salao) com dona e uma profissional com login diferente da dona
  select s.* into sal from public.salons s
    join public.salon_members m on m.salon_id = s.id and m.papel = 'admin'
    join public.professionals p on p.salon_id = s.id and p.active and p.user_id is not null and p.user_id <> m.user_id
   where s.active and s.tipo = 'salao' limit 1;
  if sal.id is null then raise notice 'sem salão com dona e profissional distintas; ensaio pulado'; return; end if;
  select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' and m.user_id <> sal.owner_id limit 1;
  if dona is null then select m.user_id into dona from public.salon_members m where m.salon_id = sal.id and m.papel = 'admin' limit 1; end if;
  select p.* into prof from public.professionals p where p.salon_id = sal.id and p.active and p.user_id is not null and p.user_id <> dona limit 1;
  select id into outra from public.profiles where id not in (dona, prof.user_id) limit 1;

  -- 1. a dona cria o rascunho
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  insert into public.parcerias (salon_id, professional_id, cota_pct, periodicidade) values (sal.id, prof.id, 60, 'semanal') returning id into pid;
  select status into st from public.parcerias where id = pid;
  reset role;
  if st <> 'rascunho' then raise exception '1: nasce rascunho, veio %', st; end if;
  raise notice '1 rascunho ok';

  -- 2. enviar sem PDF: recusa
  perform set_config('request.jwt.claim.sub', dona::text, false);
  deu := false;
  begin
    set role authenticated; r := public.parceria_enviar(pid); reset role;
  exception when others then deu := true; reset role;
  end;
  if not deu then raise exception '2: enviou sem PDF'; end if;
  raise notice '2 sem pdf nao envia ok';

  -- 3. com PDF, envia e avisa a profissional
  set role authenticated;
  update public.parcerias set pdf_path = sal.id || '/' || pid || '/contrato.pdf', pdf_hash = 'abc123', gerado_em = now(), conteudo = '[]'::jsonb where id = pid;
  r := public.parceria_enviar(pid, '{app,email}');
  select status into st from public.parcerias where id = pid;
  reset role;
  if st <> 'enviado' then raise exception '3: devia estar enviado, veio %', st; end if;
  select count(*) into n from public.notifications where user_id = prof.user_id and kind = 'contrato_parceria';
  if n < 1 then raise exception '3: profissional não foi avisada'; end if;
  raise notice '3 enviado e avisada ok';

  -- 4. gente de fora não vê nem assina
  if outra is not null then
    perform set_config('request.jwt.claim.sub', outra::text, false);
    set role authenticated;
    select count(*) into n from public.parcerias where id = pid;
    deu := false;
    begin r := public.parceria_assinar(pid, 'app', 'abc123'); exception when others then deu := true; end;
    reset role;
    if n <> 0 then raise exception '4: gente de fora viu o contrato'; end if;
    if not deu then raise exception '4: gente de fora assinou'; end if;
    raise notice '4 gente de fora nao ve nem assina ok';
  end if;

  -- 5. a profissional assina pelo app com hash errado: recusa; com o certo: assina e a dona é avisada
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  set role authenticated;
  deu := false;
  begin r := public.parceria_assinar(pid, 'app', 'errado'); exception when others then deu := true; msg := sqlerrm; end;
  if not deu then reset role; raise exception '5: aceitou hash errado'; end if;
  r := public.parceria_assinar(pid, 'app', 'abc123');
  reset role;
  if r ->> 'parte' <> 'profissional' then raise exception '5: parte errada %', r; end if;
  select status into st from public.parcerias where id = pid;
  if st <> 'enviado' then raise exception '5: com uma assinatura continua enviado, veio %', st; end if;
  select count(*) into n from public.notifications where user_id = dona and kind = 'contrato_assinado';
  if n < 1 then raise exception '5: dona não foi avisada'; end if;
  raise notice '5 profissional assinou ok';

  -- 6. a profissional não assina duas vezes
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  deu := false;
  begin set role authenticated; r := public.parceria_assinar(pid, 'app', 'abc123'); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '6: assinou duas vezes'; end if;
  raise notice '6 nao assina duas vezes ok';

  -- 7. a dona assina: fica assinado (sem homologação ainda) e a profissional é avisada
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.parceria_assinar(pid, 'app', 'abc123');
  reset role;
  select status into st from public.parcerias where id = pid;
  if st <> 'assinado' then raise exception '7: devia estar assinado, veio %', st; end if;
  select count(*) into n from public.notifications where user_id = prof.user_id and kind = 'contrato_completo';
  if n < 1 then raise exception '7: profissional não soube que fechou'; end if;
  raise notice '7 as duas assinaram ok';

  -- 8. voltar a rascunho depois de assinado: recusa
  perform set_config('request.jwt.claim.sub', dona::text, false);
  deu := false;
  begin set role authenticated; perform public.parceria_voltar_rascunho(pid); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '8: voltou a rascunho depois de assinado'; end if;
  raise notice '8 assinado nao volta ok';

  -- 9. homologado → vigente; não obtida → continua assinado
  set role authenticated;
  r := public.parceria_homologar(pid, 'nao_obtida', null, 'Sindicato X', 'recusou');
  select status into st from public.parcerias where id = pid;
  if st <> 'assinado' then raise exception '9: nao_obtida devia manter assinado, veio %', st; end if;
  r := public.parceria_homologar(pid, 'homologado', current_date, 'Sindicato X');
  select status into st from public.parcerias where id = pid;
  reset role;
  if st <> 'vigente' then raise exception '9: homologado devia virar vigente, veio %', st; end if;
  raise notice '9 homologacao ok';

  -- 10. segundo contrato aberto para a mesma profissional: recusa (índice)
  deu := false;
  begin
    set role authenticated;
    insert into public.parcerias (salon_id, professional_id) values (sal.id, prof.id);
    reset role;
  exception when unique_violation then deu := true; reset role;
  end;
  if not deu then raise exception '10: aceitou dois contratos abertos'; end if;
  raise notice '10 um aberto por profissional ok';

  -- 11. a equipe e a visão da profissional
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  select count(*) into n from public.parcerias_da_equipe(sal.id) e where e.professional_id = prof.id and e.status = 'vigente';
  reset role;
  if n <> 1 then raise exception '11: parcerias_da_equipe não mostra vigente'; end if;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  set role authenticated;
  r := public.minha_parceria();
  reset role;
  if r ->> 'id' <> pid::text or r ->> 'status' <> 'vigente' then raise exception '11: minha_parceria errada: %', r; end if;
  raise notice '11 consultas ok';

  -- 12. encerrar: vira encerrado, avisa, e um novo pode nascer
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.parceria_encerrar(pid, current_date + 30, 'fim da parceria', current_date);
  select status into st from public.parcerias where id = pid;
  insert into public.parcerias (salon_id, professional_id) values (sal.id, prof.id);
  reset role;
  if st <> 'encerrado' then raise exception '12: devia estar encerrado, veio %', st; end if;
  select count(*) into n from public.notifications where user_id = prof.user_id and kind = 'contrato_encerrado';
  if n < 1 then raise exception '12: profissional não soube do encerramento'; end if;
  raise notice '12 encerrado e novo rascunho ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
