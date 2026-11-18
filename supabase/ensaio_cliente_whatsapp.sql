-- Ensaio da 242 (3.98): a cliente que se cadastra pelo WhatsApp, os limites por cliente, o primeiro horário de cliente
-- nova, as faltas, o link de criar senha e as tentativas. Desfaz no fim.
begin;
do $$
declare
  salao uuid; prof uuid; serv uuid; dona uuid; prof_conta uuid;
  c uuid := '00000000-0000-0000-0000-0000000242c1';   -- a cliente que veio pelo WhatsApp
  d uuid := '00000000-0000-0000-0000-0000000242d1';   -- cliente nova (casa confirma)
  e uuid := '00000000-0000-0000-0000-0000000242e1';   -- cliente nova (só a equipe)
  f uuid := '00000000-0000-0000-0000-0000000242f1';   -- a que falta
  r jsonb; vagas text[] := '{}'; dias date[] := '{}'; i integer; k integer := 0; dia date; livres jsonb; h text; ap uuid; n integer;
begin
  select p.id, p.salon_id, p.user_id into prof, salao, prof_conta from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select s.owner_id into dona from public.salons s where s.id = salao;
  update public.professionals set aceite_manual = false where id = prof;
  update public.salons set cliente_nova = 'igual', limite_futuros = 2, limite_faltas = 2 where id = salao;

  -- as clientes (como a função assistente cria: conta + perfil com o telefone)
  insert into auth.users (id, email) values
    (c, '5513990002421@whatsapp.mimo.com.vc'), (d, '5513990002422@whatsapp.mimo.com.vc'),
    (e, '5513990002423@whatsapp.mimo.com.vc'), (f, '5513990002424@whatsapp.mimo.com.vc') on conflict do nothing;
  insert into public.profiles (id, full_name, phone, role) values
    (c, 'Ana Souza', '(13) 99000-2421', 'cliente'), (d, 'Bia Lima', '(13) 99000-2422', 'cliente'),
    (e, 'Cris Melo', '(13) 99000-2423', 'cliente'), (f, 'Dani Rocha', '(13) 99000-2424', 'cliente')
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, role = 'cliente';

  -- as vagas livres dos próximos dias (uma por dia, para nada se encostar)
  for i in 2..30 loop
    exit when k >= 12;
    dia := (now() at time zone 'America/Sao_Paulo')::date + i;
    livres := public.bot_horarios(salao, prof, dia, serv);
    if jsonb_array_length(coalesce(livres -> 'horarios', '[]')) > 0 then
      k := k + 1; dias := dias || dia; vagas := vagas || (livres -> 'horarios' ->> 0);
    end if;
  end loop;
  if k < 8 then raise exception 'preparo: só % vagas', k; end if;

  -- R. as regras: o padrão, a dona muda, outra pessoa não, valor fora da faixa não
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.regras_da_cliente(salao);
  if r ->> 'cliente_nova' <> 'igual' or (r ->> 'limite_futuros')::int <> 2 or (r ->> 'limite_faltas')::int <> 2 then raise exception 'R: %', r; end if;
  r := public.salao_regras_cliente(salao, null, 3, null);
  if (r ->> 'limite_futuros')::int <> 3 or r ->> 'cliente_nova' <> 'igual' then raise exception 'R2: %', r; end if;
  begin perform public.salao_regras_cliente(salao, null, 9, null); raise exception 'R3: aceitou 9'; exception when raise_exception then if sqlerrm not like 'Horários futuros%' then raise; end if; end;
  begin perform public.salao_regras_cliente(salao, 'qualquer', null, null); raise exception 'R4: aceitou regra inválida'; exception when raise_exception then if sqlerrm not like 'Regra de cliente nova%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', c::text, true);
  begin perform public.salao_regras_cliente(salao, null, 5, null); raise exception 'R5: a cliente mudou a regra'; exception when raise_exception then if sqlerrm not like 'Só quem administra%' then raise; end if; end;
  update public.salons set limite_futuros = 2 where id = salao;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'R regras: padrão igual/2/2; a dona muda; fora da faixa e outra pessoa não';

  -- S. o limite de horários futuros: pela assistente e pelo app; o que o salão lança e a remarcação não contam
  r := public.bot_marcar(salao, c, prof, serv, dias[1], vagas[1]::time);
  if not (r ->> 'ok')::boolean then raise exception 'S1: %', r; end if;
  r := public.bot_marcar(salao, c, prof, serv, dias[2], vagas[2]::time);
  if not (r ->> 'ok')::boolean then raise exception 'S2: %', r; end if;
  r := public.bot_marcar(salao, c, prof, serv, dias[3], vagas[3]::time);
  if r ->> 'ok' is not null or not (r ->> 'limite')::boolean or not (r ->> 'chamar_equipe')::boolean or r ->> 'erro' not like 'Você já tem 2 horários marcados%' then raise exception 'S3: %', r; end if;
  -- pelo app (a própria cliente gravando): barrado com a mesma mensagem
  perform set_config('request.jwt.claim.sub', c::text, true);
  begin
    insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
    values (c, prof, salao, serv, dias[3], vagas[3]::time, vagas[3]::time + interval '30 minutes', 'pendente');
    raise exception 'S4: o app passou do limite';
  exception when sqlstate 'MI001' then null;
  end;
  -- o salão lançando para ela: passa
  perform set_config('request.jwt.claim.sub', dona::text, true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (c, prof, salao, serv, dias[3], vagas[3]::time, vagas[3]::time + interval '30 minutes', 'confirmado') returning id into ap;
  -- a remarcação dela não conta de novo
  perform set_config('request.jwt.claim.sub', c::text, true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status, remarca_de)
  values (c, prof, salao, serv, dias[4], vagas[4]::time, vagas[4]::time + interval '30 minutes', 'pendente', ap);
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'S limite: 2 pela assistente, o 3º chama a equipe; o app barra igual; o salão e a remarcação passam';

  -- T. o primeiro horário de cliente nova
  update public.salons set cliente_nova = 'casa_confirma' where id = salao;
  r := public.bot_marcar_simular(salao, prof, serv, dias[5], vagas[5]::time);
  if r ->> 'status' <> 'pendente' or r ->> 'aviso' not like 'o salão confirma%' then raise exception 'T0 (teste da dona): %', r; end if;
  r := public.bot_marcar(salao, d, prof, serv, dias[5], vagas[5]::time);
  if not (r ->> 'ok')::boolean then raise exception 'T1: %', r; end if;
  if prof_conta is not null and r ->> 'status' <> 'pendente' then raise exception 'T1b (casa confirma o primeiro): %', r; end if;
  if prof_conta is not null and not exists (select 1 from public.aceites a where a.appointment_id = (r ->> 'appointment_id')::uuid) then raise exception 'T1c: sem pedido aberto'; end if;
  r := public.bot_marcar(salao, d, prof, serv, dias[6], vagas[6]::time);
  if r ->> 'status' <> 'confirmado' then raise exception 'T2 (o segundo segue a regra): %', r; end if;
  update public.salons set cliente_nova = 'so_equipe' where id = salao;
  r := public.bot_marcar_simular(salao, prof, serv, dias[7], vagas[7]::time);
  if not (r ->> 'chamar_equipe')::boolean then raise exception 'T3 (teste, só a equipe): %', r; end if;
  r := public.bot_marcar(salao, e, prof, serv, dias[7], vagas[7]::time);
  if r ->> 'ok' is not null or not (r ->> 'chamar_equipe')::boolean or r ->> 'erro' not like 'O primeiro horário de cliente nova%' then raise exception 'T4: %', r; end if;
  -- pelo app: vira pedido
  perform set_config('request.jwt.claim.sub', e::text, true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (e, prof, salao, serv, dias[7], vagas[7]::time, vagas[7]::time + interval '30 minutes', 'pendente') returning id into ap;
  perform set_config('request.jwt.claim.sub', '', true);
  if prof_conta is not null and (select status from public.appointments where id = ap) <> 'pendente' then raise exception 'T5 (app, só a equipe: pedido)'; end if;
  update public.salons set cliente_nova = 'igual' where id = salao;
  raise notice 'T cliente nova: casa confirma o primeiro (pedido), o segundo segue a regra; só a equipe: a assistente chama, o app vira pedido';

  -- U. as faltas: duas nos últimos 12 meses, o próximo horário vira pedido
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status) values
    (f, prof, salao, serv, (now() at time zone 'America/Sao_Paulo')::date - 20, '10:00', '10:30', 'faltou'),
    (f, prof, salao, serv, (now() at time zone 'America/Sao_Paulo')::date - 40, '10:00', '10:30', 'faltou');
  r := public.situacao_da_cliente(salao, f);
  if (r ->> 'faltas')::int <> 2 or (r ->> 'nova')::boolean then raise exception 'U0: %', r; end if;
  r := public.bot_marcar(salao, f, prof, serv, dias[8], vagas[8]::time);
  if not (r ->> 'ok')::boolean then raise exception 'U1: %', r; end if;
  if prof_conta is not null and r ->> 'status' <> 'pendente' then raise exception 'U2 (faltas: pedido): %', r; end if;
  raise notice 'U faltas: 2 faltas, o próximo vira pedido';

  -- V. o link de criar senha: vale uma vez, o novo derruba o antigo
  perform public.cliente_do_whatsapp(c);
  if (select phone_verificado_em is null or not accepts_reminders or aceita_email from public.profiles where id = c) then raise exception 'V0: cliente_do_whatsapp'; end if;
  perform public.link_de_acesso_guardar(c, 'hash-1', 'assistente');
  r := public.link_de_acesso_ver('hash-1');
  if not (r ->> 'ok')::boolean or r ->> 'nome' <> 'Ana Souza' or (r ->> 'conta')::uuid <> c then raise exception 'V1: %', r; end if;
  if public.link_de_acesso_usar('hash-1') <> c then raise exception 'V2'; end if;
  if public.link_de_acesso_usar('hash-1') is not null then raise exception 'V3: usou duas vezes'; end if;
  if public.link_de_acesso_ver('hash-1') ->> 'motivo' <> 'usado' then raise exception 'V4'; end if;
  perform public.link_de_acesso_guardar(c, 'hash-2', 'app');
  perform public.link_de_acesso_guardar(c, 'hash-3', 'app');
  if public.link_de_acesso_ver('hash-2') ->> 'motivo' <> 'expirado' or not (public.link_de_acesso_ver('hash-3') ->> 'ok')::boolean then raise exception 'V5: o novo não derrubou o antigo'; end if;
  if public.link_de_acesso_ver('nao-existe') ->> 'motivo' <> 'nao_existe' then raise exception 'V6'; end if;
  raise notice 'V link: vale uma vez; o novo derruba o antigo';

  -- W. as tentativas: 3 por hora, a 4ª não
  n := 0;
  for i in 1..4 loop if public.acesso_tentativa('link:ensaio242', 3, 60) then n := n + 1; end if; end loop;
  if n <> 3 then raise exception 'W: % de 4', n; end if;
  raise notice 'W tentativas: 3 passam, a 4ª não';

  -- X. entrar pelo número: só telefone confirmado e de uma conta só
  if public.conta_para_entrar('5513990002421') is distinct from c then raise exception 'X1'; end if;
  if public.conta_para_entrar('5513990002422') is not null then raise exception 'X2: telefone não confirmado entrou'; end if;
  -- (duas contas com o mesmo número o banco já não deixa: profiles_phone_chave_unico)
  raise notice 'X entrar pelo número: só telefone confirmado';

  -- Y. o endereço de entrada de quem veio pelo WhatsApp não recebe e-mail
  if public.enfileirar_email('5513990002421@whatsapp.mimo.com.vc', 'Oi', '<p>oi</p>', 'teste', 'oi', 'Ana', c) is not null then raise exception 'Y1'; end if;
  if public.enfileirar_email('ana@exemplo.com', 'Oi', '<p>oi</p>', 'teste', 'oi', 'Ana', c) is null then raise exception 'Y2'; end if;
  raise notice 'Y e-mail: o endereço do WhatsApp não recebe; o de verdade recebe';

  raise notice 'ensaio_cliente_whatsapp: tudo certo';
end $$;
rollback;
