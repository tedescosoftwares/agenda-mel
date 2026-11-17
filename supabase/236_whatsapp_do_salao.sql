-- 236 · O WhatsApp é o do salão; o da MIMO é só reserva (3.95.1)
--
-- A 235 deixava todo salão no número da casa (o da MIMO) e a assistente atendendo por ele. Errado: assim todos os
-- salões usariam o nosso WhatsApp. A regra agora:
--
--   • O canal do salão é o WhatsApp DELE (numero_proprio). Sem número próprio, o canal é o manual: nada sai sozinho
--     pelo nosso número (os avisos seguem no app; a fila fica para quem quiser mandar na mão).
--   • A assistente só atende quem conectou o próprio número (bot_contexto: 'sem_numero_proprio'); ligar sem número
--     é recusado (assistente_salvar). O teste da dona funciona antes, para ela já ver como fica.
--   • O número da MIMO é só a RESERVA de envio: o salão que tem número próprio e, numa hora, não consegue mandar
--     por ele (celular sem internet, desconectado) tem o aviso mandado pelo nosso, até reconectar. puxar_da_fila
--     devolve a instância de reserva e a função enviar-whatsapp tenta por ela quando a do salão falha.
--   • Salão novo nasce no canal manual (como antes da 235); desconectar o número volta para o manual.
--   • A instância da casa vem da config (whatsapp_instancia_casa), gravada aqui com a que os salões usavam.

-- 1. A instância de reserva: a da config; grava a que estava em uso, antes de tirar os salões dela
do $$
declare casa text;
begin
  if nullif(btrim(coalesce((select valor from public.config_publica where chave = 'whatsapp_instancia_casa'), '')), '') is null then
    select c.identificador into casa from public.whatsapp_channels c
     where c.canal = 'evolution' and not c.numero_proprio and c.identificador is not null
     group by c.identificador order by count(*) desc, c.identificador limit 1;
    if casa is not null then
      insert into public.config_publica (chave, valor) values ('whatsapp_instancia_casa', casa)
      on conflict (chave) do update set valor = excluded.valor;
    end if;
  end if;
end $$;

create or replace function public.instancia_da_casa()
returns text
language sql
stable
security definer set search_path = public
as $$
  select nullif(btrim((select valor from public.config_publica where chave = 'whatsapp_instancia_casa')), '');
$$;
revoke execute on function public.instancia_da_casa() from public, anon, authenticated;

-- 2. Quem não tem número próprio sai do número da MIMO (e o que esperava na fila dele fica para mandar na mão)
update public.whatsapp_channels
   set canal = 'manual', identificador = null, numero_exibicao = null
 where not numero_proprio and canal = 'evolution';
update public.message_outbox o
   set canal = 'manual'
  from public.whatsapp_channels c
 where c.salon_id = o.salon_id and c.canal = 'manual' and o.status = 'na_fila' and o.canal = 'evolution';

-- 3. Salão novo nasce no manual (o canal só vira automático quando ele conecta o WhatsApp dele)
create or replace function public.abre_canal_do_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.whatsapp_channels (salon_id) values (new.id) on conflict (salon_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.abre_canal_do_salao() from public, anon, authenticated;

-- 4. Desconectar o número: volta para o manual e a assistente desliga
create or replace function public.assistente_numero_desligado(salao uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.whatsapp_channels
     set numero_proprio = false, conectado_em = null, canal = 'manual', identificador = null, numero_exibicao = null, usa_ia = false
   where salon_id = salao;
  delete from public.assistente_esperas where salon_id = salao;
end;
$$;
revoke execute on function public.assistente_numero_desligado(uuid) from public, anon, authenticated;

-- 5. Ligar a assistente só com o número do salão conectado
create or replace function public.assistente_salvar(salao uuid, dados jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare d jsonb := coalesce(dados, '{}'::jsonb);
begin
  if not public.is_admin_do_salao(salao) then raise exception 'só quem administra o salão mexe na assistente'; end if;
  if coalesce((d ->> 'ligada')::boolean, false)
     and not exists (select 1 from public.whatsapp_channels c where c.salon_id = salao and c.numero_proprio) then
    raise exception 'conecte o WhatsApp do salão antes de ligar a assistente';
  end if;
  insert into public.assistentes (salon_id) values (salao) on conflict (salon_id) do nothing;
  update public.assistentes a set
    nome = case when d ? 'nome' then coalesce(nullif(left(btrim(coalesce(d ->> 'nome', '')), 30), ''), 'Mel') else a.nome end,
    tom = case when d ? 'tom' then d ->> 'tom' else a.tom end,
    emojis = case when d ? 'emojis' then d ->> 'emojis' else a.emojis end,
    tratamento = case when d ? 'tratamento' then d ->> 'tratamento' else a.tratamento end,
    tamanho = case when d ? 'tamanho' then d ->> 'tamanho' else a.tamanho end,
    preco = case when d ? 'preco' then d ->> 'preco' else a.preco end,
    pode_marcar = case when d ? 'pode_marcar' then coalesce((d ->> 'pode_marcar')::boolean, true) else a.pode_marcar end,
    pode_remarcar = case when d ? 'pode_remarcar' then coalesce((d ->> 'pode_remarcar')::boolean, true) else a.pode_remarcar end,
    pode_cancelar = case when d ? 'pode_cancelar' then coalesce((d ->> 'pode_cancelar')::boolean, true) else a.pode_cancelar end,
    quando = case when d ? 'quando' then d ->> 'quando' else a.quando end,
    espera_min = case when d ? 'espera_min' then (d ->> 'espera_min')::int else a.espera_min end,
    saudacao = case when d ? 'saudacao' then nullif(left(btrim(coalesce(d ->> 'saudacao', '')), 300), '') else a.saudacao end,
    atualizado_em = now()
  where a.salon_id = salao;
  if d ? 'recado' or d ? 'ligada' then
    insert into public.whatsapp_channels (salon_id) values (salao) on conflict (salon_id) do nothing;
    update public.whatsapp_channels set
      orientacao_ia = case when d ? 'recado' then nullif(left(btrim(coalesce(d ->> 'recado', '')), 1200), '') else orientacao_ia end,
      usa_ia = case when d ? 'ligada' then coalesce((d ->> 'ligada')::boolean, usa_ia) else usa_ia end
    where salon_id = salao;
  end if;
  return public.assistente_do_salao(salao);
end;
$$;
revoke execute on function public.assistente_salvar(uuid, jsonb) from public, anon;
grant execute on function public.assistente_salvar(uuid, jsonb) to authenticated;

-- 6. A fila devolve a instância de reserva de quem tem número próprio (a função tenta por ela se a do salão falhar)
drop function if exists public.puxar_da_fila(integer);
create function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb,
  estilo_botao text,
  reserva text
)
language plpgsql
security definer set search_path = public
as $$
begin
  -- primeiro, resgatar o que ficou para trás de uma execução que morreu (045)
  update public.message_outbox
  set status = 'na_fila',
      erro = coalesce(erro, 'envio interrompido; devolvido para a fila')
  where status = 'enviando'
    and criado_em < now() - interval '10 minutes';

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
         c.estilo_botao,
         case when c.numero_proprio and c.canal = 'evolution' and public.instancia_da_casa() is distinct from c.identificador
              then public.instancia_da_casa() end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;
revoke execute on function public.puxar_da_fila(integer) from public, anon, authenticated;

-- 7. O contexto do agente: só com o número do salão (o resto igual à 235)
create or replace function public.bot_contexto(salao uuid, tel text, instancia text default null, sem_espera boolean default false, rascunho jsonb default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
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
    gastas := coalesce(public.ia_gastas_hoje(salao), 0);
    if gastas >= coalesce(canal.teto_ia_diario, 200) then
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
        union all
        select 'mimo', o.corpo, coalesce(o.enviado_em, o.liberado_em) from public.message_outbox o
         where public.telefone_chave(o.telefone) = public.telefone_chave(e164) and o.status in ('enviado','entregue','lido')
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
$$;
revoke execute on function public.bot_contexto(uuid, text, text, boolean, jsonb) from public, anon, authenticated;
