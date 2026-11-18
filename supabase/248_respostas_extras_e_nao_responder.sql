-- 248 · Limites e pausas à vista, respostas extras por Pix e os números que a assistente não responde (3.99)
--
--   • Limites e pausas (WhatsApp › Assistente): quantas respostas ela deu hoje das incluídas no plano (o teto do dia,
--     200), o saldo extra, as regras das pausas automáticas e quem está em pausa agora, com "Voltar a responder".
--   • Respostas extras: pacotes de 500, 1.000 e 2.000 (R$ 19,90, 34,90 e 59,90) pagos por Pix na conta da MIMO
--     (referência respostas:<id> no Asaas). Pagou, o saldo entra sozinho (aviso do Asaas ou a tela conferindo). O
--     saldo não vence e só é gasto depois das 200 do dia, uma resposta por vez (registrar_chamada_ia).
--   • Avisos para quem manda no salão (sino e celular): 80% do dia usado, o dia acabou (segue pelo saldo ou para),
--     saldo acabando (50) e acabou, Pix confirmado.
--   • Números que ela não responde: a equipe do salão fica de fora (ligado por padrão: profissionais e quem manda no
--     salão) e uma lista do salão (fornecedor, outro celular). A mensagem chega no celular normalmente; a assistente
--     e as respostas prontas não respondem. O "1/2" da profissional e a resposta ao lembrete continuam valendo.

-- 1. Colunas e tabelas ------------------------------------------------------------------------------------------
alter table public.salons add column if not exists respostas_extras integer not null default 0;
alter table public.salons add column if not exists assistente_ignora_equipe boolean not null default true;
do $$ begin
  alter table public.salons add constraint salons_respostas_extras_positivo check (respostas_extras >= 0);
exception when duplicate_object then null; end $$;

create table if not exists public.assistente_nao_responder (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  telefone text not null,
  nome text,
  criado_em timestamptz not null default now()
);
create unique index if not exists assistente_nao_responder_um on public.assistente_nao_responder (salon_id, telefone);
alter table public.assistente_nao_responder enable row level security;
revoke all on public.assistente_nao_responder from public, anon, authenticated;

create table if not exists public.respostas_compras (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  respostas integer not null check (respostas > 0),
  valor_cents integer not null check (valor_cents > 0),
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'cancelado')),
  cobranca_id text,
  copia_cola text,
  erro text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
create index if not exists respostas_compras_salao on public.respostas_compras (salon_id, criado_em desc);
alter table public.respostas_compras enable row level security;
revoke all on public.respostas_compras from public, anon, authenticated;

-- 2. Os pacotes ------------------------------------------------------------------------------------------------
create or replace function public.respostas_pacotes()
returns jsonb
language sql
immutable
as $$
  select '[{"respostas": 500, "valor_cents": 1990},
           {"respostas": 1000, "valor_cents": 3490, "destaque": "mais escolhido"},
           {"respostas": 2000, "valor_cents": 5990, "destaque": "melhor preço"}]'::jsonb;
$$;
grant execute on function public.respostas_pacotes() to authenticated;

-- 3. Quem a assistente não responde -----------------------------------------------------------------------------
create or replace function public.numero_sem_resposta(salao uuid, tel text)
returns boolean
language plpgsql
stable security definer set search_path = public
as $$
declare chave text := public.telefone_chave(tel); s public.salons%rowtype;
begin
  if chave is null then return false; end if;
  if exists (select 1 from public.assistente_nao_responder n where n.salon_id = salao and public.telefone_chave(n.telefone) = chave) then
    return true;
  end if;
  select * into s from public.salons where id = salao;
  if not coalesce(s.assistente_ignora_equipe, true) then return false; end if;
  return exists (select 1 from public.professionals p where p.salon_id = salao and p.situacao <> 'inativa' and public.telefone_chave(p.phone) = chave)
      or exists (select 1 from public.professionals p join public.profiles pf on pf.id = p.user_id
                  where p.salon_id = salao and p.situacao <> 'inativa' and public.telefone_chave(pf.phone) = chave)
      or exists (select 1 from public.salon_members m join public.profiles pf on pf.id = m.user_id
                  where m.salon_id = salao and m.papel = 'admin' and public.telefone_chave(pf.phone) = chave)
      or exists (select 1 from public.profiles pf where pf.id = s.owner_id and public.telefone_chave(pf.phone) = chave);
end;
$$;
revoke execute on function public.numero_sem_resposta(uuid, text) from public, anon, authenticated;

-- a equipe que fica de fora e a lista do salão, para a tela
create or replace function public.assistente_sem_resposta(salao uuid)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só quem manda no salão vê isso.'; end if;
  select * into s from public.salons where id = salao;
  return jsonb_build_object(
    'ignora_equipe', coalesce(s.assistente_ignora_equipe, true),
    'equipe', coalesce((
      select jsonb_agg(jsonb_build_object('nome', x.nome, 'telefone', x.telefone, 'voce', x.voce) order by x.voce desc, x.nome)
      from (
        select distinct on (public.telefone_chave(x.telefone)) x.nome, x.telefone, x.voce
        from (
          select coalesce(nullif(btrim(pf.full_name), ''), 'Você') as nome, pf.phone as telefone, true as voce
            from public.profiles pf where pf.id = s.owner_id
          union all
          select coalesce(nullif(btrim(pf.full_name), ''), 'Admin'), pf.phone, false
            from public.salon_members m join public.profiles pf on pf.id = m.user_id
           where m.salon_id = salao and m.papel = 'admin' and m.user_id is distinct from s.owner_id
          union all
          select p.name, coalesce(nullif(btrim(pf.phone), ''), p.phone), false
            from public.professionals p left join public.profiles pf on pf.id = p.user_id
           where p.salon_id = salao and p.situacao <> 'inativa' and (p.user_id is null or p.user_id is distinct from s.owner_id)
        ) x
        where public.telefone_chave(x.telefone) is not null
        order by public.telefone_chave(x.telefone), x.voce desc
      ) x), '[]'::jsonb),
    'lista', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'nome', n.nome, 'telefone', n.telefone) order by n.criado_em desc)
        from public.assistente_nao_responder n where n.salon_id = salao), '[]'::jsonb));
end;
$$;

create or replace function public.assistente_sem_resposta_salvar(salao uuid, tel text, nome_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare e164 text := public.telefone_e164(tel);
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão muda isso.'; end if;
  if e164 is null then raise exception 'Confira o WhatsApp: DDD e número (ex.: 13 99999-1234).'; end if;
  insert into public.assistente_nao_responder (salon_id, telefone, nome)
  values (salao, e164, nullif(btrim(coalesce(nome_, '')), ''))
  on conflict (salon_id, telefone) do update set nome = coalesce(excluded.nome, public.assistente_nao_responder.nome);
  return public.assistente_sem_resposta(salao);
end;
$$;

create or replace function public.assistente_sem_resposta_tirar(salao uuid, item uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão muda isso.'; end if;
  delete from public.assistente_nao_responder where id = item and salon_id = salao;
  return public.assistente_sem_resposta(salao);
end;
$$;

create or replace function public.salao_ignora_equipe(salao uuid, liga boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão muda isso.'; end if;
  update public.salons set assistente_ignora_equipe = coalesce(liga, true) where id = salao;
  return public.assistente_sem_resposta(salao);
end;
$$;

revoke execute on function public.assistente_sem_resposta(uuid) from public, anon;
revoke execute on function public.assistente_sem_resposta_salvar(uuid, text, text) from public, anon;
revoke execute on function public.assistente_sem_resposta_tirar(uuid, uuid) from public, anon;
revoke execute on function public.salao_ignora_equipe(uuid, boolean) from public, anon;
grant execute on function public.assistente_sem_resposta(uuid) to authenticated;
grant execute on function public.assistente_sem_resposta_salvar(uuid, text, text) to authenticated;
grant execute on function public.assistente_sem_resposta_tirar(uuid, uuid) to authenticated;
grant execute on function public.salao_ignora_equipe(uuid, boolean) to authenticated;

-- 4. Limites e pausas, para a tela ------------------------------------------------------------------------------
create or replace function public.assistente_limites(salao uuid)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare s public.salons%rowtype; teto integer;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só quem manda no salão vê isso.'; end if;
  select * into s from public.salons where id = salao;
  select coalesce(c.teto_ia_diario, 200) into teto from public.whatsapp_channels c where c.salon_id = salao;
  return jsonb_build_object(
    'usadas', coalesce(public.ia_gastas_hoje(salao), 0),
    'teto', coalesce(teto, 200),
    'extras', coalesce(s.respostas_extras, 0),
    'pacotes', public.respostas_pacotes(),
    'pausas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'telefone', p.telefone,
               'nome', (select nullif(btrim(pf.full_name), '') from public.profiles pf where pf.id = public.cliente_pelo_telefone(p.telefone)),
               'tipo', case when p.motivo = 'encerrada: ofensiva' then 'ofensiva'
                            when p.motivo like 'encerrada%' then 'fora_do_assunto'
                            when p.motivo = 'a equipe respondeu pelo celular' then 'equipe_respondeu'
                            else 'chamou_equipe' end,
               'ate', p.ate) order by p.ate)
        from public.bot_pausas p where p.salon_id = salao and p.ate > now()), '[]'::jsonb),
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object('respostas', r.respostas, 'valor_cents', r.valor_cents, 'pago_em', r.pago_em) order by r.pago_em desc)
        from (select * from public.respostas_compras r where r.salon_id = salao and r.status = 'pago' order by r.pago_em desc limit 5) r), '[]'::jsonb));
end;
$$;

create or replace function public.assistente_voltar_a_responder(salao uuid, tel text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão muda isso.'; end if;
  delete from public.bot_pausas p where p.salon_id = salao and public.telefone_chave(p.telefone) = public.telefone_chave(tel);
  return public.assistente_limites(salao);
end;
$$;

revoke execute on function public.assistente_limites(uuid) from public, anon;
revoke execute on function public.assistente_voltar_a_responder(uuid, text) from public, anon;
grant execute on function public.assistente_limites(uuid) to authenticated;
grant execute on function public.assistente_voltar_a_responder(uuid, text) to authenticated;

-- 5. Os avisos para quem manda no salão (sino e celular) ----------------------------------------------------------
create or replace function public.milhar(n bigint)
returns text
language sql
immutable
as $$ select replace(to_char(coalesce(n, 0), 'FM999,999,999,990'), ',', '.') $$;

create or replace function public.avisar_quem_manda(salao uuid, tipo text, titulo text, corpo text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare adm uuid;
begin
  for adm in
    select distinct x.u from (
      select s.owner_id as u from public.salons s where s.id = salao
      union select m.user_id from public.salon_members m where m.salon_id = salao and m.papel = 'admin') x
    where x.u is not null
  loop
    perform public.notificar(adm, tipo, titulo, corpo, '/admin/whatsapp?aba=assistente', jsonb_build_object('salon_id', salao));
  end loop;
end;
$$;
revoke execute on function public.avisar_quem_manda(uuid, text, text, text) from public, anon, authenticated;

-- 6. A compra de respostas extras ---------------------------------------------------------------------------------
-- abre (ou reaproveita) a compra do pacote; as outras que estavam esperando caem (a função apaga no Asaas)
create or replace function public.respostas_compra_abrir(salao uuid, respostas_ integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; p public.profiles%rowtype; em text; pac jsonb; c public.respostas_compras%rowtype;
        anteriores text[]; cliente_asaas text;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão compra respostas.'; end if;
  select x into pac from jsonb_array_elements(public.respostas_pacotes()) x where (x ->> 'respostas')::int = respostas_;
  if pac is null then raise exception 'Pacote desconhecido.'; end if;
  select * into s from public.salons where id = salao;
  select * into p from public.profiles where id = s.owner_id;
  select u.email into em from auth.users u where u.id = s.owner_id;
  select a.customer_id into cliente_asaas from public.assinaturas a where a.salon_id = salao;

  -- o mesmo pacote aguardando, de hoje: é ele (tocar duas vezes não cria dois Pix)
  select * into c from public.respostas_compras r
   where r.salon_id = salao and r.status = 'aguardando' and r.respostas = respostas_ and r.criado_em > now() - interval '20 hours'
   order by r.criado_em desc limit 1;
  select array_agg(r.cobranca_id) filter (where r.cobranca_id is not null) into anteriores
    from public.respostas_compras r where r.salon_id = salao and r.status = 'aguardando' and r.id is distinct from c.id;
  update public.respostas_compras r set status = 'cancelado', erro = 'trocou de pacote'
   where r.salon_id = salao and r.status = 'aguardando' and r.id is distinct from c.id;
  if c.id is null then
    insert into public.respostas_compras (salon_id, respostas, valor_cents, criado_por)
    values (salao, respostas_, (pac ->> 'valor_cents')::int, auth.uid())
    returning * into c;
  end if;
  return jsonb_build_object(
    'id', c.id, 'respostas', c.respostas, 'valor_cents', c.valor_cents, 'status', c.status,
    'cobranca_id', c.cobranca_id, 'copia_cola', c.copia_cola, 'anteriores', coalesce(to_jsonb(anteriores), '[]'::jsonb),
    'cliente', jsonb_build_object(
      'nome', s.name, 'razao_social', coalesce(s.razao_social, s.name),
      'documento', coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
      'email', coalesce(s.email, em), 'telefone', coalesce(s.whatsapp, s.phone, p.phone), 'customer_id', cliente_asaas));
end;
$$;

-- a função anota a cobrança criada no Asaas (só a chave de serviço)
create or replace function public.respostas_compra_atualizar(compra uuid, cobranca_id_ text, copia_cola_ text, erro_ text default null)
returns void
language sql
security definer set search_path = public
as $$
  update public.respostas_compras
     set cobranca_id = coalesce(cobranca_id_, cobranca_id), copia_cola = coalesce(copia_cola_, copia_cola), erro = erro_
   where id = compra;
$$;

-- pagou: soma no saldo uma vez só, e avisa (só a chave de serviço: o aviso do Asaas ou a tela conferindo)
create or replace function public.respostas_compra_paga(compra uuid, cobranca_asaas text default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.respostas_compras%rowtype; saldo integer;
begin
  update public.respostas_compras
     set status = 'pago', pago_em = coalesce(quando, now()), cobranca_id = coalesce(cobranca_asaas, cobranca_id), erro = null
   where id = compra and status <> 'pago'
  returning * into c;
  if c.id is null then
    select * into c from public.respostas_compras where id = compra;
    return jsonb_build_object('ok', c.id is not null, 'ja', true, 'extras', (select respostas_extras from public.salons where id = c.salon_id));
  end if;
  update public.salons set respostas_extras = respostas_extras + c.respostas where id = c.salon_id returning respostas_extras into saldo;
  perform public.avisar_quem_manda(c.salon_id, 'respostas_pagas',
    'Pix confirmado: +' || public.milhar(c.respostas) || ' respostas',
    'Saldo extra agora: ' || public.milhar(saldo) || ' respostas. Ela usa quando as do dia acabarem.');
  return jsonb_build_object('ok', true, 'extras', saldo, 'respostas', c.respostas);
end;
$$;

create or replace function public.respostas_compra_cancelar(compra uuid, motivo text default null)
returns void
language sql
security definer set search_path = public
as $$
  update public.respostas_compras set status = 'cancelado', erro = coalesce(motivo, erro) where id = compra and status = 'aguardando';
$$;

-- a tela pergunta como está a compra
create or replace function public.respostas_compra_estado(compra uuid)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare c public.respostas_compras%rowtype;
begin
  select * into c from public.respostas_compras where id = compra;
  if c.id is null or not (public.is_admin_do_salao(c.salon_id) or public.eh_plataforma()) then raise exception 'Compra não encontrada.'; end if;
  return jsonb_build_object('id', c.id, 'salon_id', c.salon_id, 'status', c.status, 'respostas', c.respostas, 'valor_cents', c.valor_cents,
    'cobranca_id', c.cobranca_id, 'copia_cola', c.copia_cola, 'extras', (select respostas_extras from public.salons where id = c.salon_id));
end;
$$;

revoke execute on function public.respostas_compra_abrir(uuid, integer) from public, anon;
grant execute on function public.respostas_compra_abrir(uuid, integer) to authenticated;
revoke execute on function public.respostas_compra_estado(uuid) from public, anon;
grant execute on function public.respostas_compra_estado(uuid) to authenticated;
revoke execute on function public.respostas_compra_atualizar(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.respostas_compra_paga(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.respostas_compra_cancelar(uuid, text) from public, anon, authenticated;

-- 7. Cada resposta do dia: passou das incluídas, gasta uma do saldo; e os avisos nos marcos -------------------------
create or replace function public.contar_resposta_do_dia(salao uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare usadas integer := coalesce(public.ia_gastas_hoje(salao), 0); teto integer; extras integer; saldo integer; oitenta integer;
begin
  select coalesce(c.teto_ia_diario, 200) into teto from public.whatsapp_channels c where c.salon_id = salao;
  teto := coalesce(teto, 200);
  select coalesce(s.respostas_extras, 0) into extras from public.salons s where s.id = salao;
  if usadas > teto and extras > 0 then
    update public.salons set respostas_extras = respostas_extras - 1 where id = salao and respostas_extras > 0
    returning respostas_extras into saldo;
    if saldo = 50 then
      perform public.avisar_quem_manda(salao, 'assistente_limite', 'Saldo extra acabando',
        'Restam 50 respostas. Quando acabar, ela para depois das ' || public.milhar(teto) || ' do dia. Toque para comprar mais.');
    elsif saldo = 0 then
      perform public.avisar_quem_manda(salao, 'assistente_limite', 'O saldo extra acabou',
        'Hoje ela para por aqui e as mensagens ficam para a equipe; amanhã volta com as ' || public.milhar(teto) || ' do dia. Toque para comprar mais respostas.');
    end if;
    return;
  end if;
  oitenta := greatest(1, round(teto * 0.8))::int;
  if usadas = oitenta and oitenta < teto then
    perform public.avisar_quem_manda(salao, 'assistente_limite', 'A assistente já usou ' || public.milhar(usadas) || ' de ' || public.milhar(teto) || ' hoje',
      case when extras > 0 then 'Depois das ' || public.milhar(teto) || ', ela segue pelo saldo extra: ' || public.milhar(extras) || ' respostas.'
           else 'Seu saldo extra está zerado. Toque para comprar mais respostas.' end);
  elsif usadas = teto then
    perform public.avisar_quem_manda(salao, 'assistente_limite', 'As ' || public.milhar(teto) || ' respostas de hoje acabaram',
      case when extras > 0 then 'Ela segue pelo saldo extra: restam ' || public.milhar(extras) || ' respostas.'
           else 'Ela para até amanhã e as mensagens ficam para a equipe. Toque para comprar mais respostas.' end);
  end if;
end;
$$;
revoke execute on function public.contar_resposta_do_dia(uuid) from public, anon, authenticated;

-- 8. O registro da chamada conta a resposta (registrar_chamada_ia) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_chamada_ia(salao uuid, tel text, modelo_usado text DEFAULT NULL::text, tk_prompt integer DEFAULT NULL::integer, tk_resposta integer DEFAULT NULL::integer, duracao_ms integer DEFAULT NULL::integer, deu_erro text DEFAULT NULL::text, inbox uuid DEFAULT NULL::uuid, provedor_ text DEFAULT NULL::text, cache_lidos integer DEFAULT NULL::integer, cache_gravados integer DEFAULT NULL::integer, custo numeric DEFAULT NULL::numeric, ferramentas_ text[] DEFAULT NULL::text[], acoes_ jsonb DEFAULT NULL::jsonb, respondeu_ boolean DEFAULT NULL::boolean, ensaio_ boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  novo uuid;
begin
  insert into public.ia_chamadas
    (salon_id, telefone, inbox_id, modelo, tokens_prompt, tokens_resposta, ms, erro,
     provedor, tokens_cache_lidos, tokens_cache_gravados, custo_usd, ferramentas, acoes, respondeu, ensaio)
  values
    (salao, coalesce(public.telefone_e164(tel), left(coalesce(tel, '?'), 40)), inbox, modelo_usado, tk_prompt, tk_resposta, duracao_ms, deu_erro,
     provedor_, cache_lidos, cache_gravados, custo, ferramentas_, acoes_, respondeu_, coalesce(ensaio_, false))
  returning id into novo;
  -- 248: a resposta conta no dia (e gasta do saldo extra depois das incluídas)
  if salao is not null and deu_erro is null and not coalesce(ensaio_, false) then
    perform public.contar_resposta_do_dia(salao);
  end if;
  return novo;
end;
$function$;

-- 9. O contexto da assistente: não responde quem está na lista; o saldo estende o dia (bot_contexto) -----------------
CREATE OR REPLACE FUNCTION public.bot_contexto(salao uuid, tel text, instancia text DEFAULT NULL::text, sem_espera boolean DEFAULT false, rascunho jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e164 text := public.telefone_e164(tel);
  cli uuid;
  s record; c record; canal record;
  agora timestamptz := now();
  sp timestamp := (now() at time zone 'America/Sao_Paulo');
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  historico jsonb := '[]'::jsonb; proximos jsonb := '[]'::jsonb; pausado boolean; gastas integer := 0;
  ensaio boolean := rascunho is not null;
  ass jsonb; proprio boolean := false; aberto boolean;
  cliente jsonb;
  recado text;
begin
  select * into s from public.salons where id = salao;
  if not found then return jsonb_build_object('permitido', false, 'motivo', 'salao_desconhecido'); end if;
  select * into canal from public.whatsapp_channels where salon_id = salao;
  ass := public.assistente_config(salao);
  aberto := public.salao_aberto_agora(salao);
  recado := canal.orientacao_ia;

  if ensaio then
    if jsonb_typeof(rascunho -> 'assistente') = 'object' then
      ass := ass || coalesce((select jsonb_object_agg(e.k, e.v) from jsonb_each(rascunho -> 'assistente') e(k, v)
                               where e.k in ('nome', 'tom', 'emojis', 'tratamento', 'tamanho', 'preco', 'pode_marcar', 'pode_remarcar', 'pode_cancelar', 'saudacao')), '{}'::jsonb);
    end if;
    if rascunho ? 'recado' then recado := nullif(btrim(coalesce(rascunho ->> 'recado', '')), ''); end if;
    -- o teste mostra como ela fala no número do salão (é lá que nome e tom valem)
    proprio := true;
    if (select count(*) from public.ia_chamadas i where i.salon_id = salao and i.ensaio and i.criado_em > now() - interval '1 hour') >= 40 then
      return jsonb_build_object('permitido', false, 'motivo', 'teto_do_teste');
    end if;
    cliente := jsonb_build_object('id', '00000000-0000-0000-0000-000000000000', 'nome', coalesce(nullif(btrim(rascunho ->> 'cliente_nome'), ''), 'Cliente de teste'),
                                  'primeiro_nome', nullif(split_part(btrim(coalesce(rascunho ->> 'cliente_nome', '')), ' ', 1), ''), 'vinculada', true);
  else
    if canal.salon_id is null or not canal.ativo or not coalesce(canal.usa_ia, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'ia_desligada');
    end if;
    if coalesce((select valor from public.config_publica where chave = 'ia_agente'), 'ligado') <> 'ligado' then
      return jsonb_build_object('permitido', false, 'motivo', 'agente_desligado');
    end if;
    -- 3.95.1: a assistente só atende salão que conectou o próprio WhatsApp (o número da MIMO é só reserva de envio)
    if not coalesce(canal.numero_proprio, false) then
      return jsonb_build_object('permitido', false, 'motivo', 'sem_numero_proprio');
    end if;
    select exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now()) into pausado;
    if pausado then return jsonb_build_object('permitido', false, 'motivo', 'pausado_para_humano'); end if;
    -- 246: freio de laço: muitas respostas para o mesmo número em poucos minutos é robô conversando com robô
    if (select count(*) from public.message_outbox o
         where o.salon_id = salao and o.kind = 'agente' and public.telefone_chave(o.telefone) = public.telefone_chave(e164)
           and o.enviado_em > now() - interval '5 minutes') >= 15 then
      return jsonb_build_object('permitido', false, 'motivo', 'muitas_respostas');
    end if;
    -- 248: os números que ela não responde (a equipe do salão, a lista do salão)
    if public.numero_sem_resposta(salao, e164) then
      return jsonb_build_object('permitido', false, 'motivo', 'nao_responder');
    end if;
    gastas := coalesce(public.ia_gastas_hoje(salao), 0);
    -- 248: passou das incluídas no dia, segue enquanto houver saldo extra
    if gastas >= coalesce(canal.teto_ia_diario, 200) and coalesce(s.respostas_extras, 0) <= 0 then
      return jsonb_build_object('permitido', false, 'motivo', 'teto_do_dia');
    end if;

    proprio := coalesce(canal.numero_proprio, false) and (instancia is null or canal.identificador = instancia);
    -- quando responde (só no número próprio: no da casa a equipe nem vê a conversa)
    if proprio and not coalesce(sem_espera, false) then
      if ass ->> 'quando' = 'fora_do_horario' and aberto then
        return jsonb_build_object('permitido', false, 'motivo', 'em_expediente');
      end if;
      if ass ->> 'quando' = 'sem_resposta' and aberto then
        return jsonb_build_object('permitido', false, 'motivo', 'esperar',
                                  'responder_em', now() + make_interval(mins => coalesce((ass ->> 'espera_min')::int, 10)));
      end if;
    end if;

    cli := public.cliente_pelo_telefone(tel);
    if cli is not null then select id, full_name, phone into c from public.profiles where id = cli; end if;

    select coalesce(jsonb_agg(jsonb_build_object('quem', x.quem, 'texto', x.texto, 'quando', x.quando) order by x.quando), '[]'::jsonb)
      into historico
    from (
      select * from (
        select 'cliente' as quem, i.texto, i.recebido_em as quando from public.whatsapp_inbox i
         where public.telefone_chave(i.telefone) = public.telefone_chave(e164) and i.recebido_em > agora - interval '24 hours'
           and i.salon_id = salao   -- 246: só a conversa com este salão
        union all
        select 'mimo', o.corpo, coalesce(o.enviado_em, o.liberado_em) from public.message_outbox o
         where public.telefone_chave(o.telefone) = public.telefone_chave(e164) and o.status in ('enviado','entregue','lido')
           and o.salon_id = salao   -- 246: só o que este salão mandou
           and coalesce(o.enviado_em, o.liberado_em) > agora - interval '24 hours'
      ) h order by h.quando desc limit 12
    ) x;

    if cli is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'appointment_id', a.id, 'servico', coalesce(a.service_name, sv.name), 'profissional', pr.name, 'profissional_id', pr.id,
               'dia', to_char(a.date, 'YYYY-MM-DD'), 'dia_semana', dias[extract(dow from a.date)::int + 1],
               'hora', to_char(a.start_time, 'HH24:MI'), 'status', a.status) order by a.date, a.start_time), '[]'::jsonb)
        into proximos
      from public.appointments a
      join public.professionals pr on pr.id = a.professional_id
      left join public.services sv on sv.id = a.service_id
      where a.client_id = cli and a.salon_id = salao and a.status in ('pendente', 'confirmado')
        and (a.date + a.start_time) >= sp - interval '1 hour'
      limit 6;
      cliente := jsonb_build_object('id', cli, 'nome', c.full_name,
                   'primeiro_nome', nullif(split_part(coalesce(c.full_name, ''), ' ', 1), ''),
                   'vinculada', exists (select 1 from public.vinculos v where v.client_id = cli and v.salon_id = salao and v.saiu_em is null));
    end if;
  end if;

  return jsonb_build_object(
    'permitido', true,
    'ensaio', ensaio,
    'provedor', coalesce((select valor from public.config_publica where chave = 'ia_provedor'), 'claude'),
    'modelo', coalesce((select valor from public.config_publica where chave = 'ia_modelo'), 'openai/gpt-oss-120b'),
    'modelo_claude', coalesce((select valor from public.config_publica where chave = 'ia_modelo_claude'), 'claude-haiku-5-5'),
    'orientacao', coalesce(public.modelo_editado('ia.orientacao'), (select padrao from public.modelos_de_mensagem where chave = 'ia.orientacao')),
    'orientacao_salao', recado,
    'assistente', ass,
    'numero_proprio', proprio,
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city, 'endereco', s.address, 'tipo', s.tipo,
                                'app', rtrim(coalesce(s.app_url, public.app_base()), '/'),
                                'horario', public.salao_horario_texto(salao), 'aberto_agora', aberto),
    'agora', jsonb_build_object('data', to_char(sp, 'YYYY-MM-DD'), 'hora', to_char(sp, 'HH24:MI'),
                                'dia_semana', dias[extract(dow from sp)::int + 1], 'texto', to_char(sp, 'DD/MM/YYYY HH24:MI')),
    'cliente', cliente,
    'proximos', coalesce(proximos, '[]'::jsonb),
    'historico', coalesce(historico, '[]'::jsonb),
    'gastas_hoje', gastas);
end;
$function$;
