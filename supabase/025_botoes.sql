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
