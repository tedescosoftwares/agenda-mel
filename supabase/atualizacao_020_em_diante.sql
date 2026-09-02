-- =============================================================
--  AGENDA MEL — ATUALIZAÇÃO: da migração 020 em diante
--
--  Para quem JÁ tem o banco rodando e quer ficar em dia sem
--  recomeçar. Cole ISTO INTEIRO no SQL Editor do Supabase e Run.
--
--  • Pode rodar de novo quantas vezes quiser: nada é duplicado.
--  • Pode rodar mesmo que você já tenha aplicado algumas destas
--    migrações soltas — as que já estão lá são ignoradas.
--  • Se o seu banco é NOVO, não use este: use o setup_completo.sql,
--    que traz tudo desde o começo.
--
--  O que entra aqui:
--    020  números do salão: faturamento, ocupação, melhores clientes
--    021  dois meses de histórico de exemplo, para as telas de
--         números e de "quem sumiu" nascerem com o que mostrar
--    022  conserta um furo de segurança: a trava que impedia a
--         cliente de marcar o próprio horário como concluído estava
--         desligada sem ninguém saber
--    023  fila de mensagens de WhatsApp, com teto diário e horário
--         de silêncio
--    024  a resposta da cliente vira ação na agenda
--    025  botões na mensagem
--    026  botão só onde ele realmente aparece
--    027  estilo do botão por canal
--    028  primeiro voto vale, e enquete deixa de ser o padrão
--    029  mensagem bonita, com emoji e link para a agenda
--    030  o porteiro da IA: nada chama modelo de linguagem sem passar
--         por sete filtros, e a IA nasce DESLIGADA em todo salão
--    031  tira TRUNCATE de anon e authenticated — é a única forma de
--         apagar dados que não passa por RLS
--    032  a profissional fica sabendo: marcou ou cancelou, chega
--         WhatsApp pra ela; mais a tela Admin -> WhatsApp que diz
--         por que uma mensagem não saiu, e a profissional Mel
--         (mel@exemplo.com) com telefone de verdade para testar
--    033  a IA como reserva do interpretador: as regras exatas
--         primeiro, e o modelo só para o que elas não previram.
--         A IA traduz, nunca executa — quando as duas discordam,
--         a regra ganha
--    034  pedido de horário deixa de cair no vazio: avisa a
--         profissional e a dona, e a resposta muda quando o salão
--         ainda não gravou o endereço público
--    035  o bot que marca sozinho: pergunta serviço, profissional,
--         dia e hora pela conversa e deixa o horário marcado. Junto,
--         horarios_livres() em SQL — a mesma conta que estava só no
--         navegador, agora numa implementação só
--    036  telefone repetido em dois cadastros deixa de ser sorteio:
--         quem responde no WhatsApp é a cliente, sempre
--    037  quem não tem cadastro deixa de sumir: o bot gravava a
--         mensagem antes de decidir repassar, e o caminho antigo
--         via o próprio registro como evento repetido. Junto, o
--         diagnóstico do bot
--
--  Se der erro, me mande a mensagem inteira: cada bloco abaixo está
--  marcado com o nome do arquivo de origem, então dá para achar na hora.
-- =============================================================

-- =============================================================
-- >>> 020_numeros.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 020: saber se o mês fechou no azul
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 019).
--
-- Números que a profissional hoje só tem "de cabeça": quanto
-- entrou, quanto vale um atendimento em média, quantas faltaram,
-- quanto da agenda ficou parada e quem voltou.
--
-- Dinheiro sempre em centavos inteiros; percentual em pontos-base
-- (1234 = 12,34%) — nada de float em cima de dinheiro.
-- =============================================================

-- 1. Quanto tempo a agenda tinha para vender -----------------------------
-- Soma a janela de trabalho de cada dia do período e desconta almoço,
-- folga e compromisso. É o denominador da taxa de ocupação.
create or replace function public.minutos_disponiveis(
  prof uuid,
  de date,
  ate date
)
returns integer
language sql
stable
security definer set search_path = public
as $$
  with dias as (
    select d::date as dia
    from generate_series(de, ate, interval '1 day') d
  ),
  janelas as (
    select dias.dia,
           h.start_time,
           h.end_time,
           extract(epoch from (h.end_time - h.start_time)) / 60 as minutos
    from dias
    join public.professional_hours h
      on h.professional_id = prof
     and h.weekday = extract(dow from dias.dia)::smallint
    where h.open
  ),
  descontos as (
    select j.dia,
           sum(
             case
               when b.all_day then j.minutos
               else greatest(
                 0,
                 extract(epoch from (
                   least(b.end_time, j.end_time) - greatest(b.start_time, j.start_time)
                 )) / 60
               )
             end
           ) as minutos
    from janelas j
    join public.professional_blocks b
      on b.professional_id = prof
     and (
       (b.kind = 'semanal' and b.weekday = extract(dow from j.dia)::smallint)
       or (b.kind = 'data' and b.date = j.dia)
     )
    group by j.dia
  )
  select greatest(
    0,
    coalesce(
      (select sum(j.minutos) from janelas j)
      - (select coalesce(sum(d.minutos), 0) from descontos d),
      0
    )
  )::integer;
$$;

revoke execute on function public.minutos_disponiveis(uuid, date, date)
  from public, anon, authenticated;

-- 2. O mês em números ----------------------------------------------------
create or replace function public.resumo_do_mes(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  inicio date,
  fim date,
  atendimentos integer,
  faturamento_cents bigint,
  ticket_medio_cents integer,
  descontos_cents bigint,
  faltas integer,
  cancelamentos integer,
  taxa_falta_bps integer,
  clientes integer,
  clientes_novas integer,
  encaixes integer,
  minutos_ocupados integer,
  minutos_disponiveis integer,
  ocupacao_bps integer,
  faturamento_mes_anterior_cents bigint
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  hoje date := public.agora_local()::date;
  ini date;
  fin date;
  ate date;
  ini_ant date;
  fim_ant date;
  concluidos integer;
  faltou integer;
begin
  if prof is null then
    raise exception 'Informe a profissional';
  end if;

  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;

  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  -- no mês corrente a agenda ainda não aconteceu inteira
  ate := least(fin, hoje);
  ini_ant := (ini - interval '1 month')::date;
  fim_ant := (ini - interval '1 day')::date;

  select count(*) filter (where a.status = 'concluido'),
         count(*) filter (where a.status = 'faltou')
    into concluidos, faltou
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;

  return query
  select
    ini,
    fin,
    concluidos,
    coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
    case when concluidos > 0
      then (coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)
            / concluidos)::integer
      else 0 end,
    coalesce((
      select -sum(ct.amount_cents)
      from public.credit_transactions ct
      join public.appointments ap on ap.id = ct.appointment_id
      where ct.kind = 'uso'
        and ap.professional_id = prof
        and ap.date between ini and fin
    ), 0)::bigint,
    faltou,
    count(*) filter (where a.status = 'cancelado')::integer,
    case when (concluidos + faltou) > 0
      then ((faltou::numeric * 10000) / (concluidos + faltou))::integer
      else 0 end,
    count(distinct a.client_id) filter (where a.status = 'concluido')::integer,
    count(distinct a.client_id) filter (
      where a.status = 'concluido'
        and not exists (
          select 1 from public.appointments ant
          where ant.professional_id = prof
            and ant.client_id = a.client_id
            and ant.status = 'concluido'
            and ant.date < ini
        )
    )::integer,
    count(*) filter (where a.status = 'concluido' and a.client_id is null)::integer,
    coalesce(sum(
      extract(epoch from (a.end_time - a.start_time)) / 60
    ) filter (where a.status = 'concluido'), 0)::integer,
    public.minutos_disponiveis(prof, ini, ate),
    case when public.minutos_disponiveis(prof, ini, ate) > 0
      then least(10000, ((coalesce(sum(
             extract(epoch from (a.end_time - a.start_time)) / 60
           ) filter (where a.status = 'concluido'), 0) * 10000)
           / public.minutos_disponiveis(prof, ini, ate))::integer)
      else 0 end,
    coalesce((
      select sum(ant.price_cents)
      from public.appointments ant
      where ant.professional_id = prof
        and ant.status = 'concluido'
        and ant.date between ini_ant and fim_ant
    ), 0)::bigint
  from public.appointments a
  where a.professional_id = prof and a.date between ini and fin;
end;
$$;

revoke execute on function public.resumo_do_mes(uuid, date) from public, anon;
grant execute on function public.resumo_do_mes(uuid, date) to authenticated;

-- 3. O que mais rendeu ---------------------------------------------------
create or replace function public.faturamento_por_servico(
  prof uuid default public.my_professional_id(),
  mes date default null
)
returns table (
  servico text,
  quantidade integer,
  total_cents bigint,
  fatia_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  ini date;
  fin date;
  total bigint;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, public.agora_local()::date))::date;
  fin := (ini + interval '1 month - 1 day')::date;

  select coalesce(sum(a.price_cents), 0) into total
  from public.appointments a
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin;

  return query
  select coalesce(a.service_name, s.name, 'Sem nome'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         case when total > 0
           then ((coalesce(sum(a.price_cents), 0)::numeric * 10000) / total)::integer
           else 0 end
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.professional_id = prof and a.status = 'concluido'
    and a.date between ini and fin
  group by coalesce(a.service_name, s.name, 'Sem nome')
  order by 3 desc;
end;
$$;

revoke execute on function public.faturamento_por_servico(uuid, date) from public, anon;
grant execute on function public.faturamento_por_servico(uuid, date) to authenticated;

-- 4. Quem mais volta -----------------------------------------------------
create or replace function public.melhores_clientes(
  prof uuid default public.my_professional_id(),
  meses integer default 6,
  limite integer default 10
)
returns table (
  client_id uuid,
  nome text,
  visitas integer,
  total_cents bigint,
  ultima_visita date
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  desde date;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  desde := (public.agora_local()::date
            - make_interval(months => greatest(1, least(coalesce(meses, 6), 36))))::date;

  return query
  select a.client_id,
         coalesce(c.full_name, 'Cliente'),
         count(*)::integer,
         coalesce(sum(a.price_cents), 0)::bigint,
         max(a.date)
  from public.appointments a
  join public.profiles c on c.id = a.client_id
  where a.professional_id = prof and a.status = 'concluido' and a.date >= desde
  group by a.client_id, c.full_name
  order by 3 desc, 4 desc
  limit greatest(1, least(coalesce(limite, 10), 50));
end;
$$;

revoke execute on function public.melhores_clientes(uuid, integer, integer) from public, anon;
grant execute on function public.melhores_clientes(uuid, integer, integer) to authenticated;

-- 5. O salão inteiro, uma linha por profissional -------------------------
create or replace function public.resumo_do_salao(
  salao uuid default null,
  mes date default null
)
returns table (
  professional_id uuid,
  nome text,
  atendimentos integer,
  faturamento_cents bigint,
  faltas integer,
  ocupacao_bps integer
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  alvo uuid;
  ini date;
  fin date;
  ate date;
  hoje date := public.agora_local()::date;
begin
  -- meus_saloes() devolve os uuid direto, sem nome de coluna
  alvo := coalesce(salao, (select s from public.meus_saloes() s limit 1));
  if alvo is null then
    raise exception 'Informe o salão';
  end if;
  if not public.is_admin_do_salao(alvo) then
    raise exception 'Sem permissão para ver estes números';
  end if;

  ini := date_trunc('month', coalesce(mes, hoje))::date;
  fin := (ini + interval '1 month - 1 day')::date;
  ate := least(fin, hoje);

  return query
  select p.id,
         p.name,
         count(*) filter (where a.status = 'concluido')::integer,
         coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0)::bigint,
         count(*) filter (where a.status = 'faltou')::integer,
         case when public.minutos_disponiveis(p.id, ini, ate) > 0
           then least(10000, ((coalesce(sum(
                  extract(epoch from (a.end_time - a.start_time)) / 60
                ) filter (where a.status = 'concluido'), 0) * 10000)
                / public.minutos_disponiveis(p.id, ini, ate))::integer)
           else 0 end
  from public.professionals p
  left join public.appointments a
    on a.professional_id = p.id and a.date between ini and fin
  where p.salon_id = alvo
  group by p.id, p.name
  order by 4 desc;
end;
$$;

revoke execute on function public.resumo_do_salao(uuid, date) from public, anon;
grant execute on function public.resumo_do_salao(uuid, date) to authenticated;

-- =============================================================
-- >>> 021_dados_teste_historico.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 021: histórico de exemplo
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 020).
--
-- As telas novas (o mês em números e "quem sumiu") só dizem
-- alguma coisa se houver passado. Este arquivo inventa dois
-- meses de atendimentos concluídos, duas clientes a mais e uma
-- cliente que faz tempo que não aparece.
--
-- Rodar de novo é seguro: se o histórico já existe, não repete.
-- =============================================================

set search_path = public, extensions;

do $$
declare
  salao uuid;
  prof uuid;
  serv_limpeza uuid;
  serv_sobrancelha uuid;
  serv_massagem uuid;
  uid_cliente uuid;
  uid_bruna uuid;
  uid_sofia uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  d date;
  i integer;
  clientes uuid[];
  servicos uuid[];
  duracoes integer[];
  precos integer[];
  esc integer;
  hora time;
begin
  select id into salao from public.salons where slug = 'espaco-mel';
  select id into prof from public.professionals where slug = 'ana-paula';
  if salao is null or prof is null then
    raise notice 'Rode o 018 antes: o salão de exemplo ainda não existe.';
    return;
  end if;

  -- 1. Cada serviço ganha o seu ritmo de retorno -------------------------
  update public.services set return_days = 30
    where salon_id = salao and name = 'Limpeza de pele' and return_days is null;
  update public.services set return_days = 21
    where salon_id = salao and name = 'Design de sobrancelhas' and return_days is null;
  update public.services set return_days = 45
    where salon_id = salao and name = 'Massagem relaxante' and return_days is null;
  update public.services set return_days = 60
    where salon_id = salao and name = 'Dia de cuidado' and return_days is null;

  select id into serv_limpeza from public.services
    where salon_id = salao and name = 'Limpeza de pele';
  select id into serv_sobrancelha from public.services
    where salon_id = salao and name = 'Design de sobrancelhas';
  select id into serv_massagem from public.services
    where salon_id = salao and name = 'Massagem relaxante';

  select id into uid_cliente from auth.users where email = 'cliente@exemplo.com';

  -- 2. Mais duas clientes, para o histórico não ser de uma pessoa só -----
  select id into uid_bruna from auth.users where email = 'bruna@exemplo.com';
  if uid_bruna is null then
    uid_bruna := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_bruna, 'authenticated',
      'authenticated', 'bruna@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Bruna Alves","phone":"(13) 99700-1188"}',
      now(), now(), '', '', '', ''
    );
  end if;

  select id into uid_sofia from auth.users where email = 'sofia@exemplo.com';
  if uid_sofia is null then
    uid_sofia := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid_sofia, 'authenticated',
      'authenticated', 'sofia@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Sofia Ramos","phone":"(13) 99700-2244"}',
      now(), now(), '', '', '', ''
    );
  end if;

  -- 3. Dois meses de atendimentos concluídos ----------------------------
  -- (só entra se ainda não houver histórico; assim rodar de novo não duplica)
  if exists (
    select 1 from public.appointments
    where professional_id = prof and status = 'concluido'
  ) then
    raise notice 'Histórico de exemplo já existe — nada a fazer.';
    return;
  end if;

  -- Juliana é a cliente antiga; Bruna começou há pouco (conta como nova
  -- no mês); Sofia é a que sumiu, e só aparece lá embaixo.
  servicos := array[serv_limpeza, serv_sobrancelha, serv_massagem];
  duracoes := array[60, 45, 60];
  precos   := array[12000, 6000, 13000];

  i := 0;
  -- de 62 dias atrás até anteontem, pulando domingo e segunda (folga)
  for d in select generate_series(hoje - 62, hoje - 2, interval '1 day')::date loop
    if extract(dow from d) in (0, 1) then
      continue;
    end if;
    -- dois ou três atendimentos por dia, alternando
    for esc in 1..(2 + (i % 2)) loop
      i := i + 1;
      hora := (time '09:00') + make_interval(hours => (esc - 1) * 3);
      clientes := array[
        case when esc > 1 and d >= hoje - 25 then uid_bruna else uid_cliente end
      ];
      insert into public.appointments
        (client_id, professional_id, service_id, date, start_time, end_time,
         status, price_cents, service_name)
      select clientes[1],
             prof,
             servicos[1 + (i % 3)],
             d,
             hora,
             hora + make_interval(mins => duracoes[1 + (i % 3)]),
             -- uma falta a cada quinze atendimentos, para a taxa não ser zero
             case when i % 15 = 0 then 'faltou' else 'concluido' end,
             precos[1 + (i % 3)],
             s.name
      from public.services s
      where s.id = servicos[1 + (i % 3)]
      on conflict do nothing;
    end loop;
  end loop;

  -- 4. Uma cliente que sumiu --------------------------------------------
  -- Sofia fez sobrancelha (volta em 21 dias) e não aparece há 50
  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time,
     status, price_cents, service_name)
  values (uid_sofia, prof, serv_sobrancelha, hoje - 50, '16:00', '16:45',
          'concluido', 6000, 'Design de sobrancelhas')
  on conflict do nothing;

  raise notice 'Histórico criado: % atendimentos.', i;
end;
$$;

-- =============================================================
-- Conferência rápida
-- =============================================================
select count(*) filter (where status = 'concluido') as concluidos,
       count(*) filter (where status = 'faltou') as faltas,
       min(date) as desde,
       max(date) as ate
from public.appointments a
join public.professionals p on p.id = a.professional_id
where p.slug = 'ana-paula';

-- =============================================================
-- >>> 022_gatilhos.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 022: os gatilhos de verdade
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 021).
--
-- Correção de uma trava que nunca travou.
--
-- O 013 criou o gatilho que impede a cliente de marcar o próprio
-- atendimento como concluído. Ele começa assim:
--
--     if current_user not in ('authenticated', 'anon') then
--       return new;                      -- veio de função do servidor
--     end if;
--
-- Só que a função foi criada como SECURITY DEFINER. Dentro de uma
-- função SECURITY DEFINER, current_user é o DONO da função (postgres),
-- nunca 'authenticated' — então a primeira linha sempre saía fora e o
-- resto do gatilho jamais rodou. Na prática a cliente continuava
-- podendo mandar um PATCH e escrever status = 'concluido'.
--
-- Isso ficou pior agora que os números do mês somam justamente os
-- atendimentos concluídos: seria o faturamento mentindo.
--
-- A correção é uma palavra: SECURITY INVOKER. Aí current_user é
-- 'authenticated' quando a escrita vem da API, e vira o dono da função
-- quando a escrita nasce dentro de uma função nossa — que é
-- exatamente a distinção que o código queria fazer.
--
-- O gatilho não precisa de poder nenhum: ele só lê NEW e OLD e chama
-- is_admin() / is_professional(), que continuam SECURITY DEFINER.
-- =============================================================

-- Quem está falando, sem depender de o papel enxergar o schema auth.
-- O gatilho abaixo roda como SECURITY INVOKER; este atalho é a única
-- coisa nele que precisa de poder.
create or replace function public.meu_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select auth.uid();
$$;

revoke execute on function public.meu_id() from public;
grant execute on function public.meu_id() to anon, authenticated;

create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- escrita nascida dentro de uma função do servidor (SECURITY DEFINER)
  -- ou vinda do service_role: já foi validada lá dentro
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin() or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = public.meu_id() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;

revoke execute on function public.valida_status_agendamento()
  from public, anon, authenticated;

drop trigger if exists on_valida_status on public.appointments;
create trigger on_valida_status
  before insert or update on public.appointments
  for each row execute function public.valida_status_agendamento();

-- A cliente também não muda data nem horário por fora: adiantar é
-- convite, e responder ao convite passa por responder_antecipacao().
-- (o grant de coluna já limitava a status e notes; isto é o cinto)
revoke update on public.appointments from authenticated;
grant update (status, notes) on public.appointments to authenticated;

-- =============================================================
-- >>> 023_whatsapp.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 023: o aviso sai do app e chega no WhatsApp
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 022).
--
-- Aviso dentro do app só alcança quem abriu o app — e a cliente
-- abre uma vez, marca, e some. Aqui o mesmo aviso ganha um segundo
-- caminho: uma fila de saída, com um adaptador de canal na ponta.
--
--   notificar()  ──▶  message_outbox  ──▶  canal do salão
--                                            manual    (wa.me, um toque)
--                                            evolution (chip próprio)
--                                            cloud     (API oficial)
--
-- Trocar de canal é trocar uma linha de configuração. A fila, as
-- tentativas, a janela de silêncio e o "não manda duas vezes" são
-- os mesmos nos três — e é isso que não se joga fora depois.
-- =============================================================

-- 1. Telefone em formato de máquina ---------------------------------------
-- A cliente digita "(13) 99871-0002", "13998710002", "+55 13 99871 0002".
-- O WhatsApp quer 5513998710002. Uma função só, para não ter três
-- jeitos diferentes espalhados pelo código.
create or replace function public.telefone_e164(bruto text)
returns text
language plpgsql
immutable
as $$
declare
  so_digitos text;
begin
  if bruto is null then
    return null;
  end if;

  so_digitos := regexp_replace(bruto, '\D', '', 'g');

  -- tira zeros de operadora na frente (0 13 9...)
  so_digitos := regexp_replace(so_digitos, '^0+', '');

  if length(so_digitos) < 10 then
    return null;              -- não dá para adivinhar o DDD
  end if;

  -- já veio com o país
  if length(so_digitos) in (12, 13) and left(so_digitos, 2) = '55' then
    return so_digitos;
  end if;

  -- DDD + número, com ou sem o nono dígito
  if length(so_digitos) in (10, 11) then
    return '55' || so_digitos;
  end if;

  return null;                -- formato que não reconhecemos
end;
$$;

-- 2. Qual canal cada salão usa -------------------------------------------
-- Segredo (token, api key) NÃO mora aqui: fica nos secrets da Edge
-- Function. Aqui fica só o que identifica a conta e o que a tela mostra.
create table if not exists public.whatsapp_channels (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  canal text not null default 'manual'
    check (canal in ('manual', 'evolution', 'cloud')),
  -- evolution: nome da instância; cloud: o phone_number_id da Meta
  identificador text,
  -- só para mostrar na tela ("mandando de +55 13 99871-0002")
  numero_exibicao text,
  ativo boolean not null default true,
  -- fora desta faixa a mensagem espera o dia seguinte
  silencio_inicio time not null default '21:00',
  silencio_fim time not null default '08:00',
  -- freio de mão: teto de mensagens por dia, por salão
  teto_diario integer not null default 300 check (teto_diario between 0 and 5000),
  criado_em timestamptz not null default now()
);

alter table public.whatsapp_channels enable row level security;

drop policy if exists "admin ve o canal do salao" on public.whatsapp_channels;
create policy "admin ve o canal do salao"
  on public.whatsapp_channels for select
  to authenticated
  using (
    public.is_admin_do_salao(salon_id)
    or exists (
      select 1 from public.professionals p
      where p.salon_id = whatsapp_channels.salon_id
        and public.is_professional(p.id)
    )
  );

drop policy if exists "admin configura o canal" on public.whatsapp_channels;
create policy "admin configura o canal"
  on public.whatsapp_channels for all
  to authenticated
  using (public.is_admin_do_salao(salon_id))
  with check (public.is_admin_do_salao(salon_id));

-- todo salão nasce no canal manual: funciona sem configurar nada
insert into public.whatsapp_channels (salon_id)
select id from public.salons
on conflict (salon_id) do nothing;

create or replace function public.abre_canal_do_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.whatsapp_channels (salon_id)
  values (new.id)
  on conflict (salon_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.abre_canal_do_salao() from public, anon, authenticated;

drop trigger if exists ao_abrir_salao_canal on public.salons;
create trigger ao_abrir_salao_canal
  after insert on public.salons
  for each row execute function public.abre_canal_do_salao();

-- 3. Que tipo de aviso vale uma mensagem ---------------------------------
-- Nem todo aviso merece interromper alguém no WhatsApp. Tabela em vez
-- de constante no código: dá para ligar e desligar sem publicar nada.
create table if not exists public.whatsapp_regras (
  kind text primary key,
  envia boolean not null default true,
  -- 'utilidade' responde a uma ação da cliente; 'marketing' é você
  -- puxando conversa. Na API oficial isso muda a categoria e o preço.
  natureza text not null default 'utilidade'
    check (natureza in ('utilidade', 'marketing')),
  -- colado no fim da mensagem do WhatsApp, nunca no aviso do app.
  -- É aqui que mora o "responda 1" — a pergunta que abre a janela de
  -- 24h e faz a cliente responder sem abrir nada.
  sufixo text
);

alter table public.whatsapp_regras add column if not exists sufixo text;

insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('lembrete_agendamento', true,  'utilidade',
     'Responda 1 para confirmar ou 2 se precisar remarcar.'),
  ('agendamento_confirmado', true, 'utilidade', null),
  ('agendamento_cancelado', true, 'utilidade', null),
  -- estas duas ainda não têm resposta por WhatsApp: mandam para o app,
  -- onde o prazo da oferta é mostrado e contado
  ('vaga_disponivel',      true,  'utilidade',
     'Abra o app para pegar essa vaga — ela fica guardada por pouco tempo.'),
  ('agenda_adiantada',     true,  'utilidade',
     'Abra o app para responder ao convite.'),
  ('pos_atendimento',      false, 'utilidade', null),
  ('convite_retorno',      true,  'marketing',
     'Se não quiser mais receber, responda SAIR.'),
  ('indicacao_creditada',  false, 'utilidade', null),
  ('novo_agendamento',     false, 'utilidade', null),
  ('afiliado_novo',        false, 'utilidade', null),
  ('afiliado_cashback',    false, 'utilidade', null)
on conflict (kind) do nothing;

alter table public.whatsapp_regras enable row level security;

drop policy if exists "todo mundo le as regras" on public.whatsapp_regras;
create policy "todo mundo le as regras"
  on public.whatsapp_regras for select
  to authenticated using (true);

revoke insert, update, delete on public.whatsapp_regras from authenticated, anon;

-- 4. A fila -------------------------------------------------------------
create table if not exists public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete set null,
  client_id uuid references public.profiles (id) on delete set null,
  notification_id uuid references public.notifications (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,

  telefone text not null,
  kind text not null,
  corpo text not null,

  canal text not null default 'manual',
  status text not null default 'na_fila'
    check (status in ('na_fila', 'enviando', 'enviado', 'entregue',
                      'lido', 'falhou', 'cancelado')),

  -- não sai antes disto (janela de silêncio, reagendamento de tentativa)
  liberado_em timestamptz not null default now(),
  tentativas integer not null default 0,
  erro text,
  provider_id text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists outbox_fila_idx
  on public.message_outbox (status, liberado_em)
  where status in ('na_fila', 'enviando');

create index if not exists outbox_salao_idx
  on public.message_outbox (salon_id, criado_em desc);

-- Um lembrete por atendimento, custe o que custar. O reminder_sent_at
-- já cuida disso no caminho normal; este índice é o cinto de segurança
-- para quando alguém chamar a função duas vezes ao mesmo tempo.
create unique index if not exists outbox_um_lembrete_por_appt
  on public.message_outbox (appointment_id, kind)
  where appointment_id is not null
    and kind = 'lembrete_agendamento'
    and status <> 'cancelado';

alter table public.message_outbox enable row level security;

drop policy if exists "equipe ve a fila do salao" on public.message_outbox;
create policy "equipe ve a fila do salao"
  on public.message_outbox for select
  to authenticated
  using (
    public.is_admin_do_salao(salon_id)
    or (professional_id is not null and public.is_professional(professional_id))
  );

-- escrever é só pelas funções abaixo (e pelo service_role, na Edge Function)
revoke insert, update, delete on public.message_outbox from authenticated, anon;

-- 5. Enfileirar ----------------------------------------------------------
-- Decide se este aviso vira mensagem, para quem, por qual canal, e
-- quando pode sair. Chamada pelo notificar(); não é para uso direto.
-- o 025 acrescenta um parâmetro; derrubar as duas formas antes deixa
-- este arquivo re-executável em qualquer ordem
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid);
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;                       -- sem telefone utilizável, fica só no app
  end if;

  -- de qual salão sai a mensagem
  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  -- teto diário do salão: freio de mão contra laço maluco
  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  -- Janela de silêncio: ninguém recebe lembrete de robô às 23h.
  -- No canal manual não vale — quem toca em enviar é gente, e segurar
  -- a mensagem só faria ela sumir da lista dela até as 8h.
  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    -- faixa dentro do mesmo dia
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    -- faixa que atravessa a meia-noite (o caso normal: 21h às 8h)
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  if regra.sufixo is not null then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;

-- 6. O notificar() passa a alimentar a fila ------------------------------
-- Mesma assinatura de sempre: nenhuma das 25 chamadas espalhadas pelo
-- sistema precisa mudar. O aviso continua caindo no app; agora também
-- entra na fila quando as regras deixam.
create or replace function public.notificar(
  destinatario uuid,
  tipo text,
  titulo text,
  texto text default null,
  url text default null,
  carga jsonb default '{}',
  vence_em timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
  carga_ok jsonb := coalesce(carga, '{}'::jsonb);
  prof uuid;
  appt uuid;
  mensagem text;
begin
  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at)
  values (destinatario, tipo, titulo, texto, url, carga_ok, vence_em)
  returning id into novo_id;

  -- o WhatsApp não tem título e corpo: junta os dois numa mensagem só
  mensagem := titulo;
  if texto is not null and btrim(texto) <> '' then
    mensagem := mensagem || E'\n\n' || texto;
  end if;

  begin
    prof := nullif(carga_ok ->> 'professional_id', '')::uuid;
  exception when others then prof := null;
  end;

  begin
    appt := nullif(carga_ok ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;

  -- a fila nunca derruba o aviso: se algo der errado aqui, o app avisa
  -- do mesmo jeito e a mensagem simplesmente não sai
  begin
    perform public.enfileirar_whatsapp(novo_id, destinatario, tipo, mensagem, prof, appt);
  exception when others then
    null;
  end;

  return novo_id;
end;
$$;

revoke execute on function public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- 7. O que a profissional precisa enviar na mão --------------------------
-- No canal manual o app não manda: ele deixa pronto. Esta função
-- devolve a fila dela, com o link do WhatsApp já montado.
create or replace function public.fila_para_enviar(
  prof uuid default public.my_professional_id()
)
returns table (
  id uuid,
  cliente text,
  telefone text,
  kind text,
  corpo text,
  link text,
  criado_em timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  return query
  select o.id,
         coalesce(c.full_name, 'Cliente'),
         o.telefone,
         o.kind,
         o.corpo,
         'https://wa.me/' || o.telefone
           || '?text=' || public.url_encode_simples(o.corpo),
         o.criado_em
  from public.message_outbox o
  left join public.profiles c on c.id = o.client_id
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now()
  order by o.criado_em;
end;
$$;

-- Codificação de URL suficiente para o corpo de um link do WhatsApp.
-- (o Postgres não traz uma pronta que sirva aqui)
create or replace function public.url_encode_simples(txt text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case
      when letra ~ '[A-Za-z0-9._~-]' then letra
      -- "ç" são dois bytes em UTF-8, e cada byte quer o seu próprio %
      else regexp_replace(
             upper(encode(convert_to(letra, 'UTF8'), 'hex')),
             '(..)', '%\1', 'g')
    end,
    '' order by i
  ), '')
  from generate_series(1, coalesce(length(txt), 0)) as i,
       lateral (select substring(txt from i for 1) as letra) l;
$$;

revoke execute on function public.url_encode_simples(text) from public, anon;
grant execute on function public.url_encode_simples(text) to authenticated;

revoke execute on function public.fila_para_enviar(uuid) from public, anon;
grant execute on function public.fila_para_enviar(uuid) to authenticated;

-- Ela abriu o WhatsApp e mandou: some da lista.
create or replace function public.marcar_enviada_na_mao(mensagem_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.message_outbox%rowtype;
begin
  select * into m from public.message_outbox where id = mensagem_id;
  if not found then
    raise exception 'Mensagem não encontrada';
  end if;
  if not (public.is_admin_do_salao(m.salon_id)
          or (m.professional_id is not null and public.is_professional(m.professional_id))) then
    raise exception 'Sem permissão';
  end if;

  update public.message_outbox
  set status = 'enviado', enviado_em = now(), canal = 'manual'
  where id = mensagem_id and status = 'na_fila';
end;
$$;

revoke execute on function public.marcar_enviada_na_mao(uuid) from public, anon;
grant execute on function public.marcar_enviada_na_mao(uuid) to authenticated;

-- Não vou mandar essa: tira da fila sem mandar.
create or replace function public.descartar_da_fila(mensagem_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  m public.message_outbox%rowtype;
begin
  select * into m from public.message_outbox where id = mensagem_id;
  if not found then
    raise exception 'Mensagem não encontrada';
  end if;
  if not (public.is_admin_do_salao(m.salon_id)
          or (m.professional_id is not null and public.is_professional(m.professional_id))) then
    raise exception 'Sem permissão';
  end if;

  update public.message_outbox
  set status = 'cancelado'
  where id = mensagem_id and status in ('na_fila', 'falhou');
end;
$$;

revoke execute on function public.descartar_da_fila(uuid) from public, anon;
grant execute on function public.descartar_da_fila(uuid) to authenticated;

-- Quantas estão esperando a mão dela (para o aviso na agenda)
create or replace function public.quantas_para_enviar(
  prof uuid default public.my_professional_id()
)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
  n integer;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    return 0;
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    return 0;
  end if;

  select count(*) into n
  from public.message_outbox o
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now();

  return coalesce(n, 0);
end;
$$;

revoke execute on function public.quantas_para_enviar(uuid) from public, anon;
grant execute on function public.quantas_para_enviar(uuid) to authenticated;

-- =============================================================
-- >>> 024_resposta_whatsapp.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 024: a resposta da cliente mexe na agenda
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 023).
--
-- O lembrete termina em pergunta:
--
--     Amanhã tem horário marcado
--     Limpeza de pele com Ana Paula, 31/08 às 10:00.
--     Responda 1 para confirmar ou 2 se precisar remarcar.
--
-- Ela responde "1" e o agendamento confirma sozinho. Responde "2" e
-- cancela — e o gatilho da onda 1 já oferece a vaga para a fila de
-- espera, sem ninguém tocar em nada. Responde "sair" e não recebe
-- mais mensagem nenhuma.
--
-- Tudo pelo telefone, sem login: quem chega aqui é o webhook, e ele
-- entra como service_role. Nenhuma destas funções é exposta à
-- cliente nem ao app.
-- =============================================================

-- 1. Registro do que entrou ----------------------------------------------
-- Guardar a mensagem crua vale ouro no dia em que alguém disser
-- "eu cancelei e vocês cobraram mesmo assim".
create table if not exists public.whatsapp_inbox (
  id uuid primary key default gen_random_uuid(),
  telefone text not null,
  texto text,
  provider_id text unique,
  client_id uuid references public.profiles (id) on delete set null,
  -- sair | confirmado | cancelado | nada | sem_cadastro | sem_horario
  -- | fora_de_contexto
  acao text,
  appointment_id uuid references public.appointments (id) on delete set null,
  recebido_em timestamptz not null default now()
);

create index if not exists inbox_telefone_idx
  on public.whatsapp_inbox (telefone, recebido_em desc);

alter table public.whatsapp_inbox enable row level security;

drop policy if exists "equipe le as respostas" on public.whatsapp_inbox;
create policy "equipe le as respostas"
  on public.whatsapp_inbox for select
  to authenticated
  using (client_id is not null and public.atende_esta_cliente(client_id));

revoke insert, update, delete on public.whatsapp_inbox from authenticated, anon;

-- 2. De telefone para pessoa ---------------------------------------------
create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_e164(p.phone) = public.telefone_e164(tel)
  order by p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- 3. O próximo horário dela ----------------------------------------------
-- "1" e "2" se referem sempre ao atendimento mais próximo que ainda
-- não aconteceu. É o que ela tem na cabeça quando responde.
create or replace function public.proximo_agendamento_da_cliente(cliente uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select a.id
  from public.appointments a
  where a.client_id = cliente
    and a.status in ('pendente', 'confirmado')
    and (a.date + a.start_time) > public.agora_local()
  order by a.date, a.start_time
  limit 1;
$$;

revoke execute on function public.proximo_agendamento_da_cliente(uuid)
  from public, anon, authenticated;

-- 4. Sobre o que ela está respondendo ------------------------------------
-- "1" sozinho não quer dizer nada: quer dizer alguma coisa em relação à
-- última mensagem que saiu daqui. Sem isso, um "1" respondendo ao
-- convite de retorno confirmaria um atendimento que ela nem lembra.
create or replace function public.ultimo_assunto_enviado(tel text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select o.kind
  from public.message_outbox o
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
    and o.enviado_em > now() - interval '48 hours'
  order by o.enviado_em desc
  limit 1;
$$;

revoke execute on function public.ultimo_assunto_enviado(text)
  from public, anon, authenticated;

-- 5. O que a resposta quis dizer -----------------------------------------
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  -- tira acento, pontuação e espaço: "Sim!" e "sim" são a mesma coisa
  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- 6. A porta de entrada --------------------------------------------------
-- Chamada pela Edge Function do webhook, como service_role. Devolve o
-- que fazer com a resposta — a Edge Function usa isso para escrever de
-- volta no WhatsApp.
-- o 028 troca a assinatura; derrubar as duas antes deixa re-executável
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo provider_id chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sair');

    return jsonb_build_object(
      'acao', 'sair',
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
    );
  end if;

  -- ------------------------------------------------------------------
  -- Daqui para baixo precisa saber de quem é o telefone
  -- ------------------------------------------------------------------
  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao)
    values (e164, texto, id_provedor, 'sem_cadastro');
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'nada');
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário.
  -- Respondeu 1 para o convite de retorno? Não confirmamos nada por
  -- conta própria — fica registrado para a profissional ver.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto');
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao)
    values (e164, texto, id_provedor, cliente, 'sem_horario');
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', 'Não encontrei nenhum horário marcado no seu nome. ' ||
                   'Se precisar, é só marcar pelo app.'
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', 'Confirmado! Te espero dia ' || to_char(appt.date, 'DD/MM') ||
                   ' às ' || to_char(appt.start_time, 'HH24:MI') || '.'
    );

  else
    -- cancela: o gatilho da lista de espera cuida de oferecer a vaga
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', 'Tudo bem, cancelei o seu horário de ' ||
                   to_char(appt.date, 'DD/MM') || ' às ' ||
                   to_char(appt.start_time, 'HH24:MI') ||
                   '. Quando quiser remarcar, é só abrir o app.'
    );

    -- a profissional precisa saber que abriu um buraco na agenda dela
    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text)
  from public, anon, authenticated;

-- Por onde responder a ela: o mesmo canal que entregou a última
-- mensagem. Ela respondeu, então a janela de 24h está aberta e a
-- resposta sai sem template e sem custo.
create or replace function public.canal_do_telefone(tel text)
returns table (canal text, identificador text)
language sql
stable
security definer set search_path = public
as $$
  select c.canal, c.identificador
  from public.message_outbox o
  join public.whatsapp_channels c on c.salon_id = o.salon_id
  where o.telefone = public.telefone_e164(tel)
    and o.status in ('enviado', 'entregue', 'lido')
  order by o.enviado_em desc nulls last
  limit 1;
$$;

revoke execute on function public.canal_do_telefone(text)
  from public, anon, authenticated;

-- 7. Status de entrega ---------------------------------------------------
-- O provedor avisa que entregou, que a cliente leu, ou que falhou.
create or replace function public.atualizar_status_envio(
  id_provedor text,
  novo_status text,
  detalhe text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if novo_status not in ('enviado', 'entregue', 'lido', 'falhou') then
    return;
  end if;

  update public.message_outbox
  set status = novo_status,
      erro = case when novo_status = 'falhou' then detalhe else erro end
  where provider_id = id_provedor
    -- nunca volta atrás: "entregue" que chega depois de "lido" é ruído
    and case novo_status
          when 'enviado'  then status in ('enviando')
          when 'entregue' then status in ('enviando', 'enviado')
          when 'lido'     then status in ('enviando', 'enviado', 'entregue')
          when 'falhou'   then status in ('enviando', 'enviado')
        end;
end;
$$;

revoke execute on function public.atualizar_status_envio(text, text, text)
  from public, anon, authenticated;

-- 8. O que a Edge Function chama para pegar trabalho ---------------------
-- Marca como 'enviando' e devolve, numa tacada só, para duas chamadas
-- ao mesmo tempo não pegarem a mesma mensagem.
-- o 025 muda o formato de retorno desta função; derrubar antes deixa
-- o arquivo re-executável mesmo depois dele ter passado
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  corpo text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.corpo
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone, m.corpo
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- Deu erro no envio: volta para a fila com espera crescente, ou desiste.
create or replace function public.devolver_para_fila(
  mensagem_id uuid,
  motivo text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  t integer;
begin
  select tentativas into t from public.message_outbox where id = mensagem_id;
  if not found then
    return;
  end if;

  if t >= 4 then
    update public.message_outbox
    set status = 'falhou', erro = motivo
    where id = mensagem_id;
  else
    -- 2, 8, 32 minutos: dá tempo de a instância voltar sozinha
    update public.message_outbox
    set status = 'na_fila',
        erro = motivo,
        liberado_em = now() + make_interval(mins => power(4, t)::integer * 2)
    where id = mensagem_id;
  end if;
end;
$$;

revoke execute on function public.devolver_para_fila(uuid, text)
  from public, anon, authenticated;

-- Erro que não melhora tentando de novo (número errado, fora da janela,
-- conta mal configurada): desiste na hora em vez de gastar 4 tentativas.
create or replace function public.falhar_de_vez(
  mensagem_id uuid,
  motivo text
)
returns void
language sql
security definer set search_path = public
as $$
  update public.message_outbox
  set status = 'falhou', erro = motivo, tentativas = 4
  where id = mensagem_id;
$$;

revoke execute on function public.falhar_de_vez(uuid, text)
  from public, anon, authenticated;

-- Enviou: guarda o id do provedor para casar com o status depois.
create or replace function public.confirmar_envio(
  mensagem_id uuid,
  id_provedor text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.message_outbox
  set status = 'enviado',
      enviado_em = now(),
      provider_id = coalesce(id_provedor, provider_id),
      erro = null
  where id = mensagem_id;
end;
$$;

revoke execute on function public.confirmar_envio(uuid, text)
  from public, anon, authenticated;

-- =============================================================
-- OPCIONAL — deixar a fila andando sozinha
--
-- Sem isto, a fila só é drenada quando alguém chama a Edge Function.
-- Com isto, ela anda de minuto em minuto, e o lembrete de véspera sai
-- às 19h sem ninguém abrir nada.
--
-- Ative as extensões em Database → Extensions (pg_cron e pg_net) e
-- rode o bloco abaixo trocando as duas linhas marcadas.
-- =============================================================

-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'agenda-mel-envia-whatsapp',
--   '* * * * *',
--   $cron$
--     select net.http_post(
--       url     := 'https://SEU-PROJETO.supabase.co/functions/v1/enviar-whatsapp',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
--
-- -- e os lembretes de véspera, de hora em hora:
-- select cron.schedule(
--   'agenda-mel-lembretes',
--   '0 * * * *',
--   $cron$ select public.enviar_lembretes(); $cron$
-- );
--
-- -- para conferir:   select * from cron.job;
-- -- para desligar:   select cron.unschedule('agenda-mel-envia-whatsapp');

-- =============================================================
-- >>> 025_botoes.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 025: botão em vez de digitar 1
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 024).
--
-- "Responda 1 para confirmar" funciona, mas pedir para a cliente
-- digitar é atrito. O WhatsApp tem botão de resposta — até três.
--
-- Só que botão vindo de cliente não-oficial (Evolution/Baileys) é
-- instável: em alguns aparelhos renderiza, em outros chega como
-- texto puro. Então o desenho aqui é: tenta o botão, e se o envio
-- falhar, manda o texto de sempre. O "1" digitado continua valendo
-- nos dois casos, e quem toca no botão devolve exatamente o mesmo
-- "1" — o resto do sistema nem fica sabendo a diferença.
-- =============================================================

-- 1. O título separado do corpo -----------------------------------------
-- O texto sai como um bloco só ("título\n\ncorpo"), mas o botão quer
-- os dois separados. Guardar separado é mais simples do que tentar
-- fatiar de volta na hora do envio.
alter table public.message_outbox
  add column if not exists titulo text;

-- 2. Que botões cada tipo de aviso leva ----------------------------------
alter table public.whatsapp_regras
  add column if not exists botoes jsonb;

update public.whatsapp_regras
set botoes = '[
      {"type": "reply", "displayText": "Confirmar",        "id": "1"},
      {"type": "reply", "displayText": "Preciso remarcar", "id": "2"}
    ]'::jsonb
where kind = 'lembrete_agendamento' and botoes is null;

-- 3. O salão pode desligar os botões -------------------------------------
alter table public.whatsapp_channels
  add column if not exists usa_botoes boolean not null default true;

-- 4. Enfileirar guardando o título ---------------------------------------
-- Ganhou um parâmetro, então a versão de seis argumentos precisa sair
-- de cena — senão ficam as duas e o Postgres não sabe qual chamar.
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- Com botão o sufixo vira redundante: o "Responda 1" está escrito
  -- no próprio botão. Sem botão, o sufixo é o que ensina a responder.
  if regra.sufixo is not null
     and not (canal.usa_botoes and regra.botoes is not null and canal.canal <> 'manual') then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, cabecalho, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 5. O notificar() passa o título ----------------------------------------
create or replace function public.notificar(
  destinatario uuid,
  tipo text,
  titulo text,
  texto text default null,
  url text default null,
  carga jsonb default '{}',
  vence_em timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
  carga_ok jsonb := coalesce(carga, '{}'::jsonb);
  prof uuid;
  appt uuid;
  corpo text;
begin
  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at)
  values (destinatario, tipo, titulo, texto, url, carga_ok, vence_em)
  returning id into novo_id;

  corpo := coalesce(nullif(btrim(coalesce(texto, '')), ''), titulo);

  begin
    prof := nullif(carga_ok ->> 'professional_id', '')::uuid;
  exception when others then prof := null;
  end;

  begin
    appt := nullif(carga_ok ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;

  begin
    perform public.enfileirar_whatsapp(novo_id, destinatario, tipo, corpo, prof, appt, titulo);
  exception when others then
    null;
  end;

  return novo_id;
end;
$$;

revoke execute on function
  public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- 6. A fila entrega título e botões para quem envia ----------------------
-- O Postgres não deixa trocar o formato de retorno com "create or
-- replace": tem de derrubar antes.
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when c.usa_botoes then r.botoes else null end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- 7. A fila manual continua com o texto inteiro --------------------------
-- No canal manual não existe botão: a profissional copia e cola.
-- Ali o corpo precisa carregar título e sufixo, como antes.
create or replace function public.fila_para_enviar(
  prof uuid default public.my_professional_id()
)
returns table (
  id uuid,
  cliente text,
  telefone text,
  kind text,
  corpo text,
  link text,
  criado_em timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  p public.professionals%rowtype;
begin
  select * into p from public.professionals where professionals.id = prof;
  if not found then
    raise exception 'Profissional não encontrada';
  end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id)) then
    raise exception 'Sem permissão';
  end if;

  return query
  select o.id,
         coalesce(c.full_name, 'Cliente'),
         o.telefone,
         o.kind,
         case
           when o.titulo is not null and btrim(o.titulo) <> ''
             then o.titulo || E'\n\n' || o.corpo
           else o.corpo
         end,
         'https://wa.me/' || o.telefone || '?text=' ||
           public.url_encode_simples(
             case
               when o.titulo is not null and btrim(o.titulo) <> ''
                 then o.titulo || E'\n\n' || o.corpo
               else o.corpo
             end),
         o.criado_em
  from public.message_outbox o
  left join public.profiles c on c.id = o.client_id
  where o.professional_id = prof
    and o.canal = 'manual'
    and o.status = 'na_fila'
    and o.liberado_em <= now()
  order by o.criado_em;
end;
$$;

revoke execute on function public.fila_para_enviar(uuid) from public, anon;
grant execute on function public.fila_para_enviar(uuid) to authenticated;

-- =============================================================
-- >>> 026_botao_so_na_oficial.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 026: botão só na API oficial
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 025).
--
-- O 025 mandou botão pela Evolution. Resultado no aparelho:
--
--     "Não foi possível carregar a mensagem.
--      Use seu celular para acessá-la."
--
-- E no celular também não aparecia. A mensagem se perdeu.
--
-- O que aconteceu: o WhatsApp restringiu mensagem interativa vinda
-- de cliente não-oficial. A Evolution monta o pacote, o servidor do
-- WhatsApp aceita e entrega — e o aplicativo de quem recebe não sabe
-- desenhar aquilo. A API devolve 200, o banco marca "enviado", e a
-- cliente não vê nada. O plano B do 025 não salva porque ele só age
-- quando a API RECUSA; aqui ela aprovou.
--
-- Não dá para detectar isso do lado de cá. Então botão passa a sair
-- só no canal 'cloud', a API oficial da Meta, onde mensagem
-- interativa é de primeira classe e sempre renderiza.
--
-- No canal 'evolution' volta o texto com "Responda 1 para confirmar
-- ou 2 se precisar remarcar" — que é feio, e funciona.
--
-- Não é porta trancada: usa_botoes continua ligável na Evolution para
-- quem quiser tentar. Duas coisas mudam a chance de renderizar, e as
-- duas dependem do número, não do código:
--
--   • o chip ser conta WhatsApp BUSINESS (o app verde escuro, grátis)
--     em vez de WhatsApp comum
--   • a cliente ter escrito para você nas últimas 24h
--
-- Se for tentar: ligue, mande UMA mensagem, confira no aparelho, e
-- desligue se não aparecer. Cada tentativa que não renderiza é uma
-- mensagem que a cliente nunca vê.
-- =============================================================

-- 1. Desliga onde já estava ligado ---------------------------------------
update public.whatsapp_channels set usa_botoes = false where usa_botoes;

alter table public.whatsapp_channels alter column usa_botoes set default false;

comment on column public.whatsapp_channels.usa_botoes is
  'Botão de resposta. Na cloud funciona sempre. Na Evolution o WhatsApp '
  'costuma entregar sem o aparelho conseguir desenhar, e a mensagem se '
  'perde sem erro — por isso nasce desligado. Vale tentar de novo se o '
  'número virar conta WhatsApp Business.';

-- 2. Uma regra só, em um lugar só ----------------------------------------
-- Duas funções precisavam decidir a mesma coisa (mandar botão?) e
-- precisam decidir igual: se divergirem, o sufixo "responda 1" some
-- de uma mensagem que vai sair sem botão nenhum.
--
-- A porta continua destrancada: quem quiser experimentar botão na
-- Evolution é só ligar usa_botoes de novo. O padrão é desligado
-- porque é o que comprovadamente chega.
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes and c.canal in ('cloud', 'evolution')
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- 3. O sufixo volta quando não há botão ----------------------------------
create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- só cai fora quando o botão realmente vai junto e vai renderizar
  if regra.sufixo is not null
     and not (regra.botoes is not null and public.canal_manda_botao(salao)) then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, cabecalho, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. A fila só entrega botão para o canal que sabe usar ------------------
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- 5. Reabre o que se perdeu ----------------------------------------------
-- Mensagem marcada "enviado" que na verdade não renderizou volta para a
-- fila, agora como texto. Só as de hoje, e só as que levaram botão.
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';

-- =============================================================
-- >>> 027_estilo_do_botao.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 027: o botão que renderiza
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 026).
--
-- O botão "nativo" (nativeFlowMessage) não desenha em cliente
-- não-oficial. Mas o WhatsApp tem outro jeito de oferecer opções
-- tocáveis que é recurso de CONSUMIDOR, e por isso renderiza em
-- qualquer aparelho: a ENQUETE.
--
--     Amanhã tem horário marcado
--     Design de sobrancelhas com Ana Paula dia 02/09 às 10:30.
--
--      ○ Confirmar
--      ○ Preciso remarcar
--
-- A cliente toca, o voto volta descriptografado (a Evolution 2.3.7
-- faz isso, linhas ~1206-1303 do serviço Baileys), e o webhook
-- traduz para "1" ou "2" — o resto do sistema nem nota.
--
-- Cada salão escolhe o estilo. O padrão é o que comprovadamente
-- aparece.
-- =============================================================

alter table public.whatsapp_channels
  add column if not exists estilo_botao text not null default 'enquete'
    check (estilo_botao in ('enquete', 'lista', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'enquete = poll do WhatsApp (renderiza em todo aparelho — testado); '
  'lista = listMessage (a Evolution 2.3.7 RECUSA com "this.isZero is '
  'not a function"; cai para texto); '
  'nativo = nativeFlow buttons (a API aceita, o aparelho não desenha, '
  'a mensagem se perde). Na cloud qualquer estilo vira botão de verdade.';

-- com a enquete funcionando, botão volta a nascer ligado
alter table public.whatsapp_channels alter column usa_botoes set default true;
update public.whatsapp_channels set usa_botoes = true where not usa_botoes;

-- A regra: manda opção tocável quando o salão quer E o canal é
-- automático. Qual estilo, quem decide é o adaptador, lendo a coluna.
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes and c.canal in ('cloud', 'evolution')
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- A fila entrega o estilo junto com os botões
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb,
  estilo_botao text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end,
         c.estilo_botao
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- O texto da opção também é entendido, caso chegue como texto
-- (alguém digita "Confirmar" em vez de tocar)
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo', 'preciso remarcar') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- Reabre as que saíram como botão nativo e não renderizaram
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';

-- =============================================================
-- >>> 028_primeiro_voto_vale.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 028: texto por padrão, e o primeiro voto vale
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 027).
--
-- Duas decisões de produto, depois do teste no aparelho:
--
-- 1. ENQUETE NÃO É CONFIRMAÇÃO. Ela renderiza em todo lugar, mas na
--    tela da cliente diz "pesquisa", com "1 voto" e "ver votos" em
--    volta. Sobre um horário marcado, não faz sentido. Então o padrão
--    na Evolution volta a ser TEXTO com "Responda 1 para confirmar ou
--    2 se precisar remarcar" — feio, honesto, e chega. A enquete fica
--    disponível como estilo para outro uso (pesquisa com clientes).
--    Botão de verdade é coisa da API oficial (canal cloud).
--
-- 2. O PRIMEIRO VOTO VALE. Onde a enquete for usada, o WhatsApp deixa
--    trocar o voto e cada troca chega como evento novo. Sem trava,
--    "Confirmar" e depois "Preciso remarcar" confirmava e cancelava o
--    mesmo horário em sequência. Agora o primeiro age; os seguintes
--    recebem "já registrado, fale com a profissional".
-- =============================================================

-- 1. Estilo 'texto' como padrão; 'lista' sai (a 2.3.7 recusa) ------------
alter table public.whatsapp_channels drop constraint if exists whatsapp_channels_estilo_botao_check;
update public.whatsapp_channels set estilo_botao = 'texto' where estilo_botao in ('enquete', 'lista');
alter table public.whatsapp_channels alter column estilo_botao set default 'texto';
alter table public.whatsapp_channels
  add constraint whatsapp_channels_estilo_botao_check
  check (estilo_botao in ('texto', 'enquete', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'texto = "Responda 1 ou 2" (padrão na Evolution; funciona sempre); '
  'enquete = poll do WhatsApp (renderiza, mas parece pesquisa — para '
  'outro uso); nativo = botão interativo (só a Cloud API desenha). '
  'No canal cloud, qualquer estilo vira botão de verdade.';

-- botão só quando vai renderizar como botão, ou quando o salão pediu
-- a enquete de propósito
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes
            and (c.canal = 'cloud'
                 or (c.canal = 'evolution' and c.estilo_botao = 'enquete'))
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- 2. O primeiro voto vale --------------------------------------------------
-- (o 029 recria enfileirar_whatsapp; nada a derrubar aqui)

alter table public.whatsapp_inbox
  add column if not exists enquete_id text;

create index if not exists inbox_enquete_idx
  on public.whatsapp_inbox (enquete_id)
  where enquete_id is not null;

drop function if exists public.receber_resposta_whatsapp(text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo evento chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Voto trocado na mesma enquete: o primeiro já valeu
  -- ------------------------------------------------------------------
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id, id_enquete);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          'Sua resposta já foi registrada'
          || case when ja_votou.acao = 'confirmado' then ' (horário confirmado)' else ' (horário cancelado)' end
          || '. Para mudar, é só falar aqui com a ' || coalesce(prof.name, 'profissional') || '.'
      );
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete);

    return jsonb_build_object(
      'acao', 'sair',
      'responder', 'Pronto, não mando mais lembretes por aqui. ' ||
                   'Se mudar de ideia, é só ligar de novo no app.'
    );
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, enquete_id)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete);
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', 'Recebi! Para marcar ou mudar um horário, é só abrir o app.'
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', 'Não encontrei nenhum horário marcado no seu nome. ' ||
                   'Se precisar, é só marcar pelo app.'
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', 'Confirmado! Te espero dia ' || to_char(appt.date, 'DD/MM') ||
                   ' às ' || to_char(appt.start_time, 'HH24:MI') || '.'
    );

  else
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', 'Tudo bem, cancelei o seu horário de ' ||
                   to_char(appt.date, 'DD/MM') || ' às ' ||
                   to_char(appt.start_time, 'HH24:MI') ||
                   '. Quando quiser remarcar, é só abrir o app.'
    );

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text, text)
  from public, anon, authenticated;

-- =============================================================
-- >>> 029_texto_bonito.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 029: a mensagem do WhatsApp com cara de mensagem
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 028).
--
-- O aviso dentro do app é seco de propósito — sem emoji, tipografia
-- do sistema. No WhatsApp é o contrário: mensagem sem emoji parece
-- robô. Então o texto do WhatsApp deixa de ser "título + corpo" do
-- app e passa a ser montado aqui, por tipo, com *negrito*, emoji e
-- o link da agenda da profissional.
--
-- O link só entra quando o salão tem endereço público gravado
-- (salons.app_url). Sem ele, a mensagem sai sem a linha do link —
-- melhor que mandar localhost para a cliente.
-- =============================================================

-- 1. O endereço público do app, por salão -------------------------------
alter table public.salons
  add column if not exists app_url text
    check (app_url is null or app_url ~ '^https?://');

comment on column public.salons.app_url is
  'Endereço público do app (ex.: https://agendamel.vercel.app). '
  'É o que vai nos links das mensagens de WhatsApp. Sem barra no fim.';

-- a dona do salão grava isso pela tela de horários
drop policy if exists "admin edita o salao" on public.salons;
create policy "admin edita o salao"
  on public.salons for update
  to authenticated
  using (public.is_admin_do_salao(id))
  with check (public.is_admin_do_salao(id));

grant update (app_url, name, brand_color) on public.salons to authenticated;

-- 2. O texto, por tipo ---------------------------------------------------
create or replace function public.montar_texto_whatsapp(
  tipo text,
  titulo text,
  corpo text,
  appt uuid,
  prof uuid,
  cliente uuid
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  -- variáveis escalares, não RECORD: no plpgsql, ler um campo de um
  -- record que nunca foi atribuído levanta erro, e como o notificar()
  -- engole exceções da fila, a mensagem sumiria em silêncio. Foi o que
  -- aconteceu com "chamar de volta", que não tem agendamento.
  d_data date;
  d_hora time;
  servico text;
  prof_nome text;
  prof_slug text;
  base text;
  link text;
  link_app text;
  nome_cliente text;
  quando text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name), ap.professional_id
      into d_data, d_hora, servico, prof
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    where ap.id = appt;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/')
      into prof_nome, prof_slug, base
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente
    from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then
      link := base || '/p/' || prof_slug;
    end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
  end if;

  case tipo

  when 'lembrete_agendamento' then
    return
      '📅 *Amanhã tem horário marcado*' || E'\n\n'
      || 'Oi' || coalesce(', ' || nome_cliente, '') || '! Só passando pra lembrar:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Responda *1* pra confirmar, ou *2* se precisar remarcar.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_confirmado' then
    return
      '✅ *Horário confirmado*' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Te esperamos! 💛'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *Horário cancelado*' || E'\n\n'
      || coalesce(servico, 'Seu atendimento') || coalesce(' de ' || quando, '')
      || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só escolher um horário novo'
      || coalesce(': ' || link, ' pelo app.');

  when 'convite_retorno' then
    return
      '💛 *Oi' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Faz um tempo que você não aparece — a agenda está aberta.')
      || E'\n\n'
      || '📅 Escolha um horário' || coalesce(': ' || link, ' pelo app.') || E'\n\n'
      || '_Se não quiser mais receber, responda SAIR._';

  when 'pos_atendimento' then
    return
      '💆 *Obrigada pela visita' || coalesce(', ' || nome_cliente, '') || '!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), 'Esperamos você de novo.')
      -- o corpo do 019 já pergunta "quer já deixar marcado?"; aqui só o link
      || coalesce(E'\n\n' || '📅 ' || link, '');

  when 'vaga_disponivel' then
    return
      '⏰ *Abriu uma vaga!*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '⚡ Ela fica guardada pra você por pouco tempo — abra o app pra pegar'
      || coalesce(': ' || link_app, '.');

  when 'agenda_adiantada' then
    return
      '⏰ *Dá pra vir mais cedo?*' || E'\n\n'
      || coalesce(nullif(btrim(corpo), ''), '') || E'\n\n'
      || '👉 Responda pelo app' || coalesce(': ' || link_app, '.');

  else
    -- tipo sem tratamento próprio: título em negrito e o corpo, sem invenção
    return '*' || coalesce(titulo, '') || '*'
      || coalesce(E'\n\n' || nullif(btrim(coalesce(corpo, '')), ''), '');
  end case;
end;
$$;

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- 3. A fila usa o texto bonito -------------------------------------------
drop function if exists public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text);

create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
  bonito text;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- O texto do WhatsApp é montado por tipo, com emoji e link. Quando
  -- um botão de verdade vai junto (cloud) ou o salão pediu enquete, o
  -- "Responda 1" já não faz sentido — o montador ainda o inclui no
  -- lembrete; tudo bem: a cloud usa titulo+corpo próprios via botoes.
  bonito := public.montar_texto_whatsapp(tipo, cabecalho, texto, appt, prof, destinatario);

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, null, coalesce(bonito, texto), canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. As respostas automáticas também ganham cara -----------------------
-- (só o texto muda; a lógica é a do 028)
create or replace function public.texto_resposta(tipo text, quando text, prof text)
returns text
language sql
immutable
as $$
  select case tipo
    when 'confirmado' then
      '✅ *Confirmado!* Te espero dia ' || quando || '. 💛'
    when 'cancelado' then
      '❌ Tudo bem, cancelei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Quando quiser remarcar, é só abrir o app. 🙂'
    when 'sem_horario' then
      '🤔 Não encontrei nenhum horário marcado no seu nome.' || E'\n\n'
      || 'Se precisar, é só marcar pelo app.'
    when 'fora_de_contexto' then
      '👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.'
    when 'sair' then
      '👋 Pronto, não mando mais lembretes por aqui.' || E'\n'
      || 'Se mudar de ideia, é só ligar de novo no app.'
    when 'voto_repetido_confirmado' then
      'Sua resposta já foi registrada ✅ (horário confirmado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    when 'voto_repetido_cancelado' then
      'Sua resposta já foi registrada ❌ (horário cancelado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    else ''
  end;
$$;

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 5. receber_resposta_whatsapp, agora respondendo bonito -------------
drop function if exists public.receber_resposta_whatsapp(text, text, text);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- o mesmo evento chegando duas vezes não age duas vezes
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);
  acao := public.interpretar_resposta(texto);

  -- ------------------------------------------------------------------
  -- Voto trocado na mesma enquete: o primeiro já valeu
  -- ------------------------------------------------------------------
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id, id_enquete);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          public.texto_resposta('voto_repetido_' || ja_votou.acao, null, coalesce(prof.name, 'profissional'))
      );
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Sair: vale mesmo para quem não tem conta no app
  -- ------------------------------------------------------------------
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox
      set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete);

    return jsonb_build_object(
      'acao', 'sair',
      'responder', public.texto_resposta('sair', null, null)
    );
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, enquete_id)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- 1 e 2 só mexem na agenda quando a conversa é sobre um horário
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete);
    return jsonb_build_object(
      'acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null)
    );
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete);
    return jsonb_build_object(
      'acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null)
    );
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;

  if acao = 'confirma' then
    update public.appointments
    set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || to_char(appt.date, 'DD/MM') ||
        ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object(
      'acao', 'confirmado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

  else
    update public.appointments
    set status = 'cancelado'
    where id = appt_id;

    resposta := jsonb_build_object(
      'acao', 'cancelado',
      'appointment_id', appt_id,
      'responder', public.texto_resposta('cancelado',
                     to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI'), null)
    );

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || to_char(appt.date, 'DD/MM') ||
          ' às ' || to_char(appt.start_time, 'HH24:MI') || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete);

  return resposta;
end;
$$;

revoke execute on function public.receber_resposta_whatsapp(text, text, text, text)
  from public, anon, authenticated;

-- =============================================================
-- >>> 030_porteiro_da_ia.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 030: o porteiro da IA
--
-- Sem isto, toda mensagem que chega no WhatsApp vira chamada de API:
-- um "oi", uma figurinha, um número errado, um engraçadinho mandando
-- mil mensagens. Cada uma custa cota, e a cota é do salão inteiro.
--
-- A ideia é um funil, do mais barato para o mais caro. A IA é o último
-- recurso, não o primeiro, e só é alcançada pelo que nenhuma consulta
-- de banco soube resolver:
--
--   1. telefone válido?                    (regex, custo zero)
--   2. o número fala com algum salão meu?  (uma consulta)
--   3. o salão ligou a IA?                 (desligada de fábrica)
--   4. o texto tem tamanho de frase?       (custo zero)
--   5. é "1", "sim", "cancelar"?           (resolve sem IA)
--   6. o salão ainda tem cota hoje?        (uma contagem)
--   7. este número já falou demais?        (uma contagem)
--
-- Só o que passa pelos sete é texto solto de verdade.
-- =============================================================

-- 1. Configuração, por salão ---------------------------------------------
-- Desligada de fábrica, de propósito: ninguém liga IA sem querer, e
-- salão que nunca ouviu falar disso continua funcionando igual.
alter table public.whatsapp_channels
  add column if not exists usa_ia boolean not null default false;

alter table public.whatsapp_channels
  add column if not exists teto_ia_diario integer not null default 200;

alter table public.whatsapp_channels
  add column if not exists teto_ia_por_numero integer not null default 10;

do $$ begin
  alter table public.whatsapp_channels
    add constraint teto_ia_diario_razoavel check (teto_ia_diario between 0 and 5000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_channels
    add constraint teto_ia_numero_razoavel check (teto_ia_por_numero between 0 and 200);
exception when duplicate_object then null; end $$;

-- o app precisa poder ligar e ajustar isso pela tela de ajustes
grant update (usa_ia, teto_ia_diario, teto_ia_por_numero)
  on public.whatsapp_channels to authenticated;

-- 2. Registro de cada chamada --------------------------------------------
-- Serve para duas coisas ao mesmo tempo: contar, para os tetos, e
-- prestar contas depois ("por que a IA respondeu isso pra minha
-- cliente?"). Guardar só o número de tokens e não o texto é de
-- propósito: o texto já está na whatsapp_inbox, e duplicar dado de
-- cliente em mais uma tabela é aumentar a superfície à toa.
create table if not exists public.ia_chamadas (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  telefone text not null,
  inbox_id uuid references public.whatsapp_inbox (id) on delete set null,
  modelo text,
  tokens_prompt integer,
  tokens_resposta integer,
  -- quanto tempo o provedor levou, para saber quando ele degradar
  ms integer,
  erro text,
  criado_em timestamptz not null default now()
);

create index if not exists ia_chamadas_salao_idx
  on public.ia_chamadas (salon_id, criado_em desc);
create index if not exists ia_chamadas_telefone_idx
  on public.ia_chamadas (telefone, criado_em desc);

alter table public.ia_chamadas enable row level security;

drop policy if exists "admin ve o consumo de ia" on public.ia_chamadas;
create policy "admin ve o consumo de ia"
  on public.ia_chamadas for select
  to authenticated
  using (public.is_admin_do_salao(salon_id));

revoke insert, update, delete on public.ia_chamadas from authenticated, anon;

-- 3. De instância para salão ----------------------------------------------
-- A cliente que escreve pela primeira vez nunca recebeu nada nossa, então
-- canal_do_telefone() não a encontra. Quem sabe de que salão é a conversa
-- é o número que RECEBEU: no Evolution, o nome da instância.
create or replace function public.salao_do_canal(instancia text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select c.salon_id
  from public.whatsapp_channels c
  where c.ativo
    and c.identificador is not null
    and c.identificador = instancia
  limit 1;
$$;

revoke execute on function public.salao_do_canal(text)
  from public, anon, authenticated;

-- 4. Quanto já se gastou --------------------------------------------------
create or replace function public.ia_gastas_hoje(salao uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.ia_chamadas
  where salon_id = salao
    and erro is null
    and criado_em >= date_trunc('day', public.agora_local())
                     at time zone 'America/Sao_Paulo';
$$;

revoke execute on function public.ia_gastas_hoje(uuid)
  from public, anon, authenticated;

create or replace function public.ia_gastas_do_numero(tel text)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.ia_chamadas
  where telefone = public.telefone_e164(tel)
    and erro is null
    and criado_em > now() - interval '1 hour';
$$;

revoke execute on function public.ia_gastas_do_numero(text)
  from public, anon, authenticated;

-- 5. O PORTEIRO -----------------------------------------------------------
-- Devolve sempre um objeto com 'permitido' e 'motivo'. O motivo importa:
-- é o que a Edge Function usa para decidir o que responder, e é o que
-- aparece no diagnóstico quando alguém disser "o bot não respondeu".
--
-- Quando a resposta é um simples "1" ou "cancelar", devolve permitido =
-- false com motivo 'resposta_simples' e a ação já mastigada: quem chamou
-- manda direto para receber_resposta_whatsapp() e não gasta um token.
create or replace function public.ia_permitida(
  tel text,
  texto text,
  instancia text default null
)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  e164 text;
  salao uuid;
  ligada boolean;
  teto_dia integer;
  teto_num integer;
  gastas integer;
  acao text;
  limpo text;
begin
  -- 1. telefone -----------------------------------------------------
  e164 := public.telefone_e164(tel);
  if e164 is null then
    return jsonb_build_object('permitido', false, 'motivo', 'telefone_invalido');
  end if;

  -- 2. de quem é esta conversa --------------------------------------
  -- primeiro pela instância que recebeu; se não vier, pelo histórico
  salao := public.salao_do_canal(instancia);
  if salao is null then
    select o.salon_id into salao
    from public.message_outbox o
    where o.telefone = e164
      and o.status in ('enviado', 'entregue', 'lido')
    order by o.enviado_em desc nulls last
    limit 1;
  end if;

  if salao is null then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_canal');
  end if;

  -- 3. o salão quer IA? ---------------------------------------------
  select c.usa_ia and c.ativo, c.teto_ia_diario, c.teto_ia_por_numero
    into ligada, teto_dia, teto_num
  from public.whatsapp_channels c
  where c.salon_id = salao;

  if not coalesce(ligada, false) then
    return jsonb_build_object('permitido', false, 'motivo', 'ia_desligada',
                              'salon_id', salao);
  end if;

  -- 4. isto é uma frase? --------------------------------------------
  limpo := btrim(coalesce(texto, ''));
  if limpo = '' then
    -- figurinha, áudio, imagem: chegam sem texto
    return jsonb_build_object('permitido', false, 'motivo', 'sem_texto',
                              'salon_id', salao);
  end if;
  if length(limpo) > 500 then
    -- ninguém agenda manicure em 500 caracteres. Texto desse tamanho é
    -- engano ou abuso, e ainda custaria caro em tokens.
    return jsonb_build_object('permitido', false, 'motivo', 'texto_longo',
                              'salon_id', salao);
  end if;

  -- 5. dá para resolver sem IA? -------------------------------------
  acao := public.interpretar_resposta(limpo);
  if acao <> 'nada' then
    return jsonb_build_object('permitido', false, 'motivo', 'resposta_simples',
                              'acao', acao, 'salon_id', salao);
  end if;

  -- 6. o salão ainda tem cota hoje? ---------------------------------
  gastas := public.ia_gastas_hoje(salao);
  if gastas >= coalesce(teto_dia, 0) then
    return jsonb_build_object('permitido', false, 'motivo', 'teto_do_salao',
                              'salon_id', salao, 'gastas', gastas,
                              'teto', teto_dia);
  end if;

  -- 7. este número já falou demais? ---------------------------------
  -- é a trava contra o número hostil: sem ela, mil mensagens de um
  -- telefone só queimam a cota do salão inteiro em minutos
  gastas := public.ia_gastas_do_numero(e164);
  if gastas >= coalesce(teto_num, 0) then
    return jsonb_build_object('permitido', false, 'motivo', 'teto_do_numero',
                              'salon_id', salao, 'gastas', gastas,
                              'teto', teto_num);
  end if;

  return jsonb_build_object('permitido', true, 'motivo', 'ok',
                            'salon_id', salao,
                            'client_id', public.cliente_pelo_telefone(e164));
end;
$$;

revoke execute on function public.ia_permitida(text, text, text)
  from public, anon, authenticated;

-- 6. Registrar o que foi gasto -------------------------------------------
-- Chamada DEPOIS da resposta do provedor. Erro também é registrado, com
-- erro preenchido: aparece no diagnóstico, mas não conta contra o teto —
-- cobrar do salão uma chamada que falhou seria punir pelo defeito alheio.
create or replace function public.registrar_chamada_ia(
  salao uuid,
  tel text,
  modelo_usado text default null,
  tk_prompt integer default null,
  tk_resposta integer default null,
  duracao_ms integer default null,
  deu_erro text default null,
  inbox uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo uuid;
begin
  insert into public.ia_chamadas
    (salon_id, telefone, inbox_id, modelo, tokens_prompt, tokens_resposta, ms, erro)
  values
    (salao, public.telefone_e164(tel), inbox, modelo_usado,
     tk_prompt, tk_resposta, duracao_ms, deu_erro)
  returning id into novo;
  return novo;
end;
$$;

revoke execute on function public.registrar_chamada_ia(uuid, text, text, integer, integer, integer, text, uuid)
  from public, anon, authenticated;

-- 7. Para a tela de ajustes ----------------------------------------------
-- A dona precisa ver o consumo sem abrir o painel do provedor.
drop function if exists public.resumo_da_ia(uuid);
create or replace function public.resumo_da_ia(salao uuid)
returns table (
  ligada boolean,
  teto_diario integer,
  gastas_hoje integer,
  gastas_7d integer,
  falhas_7d integer,
  ms_medio integer,
  ultimo_uso timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select
    c.usa_ia,
    c.teto_ia_diario,
    public.ia_gastas_hoje(salao),
    (select count(*)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is null
        and x.criado_em > now() - interval '7 days'),
    (select count(*)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is not null
        and x.criado_em > now() - interval '7 days'),
    (select avg(x.ms)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is null
        and x.criado_em > now() - interval '7 days'),
    (select max(x.criado_em) from public.ia_chamadas x where x.salon_id = salao)
  from public.whatsapp_channels c
  where c.salon_id = salao
    and public.is_admin_do_salao(salao);
$$;

revoke execute on function public.resumo_da_ia(uuid) from public, anon;
grant execute on function public.resumo_da_ia(uuid) to authenticated;

-- =============================================================
-- >>> 031_truncate_nao.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 031: tirar TRUNCATE das mãos de quem só deveria ler
--
-- O Supabase, ao criar o projeto, roda:
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated, service_role;
--
-- "all" inclui TRUNCATE. E TRUNCATE é a única forma de apagar dados que
-- NÃO passa por Row Level Security: as políticas que protegem cada linha
-- simplesmente não são consultadas. Um `truncate appointments` apagaria a
-- agenda inteira de todos os salões, com RLS ligada e tudo.
--
-- Isso é alcançável hoje? Pela API, não: o PostgREST só emite select,
-- insert, update e delete, nunca truncate. Então não é um buraco aberto,
-- é um andaime esquecido. Mas fechar não custa nada e muda o tamanho do
-- estrago de qualquer descuido futuro — uma função SECURITY INVOKER mal
-- escrita, um SQL montado com concatenação, uma extensão nova.
--
-- REFERENCES e TRIGGER vão junto pelo mesmo motivo: ninguém precisa deles
-- pelo caminho da aplicação, e TRIGGER permite pendurar código próprio
-- numa tabela alheia.
--
-- O que NÃO é mexido: select, insert, update e delete continuam como
-- estavam. Quem protege esses quatro é a RLS, e ela está fazendo o
-- trabalho dela.
-- =============================================================

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      t.tablename);
  end loop;
end $$;

-- E para as tabelas que ainda vão nascer: sem isto, a próxima migração
-- que criar uma tabela recebe o "all" de novo e o conserto dura até a
-- semana que vem.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- =============================================================
-- >>> 032_avisa_a_profissional.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 032: a profissional fica sabendo
--
-- Hoje, quando uma cliente marca pelo app, a profissional só descobre
-- se abrir a agenda. O único aviso de 'novo_agendamento' que existia
-- era o da lista de espera, e a regra estava com envia = false, então
-- nem esse saía.
--
-- Isto fecha os dois lados: marcou, ela sabe. Cancelou, ela sabe também
-- — que é o aviso que mais importa, porque é o horário que ela pode
-- oferecer para outra pessoa.
-- =============================================================

-- 1. Texto para quem ATENDE, não para quem é atendida ---------------------
-- O montar_texto_whatsapp() recebe o destinatário em 'cliente' e usa o
-- primeiro nome dele. Isso serve para mensagem que vai PARA a cliente.
-- Numa mensagem para a profissional, o nome que interessa é o de quem
-- marcou — que está no agendamento, não no destinatário.
create or replace function public.montar_texto_whatsapp(
  tipo text,
  titulo text,
  corpo text,
  appt uuid,
  prof uuid,
  cliente uuid
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  -- escalares, não RECORD: ler campo de record não atribuído levanta
  -- erro, e como o notificar() engole exceção da fila, a mensagem
  -- sumiria em silêncio
  d_data date;
  d_hora time;
  servico text;
  prof_nome text;
  prof_slug text;
  base text;
  link text;
  link_app text;
  nome_cliente text;
  nome_na_agenda text;   -- quem marcou, para as mensagens da profissional
  tel_na_agenda text;
  quando text;
  quando_longo text;
begin
  if appt is not null then
    select ap.date, ap.start_time, coalesce(ap.service_name, s.name),
           ap.professional_id,
           nullif(btrim(coalesce(cl.full_name, '')), ''),
           cl.phone
      into d_data, d_hora, servico, prof, nome_na_agenda, tel_na_agenda
    from public.appointments ap
    left join public.services s on s.id = ap.service_id
    left join public.profiles cl on cl.id = ap.client_id
    where ap.id = appt;
  end if;

  if prof is not null then
    select pr.name, pr.slug, rtrim(sl.app_url, '/')
      into prof_nome, prof_slug, base
    from public.professionals pr
    join public.salons sl on sl.id = pr.salon_id
    where pr.id = prof;
  end if;

  if cliente is not null then
    select nullif(split_part(coalesce(full_name, ''), ' ', 1), '')
      into nome_cliente
    from public.profiles where id = cliente;
  end if;

  if base is not null then
    link_app := base || '/';
    if prof_slug is not null then
      link := base || '/p/' || prof_slug;
    end if;
  end if;

  if d_data is not null then
    quando := to_char(d_data, 'DD/MM') || ' às ' || to_char(d_hora, 'HH24:MI');
    -- Para a profissional vale o dia da semana: ela pensa em "quinta",
    -- não em "18/09". O to_char com TMDay NÃO serve aqui — ele depende do
    -- lc_time do banco, que no Supabase é C, e devolveria "Wednesday" no
    -- WhatsApp da cliente. Tabela na mão é feio e está certo.
    quando_longo :=
      (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
        [extract(dow from d_data)::int + 1]
      || ', ' || quando;
  end if;

  case tipo

  -- ---- mensagens para a PROFISSIONAL -----------------------------------
  when 'novo_agendamento' then
    return
      '🗓️ *Horário novo na sua agenda*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, 'a confirmar')
      || coalesce(E'\n' || '📱 ' || tel_na_agenda, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  when 'cancelou_comigo' then
    return
      '⚠️ *Cancelaram um horário*' || E'\n\n'
      || '👤 ' || coalesce(nome_na_agenda, 'Cliente') || E'\n'
      || '✨ ' || coalesce(servico, 'Atendimento') || E'\n'
      || '🕒 ' || coalesce(quando_longo, '') || E'\n\n'
      || 'Esse horário voltou a ficar livre.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link_app, '');

  -- ---- mensagens para a CLIENTE ----------------------------------------
  when 'lembrete_agendamento' then
    return
      '📅 *Amanhã tem horário marcado*' || E'\n\n'
      || 'Oi' || coalesce(', ' || nome_cliente, '') || '! Só passando pra lembrar:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '') || E'\n\n'
      || 'Responda *1* pra confirmar, ou *2* se precisar remarcar.'
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_confirmado' then
    return
      '✅ *Horário confirmado*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Está tudo certo:' || E'\n\n'
      || '✨ ' || coalesce(servico, 'Seu atendimento') || E'\n'
      || '👩 com *' || coalesce(prof_nome, 'a profissional') || '*' || E'\n'
      || '🗓️ ' || coalesce(quando, '')
      || coalesce(E'\n\n' || '🔗 Sua agenda: ' || link, '');

  when 'agendamento_cancelado' then
    return
      '❌ *Horário cancelado*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '. ', '')
      || 'O horário de ' || coalesce(quando, 'antes') || ' foi cancelado.' || E'\n\n'
      || 'Quando quiser remarcar, é só chamar.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'convite_retorno' then
    return
      '💛 *Faz tempo que você não aparece*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', 'Oi! ')
      || coalesce('A *' || prof_nome || '*', 'A gente')
      || ' guardou um lugar pra você.' || E'\n\n'
      || 'Quer já deixar marcado?'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'pos_atendimento' then
    return
      '💅 *Obrigada pela visita!*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Espero que tenha gostado.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'vaga_disponivel' then
    return
      '🎉 *Abriu uma vaga*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Apareceu um horário' || coalesce(' em ' || quando, '')
      || coalesce(' com *' || prof_nome || '*', '') || '.' || E'\n\n'
      || 'Ela fica guardada por pouco tempo.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  when 'agenda_adiantada' then
    return
      '⏰ *Dá pra adiantar seu horário*' || E'\n\n'
      || coalesce('Oi, ' || nome_cliente || '! ', '')
      || 'Abriu um horário mais cedo' || coalesce(', ' || quando, '') || '.'
      || coalesce(E'\n\n' || '🔗 ' || link, '');

  else
    return coalesce(titulo, '')
      || case when corpo is not null and btrim(corpo) <> ''
              then E'\n\n' || corpo else '' end;
  end case;
end;
$$;

revoke execute on function public.montar_texto_whatsapp(text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated;

-- 2. As regras ------------------------------------------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('cancelou_comigo', true, 'utilidade', null)
on conflict (kind) do nothing;

-- novo_agendamento nasceu desligado em 023 porque não havia texto para ele.
-- Agora há.
update public.whatsapp_regras set envia = true, natureza = 'utilidade'
where kind in ('novo_agendamento', 'cancelou_comigo');

-- 3. Quem avisar ----------------------------------------------------------
-- A profissional tem duas identidades: a linha em professionals e a conta
-- de login em profiles. O WhatsApp sai pelo telefone do PERFIL, porque é
-- ele que enfileirar_whatsapp() lê. Sem conta de login, não há para onde
-- mandar — e é por isso que o diagnóstico mais abaixo confere isso.
create or replace function public.conta_da_profissional(prof uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select user_id from public.professionals where id = prof;
$$;

revoke execute on function public.conta_da_profissional(uuid)
  from public, anon, authenticated;

-- 4. Marcou: ela sabe -----------------------------------------------------
create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null then
    return new;                       -- profissional sem conta de login
  end if;

  -- quando a própria profissional marca para si mesma, avisar é ruído
  if conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta,
    'novo_agendamento',
    'Horário novo na sua agenda',
    null,
    '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id)
  );
  return new;
end;
$$;

drop trigger if exists tg_avisa_profissional_novo on public.appointments;
create trigger tg_avisa_profissional_novo
  after insert on public.appointments
  for each row execute function public.avisa_profissional_do_agendamento();

-- 5. Cancelou: ela sabe também --------------------------------------------
-- Este é o aviso que mais vale: horário cancelado é horário que ela pode
-- oferecer para outra pessoa, e quanto antes souber, melhor.
create or replace function public.avisa_profissional_do_cancelamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;

  conta := public.conta_da_profissional(new.professional_id);
  if conta is null or conta = new.client_id then
    return new;
  end if;

  perform public.notificar(
    conta,
    'cancelou_comigo',
    'Cancelaram um horário',
    null,
    '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id)
  );
  return new;
end;
$$;

drop trigger if exists tg_avisa_profissional_cancelou on public.appointments;
create trigger tg_avisa_profissional_cancelou
  after update of status on public.appointments
  for each row execute function public.avisa_profissional_do_cancelamento();

-- 6. Uma profissional com telefone de verdade, para testar --------------
-- Sem alguém com telefone utilizável, nada disso sai da fila. A Ana Paula
-- do seed tem um número de mentira.
do $$
declare
  salao uuid;
  uid uuid;
  prof uuid;
begin
  select id into salao from public.salons where slug = 'espaco-mel';
  if salao is null then
    raise notice '032: salão de exemplo não existe; pulando a profissional de teste.';
    return;
  end if;

  select id into uid from auth.users where email = 'mel@exemplo.com';
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated',
      'authenticated', 'mel@exemplo.com', crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      '{"full_name":"Mel Tedesco","phone":"(13) 99120-3410"}',
      now(), now(), '', '', '', ''
    );
  end if;

  -- o telefone TEM que estar no perfil: é dele que a fila lê, não do
  -- cadastro da profissional
  update public.profiles
     set role = 'profissional',
         full_name = coalesce(nullif(btrim(full_name), ''), 'Mel Tedesco'),
         phone = '(13) 99120-3410',
         accepts_reminders = true
   where id = uid;

  select id into prof from public.professionals where slug = 'mel';
  if prof is null then
    insert into public.professionals
      (salon_id, user_id, name, slug, bio, phone, buffer_minutes)
    values (salao, uid, 'Mel', 'mel',
            'Atendo com hora marcada no Espaço Mel.',
            '(13) 99120-3410', 10)
    returning id into prof;
  else
    update public.professionals
       set salon_id = salao, user_id = uid, phone = '(13) 99120-3410', active = true
     where id = prof;
  end if;

  insert into public.salon_members (salon_id, user_id, papel)
  values (salao, uid, 'profissional')
  on conflict do nothing;

  insert into public.professional_services (professional_id, service_id)
  select prof, s.id from public.services s where s.salon_id = salao
  on conflict do nothing;

  -- de segunda a sábado; os 7 dias já nascem pelo gatilho do 007
  update public.professional_hours
     set open = true, start_time = '09:00', end_time = '19:00'
   where professional_id = prof and weekday between 1 and 6;
end $$;

-- 7. Por que a mensagem não chegou ---------------------------------------
-- Toda vez que "não chegou nada", a causa está numa destas linhas. Em vez
-- de caçar em cinco tabelas, a tela do admin pergunta aqui.
drop function if exists public.diagnostico_whatsapp(uuid);
create or replace function public.diagnostico_whatsapp(salao uuid)
returns table (
  item text,
  situacao text,
  detalhe text
)
language plpgsql
stable
security definer set search_path = public
as $fn$
begin
  -- SECURITY DEFINER sem esta linha entrega a configuração de qualquer
  -- salão para qualquer pessoa logada. A RLS não protege o que roda como
  -- dono; a trava tem que ser explícita.
  if not public.is_admin_do_salao(salao) then
    return;
  end if;

  return query
  with c as (
    select * from public.whatsapp_channels where salon_id = salao
  )
  select 'Canal do salão',
         case when (select count(*) from c) = 0 then 'falta'
              when (select ativo from c) then 'ok' else 'desligado' end,
         coalesce((select 'canal ' || canal ||
                   coalesce(' · ' || numero_exibicao, '') from c),
                  'nenhum canal cadastrado')
  union all
  select 'Endereço público do app',
         case when (select app_url from public.salons where id = salao) is null
              then 'falta' else 'ok' end,
         coalesce((select app_url from public.salons where id = salao),
                  'sem isso as mensagens saem sem o link da agenda')
  union all
  select 'Regra novo_agendamento',
         case when (select envia from public.whatsapp_regras
                     where kind = 'novo_agendamento') then 'ok' else 'desligado' end,
         'avisa a profissional quando alguém marca'
  union all
  select 'Profissionais que recebem',
         case when count(*) filter (where tem_tudo) = 0 then 'falta'
              when count(*) filter (where not tem_tudo) > 0 then 'parcial'
              else 'ok' end,
         count(*) filter (where tem_tudo) || ' de ' || count(*) ||
         ' com conta, telefone e avisos ligados'
  from (
    select p.id,
           (p.user_id is not null
            and public.telefone_e164(pf.phone) is not null
            and coalesce(pf.accepts_reminders, false)) as tem_tudo
    from public.professionals p
    left join public.profiles pf on pf.id = p.user_id
    where p.salon_id = salao and p.active
  ) x
  union all
  select 'Telefones repetidos',
         case when count(*) = 0 then 'ok' else 'atenção' end,
         case when count(*) = 0 then 'cada telefone pertence a uma pessoa só'
              else 'o mesmo número está em ' || count(*) ||
                   ' perfis; a resposta "1" no WhatsApp vira ambígua' end
  from (
    select public.telefone_e164(phone) t
    from public.profiles where phone is not null
    group by 1 having count(*) > 1
  ) y
  union all
  select 'Fila de hoje',
         'ok',
         count(*) filter (where status = 'na_fila') || ' esperando · ' ||
         count(*) filter (where status in ('enviado','entregue','lido')) || ' enviadas · ' ||
         count(*) filter (where status = 'falhou') || ' falharam'
  from public.message_outbox
  where salon_id = salao
    and (criado_em at time zone 'America/Sao_Paulo')::date
        = (public.agora_local())::date;
end;
$fn$;

revoke execute on function public.diagnostico_whatsapp(uuid) from public, anon;
grant execute on function public.diagnostico_whatsapp(uuid) to authenticated;

-- 8. A fila inteira do salão, para a tela do admin ------------------------
-- O /pro/enviar mostra a fila de UMA profissional. O admin precisa ver a
-- do salão, incluindo as que já saíram, para conferir o que foi mandado.
drop function if exists public.fila_do_salao(uuid, integer);
create or replace function public.fila_do_salao(salao uuid, quantas integer default 30)
returns table (
  id uuid,
  quando timestamptz,
  para text,
  telefone text,
  tipo text,
  status text,
  corpo text,
  link_wa text
)
language sql
stable
security definer set search_path = public
as $$
  select o.id,
         coalesce(o.enviado_em, o.criado_em),
         coalesce(nullif(btrim(pf.full_name), ''), 'sem nome'),
         o.telefone,
         o.kind,
         o.status,
         o.corpo,
         'https://wa.me/' || o.telefone || '?text=' || public.url_encode_simples(o.corpo)
  from public.message_outbox o
  left join public.profiles pf on pf.id = o.client_id
  where o.salon_id = salao
    and public.is_admin_do_salao(salao)
  order by coalesce(o.enviado_em, o.criado_em) desc
  limit greatest(1, least(coalesce(quantas, 30), 200));
$$;

revoke execute on function public.fila_do_salao(uuid, integer) from public, anon;
grant execute on function public.fila_do_salao(uuid, integer) to authenticated;

-- =============================================================
-- >>> 033_ia_entende_o_resto.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 033: a IA entende o que a lista não previu
--
-- O interpretar_resposta() é uma lista de palavras exatas: "1", "sim",
-- "confirmo", "cancelar". Funciona para quem responde curto, e falha
-- para "pode deixar que eu vou", "tá bom então", "não vou conseguir
-- dessa vez amiga". Que é como as pessoas escrevem de verdade.
--
-- A saída NÃO é uma lista maior — lista nunca acaba. É uma cascata:
--
--   1. as regras exatas primeiro. Custo zero, resposta instantânea,
--      e resolvem a maioria porque a mensagem PEDE "responda 1".
--   2. o que elas não souberem passa pelo porteiro da 030.
--   3. o que o porteiro liberar vai para o modelo.
--
-- O ponto que faz isso ser seguro: **a IA não ganha caminho próprio**.
-- Ela devolve uma das mesmas palavras que as regras devolveriam, e daí
-- em diante é o código de sempre que age. O modelo traduz; quem executa
-- continua sendo SQL que a gente leu.
-- =============================================================

-- 1. Guardar quem entendeu -----------------------------------------------
-- Sem isto não dá para responder "por que o sistema cancelou o horário
-- da minha cliente?". Com isto, a resposta está numa linha.
alter table public.whatsapp_inbox
  add column if not exists via text not null default 'regra';

alter table public.whatsapp_inbox
  add column if not exists intencao_ia text;

do $$ begin
  alter table public.whatsapp_inbox
    add constraint via_conhecida check (via in ('regra', 'ia'));
exception when duplicate_object then null; end $$;

-- 2. Da intenção do modelo para o verbo do sistema ------------------------
-- O modelo fala o vocabulário da bancada (agendar, remarcar, cancelar,
-- confirmar, preco, horarios, outro). O sistema fala outro, menor. Esta
-- função é a fronteira entre os dois — e é ela que impede uma intenção
-- inventada pelo modelo de virar ação: o que não estiver aqui vira 'nada'.
create or replace function public.acao_da_intencao(intencao text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(intencao, '')))
    when 'confirmar' then 'confirma'
    when 'cancelar'  then 'cancela'
    when 'remarcar'  then 'remarca'
    -- quem quer marcar, quer saber preço ou quer saber horário recebe a
    -- mesma coisa hoje: o caminho para a agenda. Quando a máquina de
    -- estados existir, é aqui que os três se separam.
    when 'agendar'   then 'quer_agendar'
    when 'preco'     then 'quer_agendar'
    when 'horarios'  then 'quer_agendar'
    else 'nada'
  end;
$$;

-- 3. Respostas para os casos novos ---------------------------------------
create or replace function public.texto_resposta(tipo text, quando text, prof text)
returns text
language sql
immutable
as $$
  select case tipo
    when 'confirmado' then
      '✅ *Confirmado!* Te espero dia ' || quando || '. 💛'
    when 'cancelado' then
      '❌ Tudo bem, cancelei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Quando quiser remarcar, é só abrir o app. 🙂'
    when 'remarcado' then
      '🔄 Certo, liberei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Escolha o novo dia por aqui, que eu já deixo marcado. 💛'
    when 'quer_agendar' then
      '💛 Claro! Escolha o dia e a hora que ficam melhor pra você:'
    when 'sem_horario' then
      '🤔 Não encontrei nenhum horário marcado no seu nome.' || E'\n\n'
      || 'Se precisar, é só marcar pelo app.'
    when 'fora_de_contexto' then
      '👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.'
    when 'sair' then
      '👋 Pronto, não mando mais lembretes por aqui.' || E'\n'
      || 'Se mudar de ideia, é só ligar de novo no app.'
    when 'voto_repetido_confirmado' then
      'Sua resposta já foi registrada ✅ (horário confirmado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    when 'voto_repetido_cancelado' then
      'Sua resposta já foi registrada ❌ (horário cancelado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    else ''
  end;
$$;

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 4. O link da agenda, para colar nas respostas ---------------------------
-- O caminho normal é pelo histórico: a última mensagem que saiu para
-- este telefone diz de que salão e de que profissional é a conversa.
-- Só que quem escreve pela PRIMEIRA vez não tem histórico — e é
-- justamente essa pessoa que mais precisa do link. Por isso o salão
-- entra como reserva: quem chama sabe qual é, porque o porteiro da 030
-- já descobriu pela instância que recebeu.
drop function if exists public.link_da_agenda(text);
create or replace function public.link_da_agenda(tel text, salao uuid default null)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select rtrim(s.app_url, '/') || coalesce('/p/' || p.slug, '/')
       from public.message_outbox o
       join public.salons s on s.id = o.salon_id
       left join public.professionals p on p.id = o.professional_id
      where o.telefone = public.telefone_e164(tel)
        and s.app_url is not null
      order by o.criado_em desc
      limit 1),
    (select rtrim(s.app_url, '/') || '/'
       from public.salons s
      where s.id = salao and s.app_url is not null)
  );
$$;

revoke execute on function public.link_da_agenda(text, uuid)
  from public, anon, authenticated;

-- 5. O recebedor, agora com a IA como reserva -----------------------------
-- Mudança de assinatura: precisa derrubar as versões anteriores antes.
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text, uuid);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  -- a intenção que o modelo leu, no vocabulário da bancada. Só é olhada
  -- quando as regras não souberam responder; regra que reconheceu ganha
  -- sempre, porque é determinística e a cliente escreveu o que pedimos.
  intencao_do_modelo text default null,
  -- de que salão é a conversa. Vem do porteiro, que descobriu pela
  -- instância que recebeu; serve para responder a quem nunca escreveu.
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  origem text := 'regra';
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
  link text;
  quando text;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);

  -- A CASCATA -----------------------------------------------------------
  acao := public.interpretar_resposta(texto);
  if acao = 'nada' and intencao_do_modelo is not null then
    acao := public.acao_da_intencao(intencao_do_modelo);
    if acao <> 'nada' then
      origem := 'ia';
    end if;
  end if;

  -- Voto trocado na mesma enquete: o primeiro já valeu
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id,
              id_enquete, origem, intencao_do_modelo);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          public.texto_resposta('voto_repetido_' || ja_votou.acao, null, coalesce(prof.name, 'profissional'))
      );
    end if;
  end if;

  -- Sair: vale mesmo para quem não tem conta no app
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete, origem, intencao_do_modelo);

    return jsonb_build_object('acao', 'sair',
      'responder', public.texto_resposta('sair', null, null));
  end if;

  -- Querer marcar não depende de contexto nem de cadastro: é a única
  -- intenção que pode vir de alguém que nunca falou com a gente. O que
  -- ela recebe é direção, não agendamento — a máquina de estados que vai
  -- marcar de verdade ainda não existe, e prometer o que não faço seria
  -- pior do que mandar o link.
  if acao = 'quer_agendar' then
    link := public.link_da_agenda(e164, salao);
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'quer_agendar', id_enquete, origem, intencao_do_modelo);

    return jsonb_build_object('acao', 'quer_agendar',
      'via', origem,
      'responder', public.texto_resposta('quer_agendar', null, null)
        || coalesce(E'\n\n' || '🔗 ' || link, ''));
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- Mexer na agenda continua exigindo que a conversa seja sobre um
  -- horário. Isto vale INCLUSIVE para o que a IA entendeu: "confirmo"
  -- solto, três semanas depois do último lembrete, não confirma nada.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null));
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null));
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;
  quando := to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI');

  if acao = 'confirma' then
    update public.appointments set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || quando || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object('acao', 'confirmado', 'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado', quando, null));

  else
    -- cancela e remarca desmarcam igual; muda o que ela ouve de volta,
    -- porque quem quer remarcar não quer ser mandada embora
    update public.appointments set status = 'cancelado' where id = appt_id;

    resposta := jsonb_build_object(
      'acao', case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
      'appointment_id', appt_id,
      'responder',
        public.texto_resposta(case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
                              quando, null)
        || case when acao = 'remarca'
                then coalesce(E'\n\n' || '🔗 ' || public.link_da_agenda(e164, salao), '')
                else '' end);

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || quando || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete,
          origem, intencao_do_modelo);

  return resposta || jsonb_build_object('via', origem);
end;
$$;

revoke execute on function
  public.receber_resposta_whatsapp(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- 6. Ligar e desligar pela tela --------------------------------------------
-- O update direto em whatsapp_channels já é permitido para o admin pela
-- RLS da 023 mais o grant de coluna da 030. Esta função existe para a
-- tela não precisar saber disso, e para o retorno já vir no formato que
-- ela mostra.
drop function if exists public.ligar_ia(uuid, boolean);
create or replace function public.ligar_ia(salao uuid, ligada boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'só a dona do salão liga a IA';
  end if;

  update public.whatsapp_channels set usa_ia = ligada where salon_id = salao;
  return ligada;
end;
$$;

revoke execute on function public.ligar_ia(uuid, boolean) from public, anon;
grant execute on function public.ligar_ia(uuid, boolean) to authenticated;

-- 7. As últimas leituras, para a tela ---------------------------------------
-- Mostrar o que a IA entendeu é o que separa "confio nisso" de "essa
-- coisa mexe na minha agenda e eu não sei por quê".
drop function if exists public.leituras_recentes(uuid, integer);
create or replace function public.leituras_recentes(salao uuid, quantas integer default 20)
returns table (
  quando timestamptz,
  telefone text,
  texto text,
  entendeu text,
  via text,
  intencao text
)
language sql
stable
security definer set search_path = public
as $$
  select i.recebido_em, i.telefone, i.texto, i.acao, i.via, i.intencao_ia
  from public.whatsapp_inbox i
  where public.is_admin_do_salao(salao)
    and (
      i.client_id in (
        select a.client_id from public.appointments a where a.salon_id = salao
      )
      or exists (
        select 1 from public.message_outbox o
        where o.telefone = i.telefone and o.salon_id = salao
      )
      or i.via = 'ia'
    )
  order by i.recebido_em desc
  limit greatest(1, least(coalesce(quantas, 20), 100));
$$;

revoke execute on function public.leituras_recentes(uuid, integer) from public, anon;
grant execute on function public.leituras_recentes(uuid, integer) to authenticated;

-- =============================================================
-- >>> 034_pedido_nao_cai_no_vazio.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 034: pedido de horário não cai no vazio
--
-- Dois defeitos que só apareceram com a coisa no ar, conversando com
-- gente de verdade:
--
-- 1. A resposta terminava em dois-pontos e não vinha nada depois:
--
--        💛 Claro! Escolha o dia e a hora que ficam melhor pra você:
--
--    O link é opcional (depende do salão ter gravado o endereço do app),
--    mas a frase foi escrita como se ele fosse certo. Frase apontando
--    para o vazio parece sistema quebrado — e para a cliente, é.
--
-- 2. Ninguém ficava sabendo. A cliente pedia horário pelo WhatsApp, o
--    sistema respondia bonito, e a mensagem morria numa tabela. Enquanto
--    a máquina de estados não marca sozinha, quem marca é gente — e
--    gente precisa ser avisada.
-- =============================================================

-- 1. Duas frases, porque são duas situações -------------------------------
create or replace function public.texto_resposta(tipo text, quando text, prof text)
returns text
language sql
immutable
as $$
  select case tipo
    when 'confirmado' then
      '✅ *Confirmado!* Te espero dia ' || quando || '. 💛'
    when 'cancelado' then
      '❌ Tudo bem, cancelei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Quando quiser remarcar, é só abrir o app. 🙂'
    when 'remarcado' then
      '🔄 Certo, liberei o seu horário de ' || quando || '.' || E'\n\n'
      || 'Escolha o novo dia por aqui, que eu já deixo marcado. 💛'
    -- com link: a frase aponta para ele
    when 'quer_agendar' then
      '💛 Claro! Escolha o dia e a hora que ficam melhor pra você:'
    -- sem link: promete o que realmente vai acontecer, que é uma pessoa
    -- responder. Prometer menos e cumprir é melhor que apontar para o nada.
    when 'quer_agendar_sem_link' then
      '💛 Claro! Já avisei ' || coalesce('a ' || prof, 'o salão')
      || ' e você recebe os horários por aqui em instantes.'
    when 'sem_horario' then
      '🤔 Não encontrei nenhum horário marcado no seu nome.' || E'\n\n'
      || 'Se precisar, é só marcar pelo app.'
    when 'fora_de_contexto' then
      '👍 Recebi! Pra marcar ou mudar um horário, é só abrir o app.'
    when 'sair' then
      '👋 Pronto, não mando mais lembretes por aqui.' || E'\n'
      || 'Se mudar de ideia, é só ligar de novo no app.'
    when 'voto_repetido_confirmado' then
      'Sua resposta já foi registrada ✅ (horário confirmado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    when 'voto_repetido_cancelado' then
      'Sua resposta já foi registrada ❌ (horário cancelado).' || E'\n'
      || 'Pra mudar, é só falar aqui com a ' || prof || '.'
    else ''
  end;
$$;

revoke execute on function public.texto_resposta(text, text, text)
  from public, anon, authenticated;

-- 2. Quem atende este telefone -------------------------------------------
-- A última profissional que trocou mensagem com este número. Para quem
-- escreve pela primeira vez não há resposta, e tudo bem: aí quem é
-- avisada é a dona do salão.
create or replace function public.profissional_do_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select o.professional_id
  from public.message_outbox o
  where o.telefone = public.telefone_e164(tel)
    and o.professional_id is not null
  order by o.criado_em desc
  limit 1;
$$;

revoke execute on function public.profissional_do_telefone(text)
  from public, anon, authenticated;

-- 3. Avisar quem pode marcar ----------------------------------------------
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('pedido_pelo_whatsapp', true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true where kind = 'pedido_pelo_whatsapp';

create or replace function public.avisar_do_pedido(
  salao uuid,
  tel text,
  texto text,
  cliente uuid default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  prof uuid;
  conta uuid;
  quem text;
  corpo text;
  avisados integer := 0;
begin
  if salao is null then
    return 0;
  end if;

  quem := coalesce(
    (select nullif(btrim(full_name), '') from public.profiles where id = cliente),
    tel);

  corpo := quem || ' escreveu: "' || left(coalesce(texto, ''), 160) || '"';

  -- a profissional que já atende este número recebe primeiro, e recebe
  -- por WhatsApp: é ela que vai responder
  prof := public.profissional_do_telefone(tel);
  if prof is not null then
    conta := public.conta_da_profissional(prof);
    if conta is not null then
      perform public.notificar(
        conta, 'pedido_pelo_whatsapp', 'Pedido de horário no WhatsApp',
        corpo, '/pro',
        jsonb_build_object('professional_id', prof, 'telefone', tel));
      avisados := avisados + 1;
    end if;
  end if;

  -- a dona do salão fica sabendo de qualquer jeito, inclusive de quem
  -- escreveu pela primeira vez e não tem profissional
  for conta in
    select m.user_id from public.salon_members m
    where m.salon_id = salao and m.papel = 'admin'
      and m.user_id is distinct from public.conta_da_profissional(prof)
  loop
    perform public.notificar(
      conta, 'pedido_pelo_whatsapp', 'Pedido de horário no WhatsApp',
      corpo, '/admin/whatsapp',
      jsonb_build_object('telefone', tel));
    avisados := avisados + 1;
  end loop;

  return avisados;
end;
$$;

revoke execute on function public.avisar_do_pedido(uuid, text, text, uuid)
  from public, anon, authenticated;

-- 4. O recebedor, com o pedido avisando gente ----------------------------
drop function if exists public.receber_resposta_whatsapp(text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text);
drop function if exists public.receber_resposta_whatsapp(text, text, text, text, text, uuid);

create or replace function public.receber_resposta_whatsapp(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  -- a intenção que o modelo leu, no vocabulário da bancada. Só é olhada
  -- quando as regras não souberam responder; regra que reconheceu ganha
  -- sempre, porque é determinística e a cliente escreveu o que pedimos.
  intencao_do_modelo text default null,
  -- de que salão é a conversa. Vem do porteiro, que descobriu pela
  -- instância que recebeu; serve para responder a quem nunca escreveu.
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  cliente uuid;
  acao text;
  origem text := 'regra';
  appt public.appointments%rowtype;
  appt_id uuid;
  prof public.professionals%rowtype;
  e164 text := public.telefone_e164(tel);
  resposta jsonb;
  ja_votou record;
  link text;
  nome_prof text;
  quando text;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  cliente := public.cliente_pelo_telefone(e164);

  -- A CASCATA -----------------------------------------------------------
  acao := public.interpretar_resposta(texto);
  if acao = 'nada' and intencao_do_modelo is not null then
    acao := public.acao_da_intencao(intencao_do_modelo);
    if acao <> 'nada' then
      origem := 'ia';
    end if;
  end if;

  -- Voto trocado na mesma enquete: o primeiro já valeu
  if id_enquete is not null then
    select i.acao, i.appointment_id into ja_votou
    from public.whatsapp_inbox i
    where i.enquete_id = id_enquete
      and i.acao in ('confirmado', 'cancelado')
    order by i.recebido_em
    limit 1;

    if found then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
      values (e164, texto, id_provedor, cliente, 'voto_repetido', ja_votou.appointment_id,
              id_enquete, origem, intencao_do_modelo);

      select * into prof
      from public.professionals p
      join public.appointments a on a.professional_id = p.id
      where a.id = ja_votou.appointment_id;

      return jsonb_build_object(
        'acao', 'voto_repetido',
        'responder',
          public.texto_resposta('voto_repetido_' || ja_votou.acao, null, coalesce(prof.name, 'profissional'))
      );
    end if;
  end if;

  -- Sair: vale mesmo para quem não tem conta no app
  if acao = 'sair' then
    if cliente is not null then
      update public.profiles set accepts_reminders = false where id = cliente;
      update public.message_outbox set status = 'cancelado'
      where client_id = cliente and status = 'na_fila';
    end if;

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sair', id_enquete, origem, intencao_do_modelo);

    return jsonb_build_object('acao', 'sair',
      'responder', public.texto_resposta('sair', null, null));
  end if;

  -- Querer marcar não depende de contexto nem de cadastro: é a única
  -- intenção que pode vir de alguém que nunca falou com a gente. O que
  -- ela recebe é direção, não agendamento — a máquina de estados que vai
  -- marcar de verdade ainda não existe, e prometer o que não faço seria
  -- pior do que mandar o link.
  if acao = 'quer_agendar' then
    link := public.link_da_agenda(e164, salao);

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'quer_agendar', id_enquete, origem, intencao_do_modelo);

    -- Enquanto a máquina de estados não marca sozinha, quem marca é
    -- gente. Avisar não é enfeite: é o que faz a resposta abaixo ser
    -- verdade em vez de promessa vazia.
    perform public.avisar_do_pedido(salao, e164, texto, cliente);

    if link is not null then
      return jsonb_build_object('acao', 'quer_agendar', 'via', origem,
        'responder', public.texto_resposta('quer_agendar', null, null)
                     || E'\n\n' || '🔗 ' || link);
    end if;

    -- sem link, a frase muda: não adianta mandar escolher o dia num
    -- lugar que não existe
    select p.name into nome_prof from public.professionals p
    where p.id = public.profissional_do_telefone(e164);

    return jsonb_build_object('acao', 'quer_agendar', 'via', origem,
      'responder', public.texto_resposta('quer_agendar_sem_link', null, nome_prof));
  end if;

  if cliente is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, 'sem_cadastro', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_cadastro');
  end if;

  if acao = 'nada' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'nada', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'nada');
  end if;

  -- Mexer na agenda continua exigindo que a conversa seja sobre um
  -- horário. Isto vale INCLUSIVE para o que a IA entendeu: "confirmo"
  -- solto, três semanas depois do último lembrete, não confirma nada.
  if public.ultimo_assunto_enviado(e164) is distinct from 'lembrete_agendamento' then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'fora_de_contexto', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'fora_de_contexto',
      'responder', public.texto_resposta('fora_de_contexto', null, null));
  end if;

  appt_id := public.proximo_agendamento_da_cliente(cliente);
  if appt_id is null then
    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, enquete_id, via, intencao_ia)
    values (e164, texto, id_provedor, cliente, 'sem_horario', id_enquete, origem, intencao_do_modelo);
    return jsonb_build_object('acao', 'sem_horario',
      'responder', public.texto_resposta('sem_horario', null, null));
  end if;

  select * into appt from public.appointments where id = appt_id;
  select * into prof from public.professionals where id = appt.professional_id;
  quando := to_char(appt.date, 'DD/MM') || ' às ' || to_char(appt.start_time, 'HH24:MI');

  if acao = 'confirma' then
    update public.appointments set status = 'confirmado'
    where id = appt_id and status = 'pendente';

    perform public.notificar(
      cliente, 'agendamento_confirmado', 'Horário confirmado',
      coalesce(appt.service_name, 'Seu atendimento') || ' com ' || prof.name ||
        ' dia ' || quando || '.',
      '/', jsonb_build_object('appointment_id', appt_id)
    );

    resposta := jsonb_build_object('acao', 'confirmado', 'appointment_id', appt_id,
      'responder', public.texto_resposta('confirmado', quando, null));

  else
    -- cancela e remarca desmarcam igual; muda o que ela ouve de volta,
    -- porque quem quer remarcar não quer ser mandada embora
    update public.appointments set status = 'cancelado' where id = appt_id;

    resposta := jsonb_build_object(
      'acao', case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
      'appointment_id', appt_id,
      'responder',
        public.texto_resposta(case when acao = 'remarca' then 'remarcado' else 'cancelado' end,
                              quando, null)
        || case when acao = 'remarca'
                then coalesce(E'\n\n' || '🔗 ' || public.link_da_agenda(e164, salao), '')
                else '' end);

    if prof.user_id is not null then
      perform public.notificar(
        prof.user_id, 'agendamento_cancelado', 'Cancelou pelo WhatsApp',
        (select coalesce(full_name, 'A cliente') from public.profiles where id = cliente)
          || ' cancelou ' || quando || '.',
        '/pro', jsonb_build_object('appointment_id', appt_id)
      );
    end if;
  end if;

  insert into public.whatsapp_inbox
    (telefone, texto, provider_id, client_id, acao, appointment_id, enquete_id, via, intencao_ia)
  values (e164, texto, id_provedor, cliente, resposta ->> 'acao', appt_id, id_enquete,
          origem, intencao_do_modelo);

  return resposta || jsonb_build_object('via', origem);
end;
$$;

revoke execute on function
  public.receber_resposta_whatsapp(text, text, text, text, text, uuid)
  from public, anon, authenticated;


-- =============================================================
-- >>> 035_bot_que_marca.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 035: o bot que marca sozinho
--
-- Uma conversa por telefone, com estado guardado, perguntando uma coisa
-- de cada vez e sempre com opções numeradas. O modelo de linguagem NÃO
-- participa daqui: ele já fez o trabalho dele lá atrás, decidindo que a
-- pessoa quer marcar. Daqui em diante é máquina de estados, porque
-- escolher entre cinco serviços não precisa de inteligência nenhuma e
-- precisa muito de previsibilidade.
--
-- O limite honesto: o bot marca para quem JÁ É CLIENTE — quem tem
-- telefone no cadastro. Criar conta exige criar usuário de autenticação,
-- que não é coisa para uma conversa de WhatsApp fazer sozinha. Quem
-- ainda não é cliente recebe o link e é bem recebida por gente.
-- =============================================================

-- 1. Horário livre, uma implementação só ---------------------------------
-- Isto já existia, em JavaScript, dentro do navegador (lib/booking.js).
-- Escrever uma segunda versão aqui criaria duas verdades sobre "que
-- horas estão livres", e um dia elas discordariam — provavelmente no dia
-- em que duas clientes pegassem o mesmo horário. Então esta função passa
-- a ser A resposta, e a página pública passa a chamá-la também.
--
-- A grade de 30 em 30 minutos e a regra "não oferecer horário que já
-- passou hoje" são as mesmas do gerarSlots(); há um teste comparando as
-- duas saídas.
drop function if exists public.horarios_livres(uuid, date, integer);
create or replace function public.horarios_livres(
  prof uuid,
  dia date,
  duracao integer
)
returns table (hora time)
language sql
stable
security definer set search_path = public
as $$
  with expediente as (
    select h.start_time as abre, h.end_time as fecha
    from public.professional_hours h
    where h.professional_id = prof
      and h.weekday = extract(dow from dia)
      and h.open
  ),
  ocupado as (
    select * from public.get_busy_slots(dia, prof)
  ),
  grade as (
    select (generate_series(
              dia + e.abre,
              dia + e.fecha - make_interval(mins => duracao),
              interval '30 minutes'))::time as t
    from expediente e
  )
  select g.t
  from grade g
  where not exists (
          select 1 from ocupado o
          where g.t < o.end_time
            and (g.t + make_interval(mins => duracao))::time > o.start_time)
    -- horário que já passou não é vaga
    and (dia > (public.agora_local())::date
         or (dia = (public.agora_local())::date
             and g.t > (public.agora_local())::time))
  order by g.t;
$$;

grant execute on function public.horarios_livres(uuid, date, integer)
  to anon, authenticated;

-- 2. Os próximos dias com vaga -------------------------------------------
create or replace function public.dias_com_vaga(
  prof uuid,
  duracao integer,
  quantos integer default 5
)
returns table (dia date, vagas integer)
language sql
stable
security definer set search_path = public
as $$
  select d.dia, count(*)::integer
  from generate_series(
         (public.agora_local())::date,
         (public.agora_local())::date + 20,
         interval '1 day') as s(dia)
  cross join lateral (select s.dia::date as dia) d
  cross join lateral public.horarios_livres(prof, d.dia, duracao) h
  group by d.dia
  having count(*) > 0
  order by d.dia
  limit greatest(1, least(coalesce(quantos, 5), 10));
$$;

revoke execute on function public.dias_com_vaga(uuid, integer, integer)
  from public, anon, authenticated;

-- 3. A conversa -----------------------------------------------------------
-- Uma por telefone. Guardar as OPÇÕES oferecidas é o que faz "2"
-- significar alguma coisa: sem isso o número que ela responde não tem a
-- que se referir, e o bot teria que adivinhar.
create table if not exists public.conversas (
  telefone text primary key,
  salon_id uuid not null references public.salons (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  -- servico | profissional | dia | hora | confirma
  estado text not null default 'servico',
  dados jsonb not null default '{}'::jsonb,
  opcoes jsonb,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  -- conversa esquecida morre. Confirmar às cegas um horário escolhido
  -- há três dias é pior do que recomeçar.
  expira_em timestamptz not null default now() + interval '30 minutes'
);

alter table public.conversas enable row level security;

drop policy if exists "equipe ve as conversas" on public.conversas;
create policy "equipe ve as conversas"
  on public.conversas for select
  to authenticated
  using (public.is_admin_do_salao(salon_id));

revoke insert, update, delete on public.conversas from authenticated, anon;

-- 4. Numerar e escolher ---------------------------------------------------
create or replace function public.lista_numerada(opcoes jsonb)
returns text
language sql
immutable
as $$
  select string_agg('*' || (o.valor ->> 'n') || '* · ' || (o.valor ->> 'rotulo'),
                    E'\n' order by (o.valor ->> 'n')::int)
  from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor);
$$;

-- Aceita o número, e também o texto por extenso quando ele bate sozinho:
-- quem responde "manicure" em vez de "1" não errou, só é gente.
create or replace function public.escolher_opcao(opcoes jsonb, texto text)
returns jsonb
language plpgsql
immutable
as $$
declare
  limpo text;
  n integer;
  achou jsonb;
  quantos integer;
begin
  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  limpo := regexp_replace(limpo, '[^a-z0-9: ]', '', 'g');
  limpo := btrim(limpo);
  if limpo = '' then return null; end if;

  if limpo ~ '^[0-9]{1,2}$' then
    n := limpo::int;
    select o.valor into achou
    from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
    where (o.valor ->> 'n')::int = n;
    return achou;
  end if;

  -- texto que aparece em exatamente UMA opção. Batendo em duas, devolver
  -- a primeira seria escolher no lugar dela; melhor perguntar de novo.
  select count(*) into quantos
  from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
  where position(limpo in lower(translate(coalesce(o.valor ->> 'busca', ''),
        'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))) > 0;

  if quantos = 1 then
    select o.valor into achou
    from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
    where position(limpo in lower(translate(coalesce(o.valor ->> 'busca', ''),
          'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))) > 0;
    return achou;
  end if;

  return null;
end;
$$;

-- 5. Data por extenso, sem depender do idioma do banco --------------------
create or replace function public.dia_por_extenso(d date)
returns text
language sql
immutable
as $$
  select (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
           [extract(dow from d)::int + 1]
         || ' ' || to_char(d, 'DD/MM');
$$;

-- 6. A máquina de estados -------------------------------------------------
-- Uma pergunta de cada vez, sempre com opções numeradas, e cada resposta
-- avança um passo. Devolve o que dizer e, quando fecha, o id do horário.
create or replace function public.avancar_conversa(
  tel text,
  texto text,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  c public.conversas%rowtype;
  cliente uuid;
  escolha jsonb;
  novas jsonb;
  d jsonb;
  cabecalho text := '';
  limpo text;
  dur integer;
  nome_serv text;
  prof_id uuid;
  prof_nome text;
  dia_esc date;
  hora_esc time;
  novo_appt uuid;
  quantos integer;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

  -- Sair da conversa é sagrado: tem que funcionar em qualquer passo, e
  -- tem que ser óbvio. Ninguém fica preso num menu.
  if limpo in ('cancelar', 'parar', 'sair', 'desistir', 'deixa', 'deixa pra la') then
    delete from public.conversas where telefone = e164;
    return jsonb_build_object('acao', 'desistiu',
      'responder', 'Tudo bem, cancelei por aqui. Quando quiser, é só chamar 💛');
  end if;

  -- conversa velha não vale: apaga antes de ler
  delete from public.conversas where telefone = e164 and expira_em < now();
  select * into c from public.conversas where telefone = e164;

  -- ---------------------------------------------------------------------
  -- Começo
  -- ---------------------------------------------------------------------
  if not found then
    -- Quem chama normalmente passa o salão, mas depender disso é frágil:
    -- basta a conversa expirar no meio para a próxima mensagem chegar sem
    -- ele, e a cliente receber silêncio. O histórico responde.
    if salao is null then
      select o.salon_id into salao
      from public.message_outbox o
      where o.telefone = e164
      order by o.criado_em desc
      limit 1;
    end if;
    if salao is null then
      return jsonb_build_object('acao', 'sem_canal');
    end if;

    cliente := public.cliente_pelo_telefone(e164);
    if cliente is null then
      -- O bot marca para quem já é cliente. Criar conta exige criar
      -- usuário de autenticação, que não é coisa para uma conversa de
      -- WhatsApp fazer sozinha — e um cadastro meia-boca vira cliente
      -- duplicada na agenda de alguém.
      return jsonb_build_object('acao', 'sem_cadastro');
    end if;

    -- os apelidos levam sufixo _c porque plpgsql resolve nome de coluna
    -- e de variável no mesmo escopo: uma coluna chamada "dur" ao lado da
    -- variável "dur" faz o Postgres recusar a consulta inteira
    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', rotulo_c,
             'busca', nome_c, 'dur', dur_c))
      into novas
    from (
      select row_number() over (order by s.name) as linha_c,
             s.id as id_c, s.name as nome_c, s.duration_minutes as dur_c,
             s.name || ' · R$ ' || to_char(s.price, 'FM999G990D00') as rotulo_c
      from public.services s
      where s.salon_id = salao and s.active
      order by s.name
      limit 9
    ) t;

    if novas is null then
      return jsonb_build_object('acao', 'sem_servico',
        'responder', 'Ainda não tenho serviços cadastrados por aqui 😅');
    end if;

    insert into public.conversas (telefone, salon_id, client_id, estado, opcoes, dados)
    values (e164, salao, cliente, 'servico', novas, '{}'::jsonb);

    return jsonb_build_object('acao', 'perguntou', 'estado', 'servico',
      'responder', '💛 Vamos marcar! O que você quer fazer?' || E'\n\n'
                   || public.lista_numerada(novas) || E'\n\n'
                   || '_Responda com o número._');
  end if;

  escolha := public.escolher_opcao(c.opcoes, texto);
  if escolha is null then
    return jsonb_build_object('acao', 'nao_entendi', 'estado', c.estado,
      'responder', '🤔 Não peguei. Responda com o número de uma das opções:'
                   || E'\n\n' || public.lista_numerada(c.opcoes)
                   || E'\n\n' || '_Ou responda CANCELAR para parar._');
  end if;

  d := c.dados;

  -- ---------------------------------------------------------------------
  -- Escolheu o serviço -> quem atende
  -- ---------------------------------------------------------------------
  if c.estado = 'servico' then
    d := d || jsonb_build_object('servico_id', escolha ->> 'id',
                                 'servico', escolha ->> 'busca',
                                 'dur', (escolha ->> 'dur')::int);

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', nome_c, 'busca', nome_c))
      into novas
    from (
      select row_number() over (order by p.name) as linha_c,
             p.id as id_c, p.name as nome_c
      from public.professionals p
      join public.professional_services ps on ps.professional_id = p.id
      where p.salon_id = c.salon_id and p.active
        and ps.service_id = (escolha ->> 'id')::uuid
      order by p.name
      limit 9
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_profissional',
        'responder', 'Ninguém está atendendo esse serviço agora 😕 Me chama que a gente dá um jeito.');
    end if;

    select count(*) into quantos from jsonb_array_elements(novas);

    -- uma profissional só: perguntar seria burocracia
    if quantos = 1 then
      escolha := novas -> 0;
      cabecalho := '✨ ' || (d ->> 'servico') || ' com *' || (escolha ->> 'rotulo') || '*' || E'\n\n';
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
      c.estado := 'profissional';
    else
      update public.conversas
      set estado = 'profissional', dados = d, opcoes = novas,
          atualizada_em = now(), expira_em = now() + interval '30 minutes'
      where telefone = e164;

      return jsonb_build_object('acao', 'perguntou', 'estado', 'profissional',
        'responder', '✨ ' || (d ->> 'servico') || '! Com quem você prefere?'
                     || E'\n\n' || public.lista_numerada(novas)
                     || E'\n\n' || '_Responda com o número._');
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu quem atende -> que dia
  -- ---------------------------------------------------------------------
  if c.estado = 'profissional' then
    if d ->> 'prof_id' is null then
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
    end if;
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', dia_c::text, 'rotulo', rotulo_c, 'busca', rotulo_c))
      into novas
    from (
      select row_number() over (order by v.dia) as linha_c, v.dia as dia_c,
             public.dia_por_extenso(v.dia) || ' · ' || v.vagas || ' horários' as rotulo_c
      from public.dias_com_vaga(prof_id, dur, 5) v
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_vaga',
        'responder', 'Puxa, a agenda dela está cheia nos próximos dias 😕'
                     || E'\n\n' || 'Me chama que a gente encaixa você.');
    end if;

    update public.conversas
    set estado = 'dia', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'dia',
      'responder', cabecalho || '📅 Que dia fica melhor?' || E'\n\n'
                   || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu o dia -> que horas
  -- ---------------------------------------------------------------------
  if c.estado = 'dia' then
    d := d || jsonb_build_object('dia', escolha ->> 'id');
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', to_char(hora_c, 'HH24:MI'),
             'rotulo', to_char(hora_c, 'HH24:MI'), 'busca', to_char(hora_c, 'HH24:MI')))
      into novas
    from (
      select row_number() over (order by h.hora) as linha_c, h.hora as hora_c
      from public.horarios_livres(prof_id, dia_esc, dur) h
      limit 9
    ) t;

    if novas is null then
      -- alguém pegou o dia entre a pergunta e a resposta
      update public.conversas set estado = 'profissional', dados = d,
             atualizada_em = now() where telefone = e164;
      return jsonb_build_object('acao', 'dia_lotou',
        'responder', 'Esse dia acabou de encher 😕 Responda qualquer coisa que eu mostro os outros.');
    end if;

    update public.conversas
    set estado = 'hora', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'hora',
      'responder', '🕒 ' || public.dia_por_extenso(dia_esc) || '. Que horas?'
                   || E'\n\n' || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu a hora -> confere antes de marcar
  -- ---------------------------------------------------------------------
  if c.estado = 'hora' then
    d := d || jsonb_build_object('hora', escolha ->> 'id');
    novas := jsonb_build_array(
      jsonb_build_object('n', 1, 'id', 'sim', 'rotulo', 'Confirmar', 'busca', 'confirmar sim isso'),
      jsonb_build_object('n', 2, 'id', 'nao', 'rotulo', 'Recomeçar',  'busca', 'recomecar nao mudar'));

    update public.conversas
    set estado = 'confirma', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'confirma',
      'responder', 'Confere pra mim:' || E'\n\n'
                   || '✨ ' || (d ->> 'servico') || E'\n'
                   || '👩 com *' || (d ->> 'prof') || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso((d ->> 'dia')::date)
                   || ' às ' || (d ->> 'hora') || E'\n\n'
                   || public.lista_numerada(novas));
  end if;

  -- ---------------------------------------------------------------------
  -- Confirmou -> marca de verdade
  -- ---------------------------------------------------------------------
  if c.estado = 'confirma' then
    if (escolha ->> 'id') = 'nao' then
      delete from public.conversas where telefone = e164;
      return public.avancar_conversa(e164, 'recomecar', c.salon_id);
    end if;

    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;
    hora_esc := (d ->> 'hora')::time;
    nome_serv := d ->> 'servico';
    prof_nome := d ->> 'prof';

    -- Entre a pergunta e a resposta dela, alguém pode ter marcado. O
    -- índice único de (data, hora) barra o choque, mas conferir antes
    -- deixa a resposta decente em vez de um erro de banco.
    if not exists (
      select 1 from public.horarios_livres(prof_id, dia_esc, dur) h
      where h.hora = hora_esc
    ) then
      update public.conversas set estado = 'profissional', atualizada_em = now()
      where telefone = e164;
      return jsonb_build_object('acao', 'hora_foi',
        'responder', 'Que pena, pegaram esse horário agora 😕'
                     || E'\n\n' || 'Responda qualquer coisa que eu mostro os que sobraram.');
    end if;

    insert into public.appointments
      (client_id, professional_id, salon_id, service_id,
       date, start_time, end_time, status)
    values
      (c.client_id, prof_id, c.salon_id, (d ->> 'servico_id')::uuid,
       dia_esc, hora_esc, (hora_esc + make_interval(mins => dur))::time,
       'confirmado')
    returning id into novo_appt;

    delete from public.conversas where telefone = e164;

    return jsonb_build_object('acao', 'marcou', 'appointment_id', novo_appt,
      'responder', '✅ *Marcado!*' || E'\n\n'
                   || '✨ ' || nome_serv || E'\n'
                   || '👩 com *' || prof_nome || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                   || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                   || 'Te espero! Se precisar mudar, é só me chamar 💛');
  end if;

  return jsonb_build_object('acao', 'nada');
end;
$$;

revoke execute on function public.avancar_conversa(text, text, uuid)
  from public, anon, authenticated;

-- 7. O bot entra na porta de entrada --------------------------------------
-- Até aqui, "quer marcar" respondia com o link e avisava a profissional.
-- Agora, quando o salão liga o bot, quem responde é ele — e o link vira
-- o plano B, para salão que não quer bot e para cliente sem cadastro.
alter table public.whatsapp_channels
  add column if not exists usa_bot boolean not null default false;

grant update (usa_bot) on public.whatsapp_channels to authenticated;

drop function if exists public.ligar_bot(uuid, boolean);
create or replace function public.ligar_bot(salao uuid, ligado boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'só a dona do salão liga o bot';
  end if;
  update public.whatsapp_channels set usa_bot = ligado where salon_id = salao;
  return ligado;
end;
$$;

revoke execute on function public.ligar_bot(uuid, boolean) from public, anon;
grant execute on function public.ligar_bot(uuid, boolean) to authenticated;

-- 8. Uma porta só ---------------------------------------------------------
-- O webhook chama esta, e ela decide: conversa em andamento continua,
-- mesmo que a mensagem pareça outra coisa; senão vale o caminho de
-- sempre. Sem isto, a cliente respondendo "2" no meio do menu cairia em
-- interpretar_resposta() e cancelaria um agendamento por engano.
create or replace function public.receber_mensagem(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  intencao_do_modelo text default null,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  r jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- repetida não age duas vezes, nem no bot
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select c.usa_bot into bot_ligado
  from public.whatsapp_channels c where c.salon_id = salao;

  select exists (
    select 1 from public.conversas
    where telefone = e164 and expira_em > now()
  ) into tem_conversa;

  -- Conversa aberta ganha de tudo. É o passo mais importante desta
  -- função: no meio de um menu, "2" quer dizer "a segunda opção", nunca
  -- "cancele meu horário".
  if tem_conversa or (coalesce(bot_ligado, false)
                      and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
    values (e164, texto, id_provedor,
            public.cliente_pelo_telefone(e164),
            'bot:' || coalesce(r ->> 'acao', '?'),
            nullif(r ->> 'appointment_id', '')::uuid,
            case when tem_conversa then 'bot' else 'ia' end,
            intencao_do_modelo);

    -- quem não tem cadastro não some: cai no caminho antigo, que manda o
    -- link e avisa gente
    if (r ->> 'acao') <> 'sem_cadastro' then
      return r;
    end if;
  end if;

  return public.receber_resposta_whatsapp(
    e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);
end;
$$;

revoke execute on function
  public.receber_mensagem(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- 'bot' entra na lista de origens conhecidas
do $$ begin
  alter table public.whatsapp_inbox drop constraint if exists via_conhecida;
  alter table public.whatsapp_inbox
    add constraint via_conhecida check (via in ('regra', 'ia', 'bot'));
exception when others then null; end $$;

-- =============================================================
-- >>> 036_cliente_ganha_o_telefone.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 036: num telefone repetido, quem manda é a cliente
--
-- O cliente_pelo_telefone() devolve um perfil só, e escolhia pela ordem
-- de criação. Isso funciona por acidente: no banco de teste a cliente
-- foi criada antes da profissional, então a cliente ganha. Se a ordem
-- fosse a outra, o bot trataria a PROFISSIONAL como cliente e marcaria
-- horário dela com ela mesma.
--
-- E telefone repetido não é caso de laboratório. Mãe e filha atendidas
-- pelo mesmo número, a dona do salão que também é cliente, o celular da
-- recepção — acontece.
--
-- A regra passa a ser explícita: entre perfis com o mesmo telefone,
-- quem responde no WhatsApp é a CLIENTE. Quem atende usa o app.
-- =============================================================

create or replace function public.cliente_pelo_telefone(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id
  from public.profiles p
  where public.telefone_e164(p.phone) = public.telefone_e164(tel)
  order by
    -- cliente primeiro; entre iguais, a mais antiga
    case p.role when 'cliente' then 0 when 'admin' then 1 else 2 end,
    p.created_at
  limit 1;
$$;

revoke execute on function public.cliente_pelo_telefone(text)
  from public, anon, authenticated;

-- =============================================================
-- >>> 037_sem_cadastro_nao_some.sql
-- =============================================================

-- =============================================================
-- Agenda Mel — 037: quem não tem cadastro não pode sumir
--
-- O receber_mensagem() grava a mensagem no inbox e, quando o bot
-- responde 'sem_cadastro', repassa para o caminho antigo — que manda o
-- link e avisa a profissional.
--
-- Só que o repasse leva o mesmo provider_id, e o caminho antigo tem uma
-- trava contra evento repetido: "esse id já está no inbox, então já
-- agi". A trava está certa; o problema é que quem colocou o id lá foi o
-- próprio bot, dois passos antes. Resultado: a pessoa sem cadastro —
-- justamente a que mais precisa de resposta — não recebia nada.
--
-- Bug de ordem, não de lógica: gravar antes de decidir se ia repassar.
-- Agora o registro só acontece quando o bot realmente responde; no
-- repasse, quem grava é quem responde.
-- =============================================================

create or replace function public.receber_mensagem(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  intencao_do_modelo text default null,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  r jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select c.usa_bot into bot_ligado
  from public.whatsapp_channels c where c.salon_id = salao;

  select exists (
    select 1 from public.conversas
    where telefone = e164 and expira_em > now()
  ) into tem_conversa;

  -- Conversa aberta ganha de tudo: no meio de um menu, "2" quer dizer
  -- "a segunda opção", nunca "cancele meu horário".
  if tem_conversa or (coalesce(bot_ligado, false)
                      and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);

    -- só registra se o bot está mesmo respondendo. Registrar antes de
    -- saber disso é o que fazia o repasse abaixo se enxergar como
    -- mensagem repetida e devolver silêncio.
    if (r ->> 'acao') <> 'sem_cadastro' then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor,
              public.cliente_pelo_telefone(e164),
              'bot:' || coalesce(r ->> 'acao', '?'),
              nullif(r ->> 'appointment_id', '')::uuid,
              case when tem_conversa then 'bot' else 'ia' end,
              intencao_do_modelo);
      return r;
    end if;
  end if;

  return public.receber_resposta_whatsapp(
    e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);
end;
$$;

revoke execute on function
  public.receber_mensagem(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- Diagnóstico do bot ------------------------------------------------------
-- "chegou o menu mas não marcou nada" pode ser cinco coisas, e caçar em
-- quatro tabelas cada vez é caro. Isto responde de uma vez.
drop function if exists public.diagnostico_bot(uuid);
create or replace function public.diagnostico_bot(salao uuid)
returns table (item text, resposta text)
language plpgsql
stable
security definer set search_path = public
as $fn$
begin
  if not public.is_admin_do_salao(salao) then
    return;
  end if;

  return query
  select 'Bot ligado?',
         coalesce((select case when usa_bot then 'sim' else 'NÃO' end
                   from public.whatsapp_channels where salon_id = salao), '?')
  union all
  select 'Conversa aberta agora',
         coalesce((select string_agg(telefone || ' parou em "' || estado || '"'
                          || ' (expira ' || to_char(expira_em at time zone 'America/Sao_Paulo','HH24:MI') || ')', ' | ')
                   from public.conversas where salon_id = salao), 'nenhuma')
  union all
  select 'Últimos passos do bot',
         coalesce((select string_agg(replace(acao,'bot:','') || ' <- "' || left(texto,22) || '"', '  →  '
                          order by recebido_em)
                   from (select * from public.whatsapp_inbox
                         where acao like 'bot:%' order by recebido_em desc limit 8) u),
                  'o bot ainda não respondeu nada')
  union all
  select 'Horários marcados pelo bot',
         coalesce((select count(*)::text || ' (último: ' ||
                          to_char(max(recebido_em) at time zone 'America/Sao_Paulo','DD/MM HH24:MI') || ')'
                   from public.whatsapp_inbox
                   where acao = 'bot:marcou' and appointment_id is not null), '0')
  union all
  select 'Avisos gerados para a equipe',
         coalesce((select count(*)::text from public.message_outbox
                   where salon_id = salao and kind in ('novo_agendamento','pedido_pelo_whatsapp')
                     and criado_em > now() - interval '2 hours'), '0')
         || ' nas últimas 2h'
  union all
  select 'Saíram mesmo?',
         coalesce((select string_agg(distinct status, ', ') from public.message_outbox
                   where salon_id = salao and kind in ('novo_agendamento','pedido_pelo_whatsapp')
                     and criado_em > now() - interval '2 hours'), 'nada para enviar')
  union all
  select 'Telefone da equipe',
         coalesce((select string_agg(p.name || '=' ||
                    coalesce(public.telefone_e164(pf.phone), 'SEM TELEFONE NO PERFIL'), ' | ')
                   from public.professionals p
                   left join public.profiles pf on pf.id = p.user_id
                   where p.salon_id = salao and p.active), 'nenhuma');
end;
$fn$;

revoke execute on function public.diagnostico_bot(uuid) from public, anon;
grant execute on function public.diagnostico_bot(uuid) to authenticated;

