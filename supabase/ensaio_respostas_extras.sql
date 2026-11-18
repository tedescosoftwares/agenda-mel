-- Ensaio da 248 (3.99): números que a assistente não responde, limites e pausas, respostas extras por Pix. Desfaz no fim.
begin;
do $$
declare salao uuid; prof uuid; conta_prof uuid; adm uuid; r jsonb; t text; n int; base int; c1 uuid; c2 uuid; c3 uuid;
        cli uuid := '00000000-0000-0000-0000-00000000c0f9'; tel text := '5513990009977'; tel_prof text;
begin
  select p.id, p.salon_id, p.user_id into prof, salao, conta_prof from public.professionals p where p.slug = 'ana-paula';
  select m.user_id into adm from public.salon_members m where m.salon_id = salao and m.papel = 'admin' limit 1;
  update public.profiles set phone = '(13) 99000-9976' where id = conta_prof;
  tel_prof := public.telefone_e164('(13) 99000-9976');
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, numero_proprio) values (salao, 'evolution', 'salao-x', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'salao-x', ativo = true, usa_ia = true, numero_proprio = true;
  insert into auth.users (id, email) values (cli, tel || '@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role) values (cli, 'Teresa Extra', '(13) 99000-9977', 'cliente') on conflict (id) do update set phone = excluded.phone, full_name = excluded.full_name;
  delete from public.bot_pausas where salon_id = salao;

  -- A. a lista do salão: quem está nela não recebe resposta
  if public.numero_sem_resposta(salao, tel) then raise exception 'A0: a cliente começou na lista'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  r := public.assistente_sem_resposta_salvar(salao, '(13) 99000-9977', 'Fornecedor');
  if not public.numero_sem_resposta(salao, tel) then raise exception 'A1: entrou na lista e continua respondendo'; end if;
  if (public.bot_contexto(salao, tel, 'salao-x', true) ->> 'motivo') is distinct from 'nao_responder' then raise exception 'A2: a assistente não ficou quieta'; end if;
  if jsonb_array_length(r -> 'lista') <> 1 or r -> 'lista' -> 0 ->> 'nome' <> 'Fornecedor' then raise exception 'A3: lista errada: %', r; end if;
  r := public.assistente_sem_resposta_tirar(salao, (r -> 'lista' -> 0 ->> 'id')::uuid);
  if public.numero_sem_resposta(salao, tel) then raise exception 'A4: tirou e continua quieta'; end if;
  raise notice 'A a lista do salão: entrou, ela fica quieta; saiu, volta a responder';

  -- B. a equipe fica de fora (padrão); desligado, volta a responder
  if not public.numero_sem_resposta(salao, tel_prof) then raise exception 'B1: a profissional recebe resposta da assistente'; end if;
  r := public.assistente_sem_resposta(salao);
  if not (r ->> 'ignora_equipe')::boolean or not exists (select 1 from jsonb_array_elements(r -> 'equipe') x where public.telefone_chave(x ->> 'telefone') = public.telefone_chave(tel_prof)) then raise exception 'B2: a equipe não aparece: %', r; end if;
  r := public.salao_ignora_equipe(salao, false);
  if public.numero_sem_resposta(salao, tel_prof) then raise exception 'B3: desligado e continua quieta com a equipe'; end if;
  r := public.salao_ignora_equipe(salao, true);
  raise notice 'B a equipe fica de fora por padrão; desligando, ela responde';

  -- C. quem não manda no salão não mexe
  perform set_config('request.jwt.claim.sub', cli::text, true);
  begin perform public.assistente_sem_resposta_salvar(salao, '13999999999'); raise exception 'C1: a cliente mexeu na lista'; exception when raise_exception then if sqlerrm like 'C1%' then raise; end if; end;
  begin perform public.respostas_compra_abrir(salao, 500); raise exception 'C2: a cliente comprou respostas'; exception when raise_exception then if sqlerrm like 'C2%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  raise notice 'C só quem manda no salão mexe';

  -- D. as pausas aparecem com o motivo certo, e "Voltar a responder" tira
  insert into public.bot_pausas (telefone, salon_id, ate, motivo) values
    (tel, salao, now() + interval '2 hours', 'Cliente pediu atendimento humano'),
    ('5513990009978', salao, now() + interval '24 hours', 'encerrada: ofensiva'),
    ('5513990009979', salao, now() + interval '6 hours', 'encerrada: fora_do_assunto'),
    ('5513990009980', salao, now() + interval '2 hours', 'a equipe respondeu pelo celular');
  r := public.assistente_limites(salao);
  select string_agg(x ->> 'tipo', ',' order by x ->> 'tipo') into t from jsonb_array_elements(r -> 'pausas') x;
  if t <> 'chamou_equipe,equipe_respondeu,fora_do_assunto,ofensiva' then raise exception 'D1: motivos: %', t; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'pausas') x where x ->> 'telefone' = tel and x ->> 'nome' = 'Teresa Extra') then raise exception 'D2: sem o nome da cliente'; end if;
  r := public.assistente_voltar_a_responder(salao, '(13) 99000-9977');
  if exists (select 1 from public.bot_pausas where salon_id = salao and telefone = tel) then raise exception 'D3: a pausa ficou'; end if;
  if jsonb_array_length(r -> 'pausas') <> 3 then raise exception 'D4: devia sobrar 3 pausas'; end if;
  raise notice 'D pausas com o motivo certo; "Voltar a responder" tira';

  -- E. o teto do dia, os avisos e o saldo extra
  delete from public.bot_pausas where salon_id = salao;
  delete from public.notifications where user_id = adm and kind in ('assistente_limite', 'respostas_pagas');
  base := coalesce(public.ia_gastas_hoje(salao), 0);
  update public.whatsapp_channels set teto_ia_diario = base + 5 where salon_id = salao;
  update public.salons set respostas_extras = 0 where id = salao;
  for n in 1..5 loop perform public.registrar_chamada_ia(salao, tel, 'claude-haiku-5-5'); end loop;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'assistente_limite' and title like 'A assistente já usou%') then raise exception 'E1: sem o aviso dos 80%%'; end if;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'assistente_limite' and title like '%respostas de hoje acabaram' and body like 'Ela para até amanhã%') then raise exception 'E2: sem o aviso do fim do dia'; end if;
  if (public.bot_contexto(salao, tel, 'salao-x', true) ->> 'motivo') is distinct from 'teto_do_dia' then raise exception 'E3: passou do teto e continuou'; end if;
  raise notice 'E o dia acabou: aviso nos 80%% e no fim, e ela para';

  -- F. a compra: abre, reaproveita, troca de pacote, paga uma vez só, e o saldo estende o dia
  r := public.respostas_compra_abrir(salao, 1000); c1 := (r ->> 'id')::uuid;
  if (r ->> 'valor_cents')::int <> 3490 or r ->> 'status' <> 'aguardando' then raise exception 'F1: compra errada: %', r; end if;
  if (public.respostas_compra_abrir(salao, 1000) ->> 'id')::uuid <> c1 then raise exception 'F2: tocar duas vezes criou outra'; end if;
  perform public.respostas_compra_atualizar(c1, 'pay_111', '000201...');
  r := public.respostas_compra_abrir(salao, 500); c2 := (r ->> 'id')::uuid;
  if c2 = c1 or (select status from public.respostas_compras where id = c1) <> 'cancelado' or not (r -> 'anteriores') ? 'pay_111' then raise exception 'F3: trocar de pacote: %', r; end if;
  begin perform public.respostas_compra_abrir(salao, 700); raise exception 'F4: pacote inventado'; exception when raise_exception then if sqlerrm like 'F4%' then raise; end if; end;
  r := public.respostas_compra_paga(c2, 'pay_222');
  if (r ->> 'extras')::int <> 500 then raise exception 'F5: o saldo não entrou: %', r; end if;
  r := public.respostas_compra_paga(c2, 'pay_222');
  if (r ->> 'extras')::int <> 500 or not (r ->> 'ja')::boolean then raise exception 'F6: pagou duas vezes: %', r; end if;
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'respostas_pagas' and title = 'Pix confirmado: +500 respostas') then raise exception 'F7: sem o aviso do Pix'; end if;
  if (public.bot_contexto(salao, tel, 'salao-x', true) ->> 'permitido')::boolean is distinct from true then raise exception 'F8: com saldo, continuou parada'; end if;
  perform public.registrar_chamada_ia(salao, tel, 'claude-haiku-5-5');
  if (select respostas_extras from public.salons where id = salao) <> 499 then raise exception 'F9: a resposta além do dia não gastou o saldo'; end if;
  perform public.registrar_chamada_ia(salao, tel, 'claude-haiku-5-5', null, null, null, 'deu erro');
  if (select respostas_extras from public.salons where id = salao) <> 499 then raise exception 'F10: resposta com erro gastou saldo'; end if;
  r := public.assistente_limites(salao);
  if (r ->> 'extras')::int <> 499 or jsonb_array_length(r -> 'compras') <> 1 then raise exception 'F11: limites: %', r; end if;
  raise notice 'F compra: abre, reaproveita, troca, paga uma vez, o saldo estende o dia e só gasta resposta de verdade';

  -- G. o saldo acabando e acabando de vez
  update public.salons set respostas_extras = 51 where id = salao;
  perform public.registrar_chamada_ia(salao, tel, 'claude-haiku-5-5');
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'assistente_limite' and title = 'Saldo extra acabando') then raise exception 'G1: sem o aviso dos 50'; end if;
  update public.salons set respostas_extras = 1 where id = salao;
  perform public.registrar_chamada_ia(salao, tel, 'claude-haiku-5-5');
  if not exists (select 1 from public.notifications where user_id = adm and kind = 'assistente_limite' and title = 'O saldo extra acabou') then raise exception 'G2: sem o aviso do fim do saldo'; end if;
  if (public.bot_contexto(salao, tel, 'salao-x', true) ->> 'motivo') is distinct from 'teto_do_dia' then raise exception 'G3: sem saldo, continuou'; end if;
  raise notice 'G saldo acabando (50) e acabou: avisos, e ela para';

  raise notice 'ensaio_respostas_extras: tudo certo';
end $$;
rollback;
