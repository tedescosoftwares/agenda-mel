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
