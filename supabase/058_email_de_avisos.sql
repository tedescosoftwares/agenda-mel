-- 058 · Os avisos também chegam por e-mail
--
-- Com o domínio próprio (mimo.com.vc) o Resend deixa de ser só o
-- e-mail de boas-vindas. Cada aviso que o app cria (notificar) e que a
-- tabela email_regras marca como "vai por e-mail" entra na fila de
-- e-mail com o mesmo visual do boas-vindas — se a pessoa tiver e-mail
-- e não tiver desligado em Perfil › Preferências.
--
--   profiles.aceita_email       o switch "Avisos por e-mail"
--   email_regras                que tipo de aviso vai por e-mail
--   app_base()                  o endereço do app para os links
--                               (config_publica 'app_url' > salão > mimo.com.vc)
--   email_layout()              a moldura de todo e-mail do MIMO
--   email_aviso()               assunto, html e texto de um aviso
--   email_boas_vindas()         agora usa a mesma moldura
--   notificar()                 app + WhatsApp + e-mail
--
-- Depois de rodar, aponte o app:
--   select public.definir_config_publica('app_url', 'https://mimo.com.vc');

-- 1. O switch ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists aceita_email boolean not null default true;

grant update (full_name, phone, accepts_reminders, aceita_email) on public.profiles to authenticated;

-- 2. Que aviso vai por e-mail ----------------------------------------------------------
create table if not exists public.email_regras (
  kind text primary key,
  envia boolean not null default true,
  -- botão do e-mail; null usa "Abrir o MIMO"
  chamada text
);

alter table public.email_regras enable row level security;
revoke all on public.email_regras from anon, authenticated;

insert into public.email_regras (kind, envia, chamada) values
  ('agendamento_confirmado', true,  'Ver meu horário'),
  ('agendamento_cancelado',  true,  'Marcar outro horário'),
  ('lembrete_agendamento',   true,  'Ver meu horário'),
  ('remarcacao_aceita',      true,  'Ver meu horário'),
  ('remarcacao_recusada',    true,  'Escolher outro horário'),
  ('profissional_cancelou',  true,  'Marcar outro horário'),
  ('vaga_disponivel',        true,  'Pegar essa vaga'),
  ('agenda_adiantada',       true,  'Responder no app'),
  ('novo_agendamento',       true,  'Abrir a agenda'),
  ('pedido_de_aceite',       true,  'Responder o pedido'),
  ('pedido_pelo_whatsapp',   true,  'Responder o pedido'),
  ('indicacao_creditada',    true,  'Ver meus créditos'),
  -- estes ficam só no app e no WhatsApp
  ('pos_atendimento',        false, null),
  ('convite_retorno',        false, null),
  ('resposta_do_bot',        false, null),
  ('afiliado_novo',          false, null),
  ('afiliado_cashback',      false, null)
on conflict (kind) do nothing;

-- 3. O endereço do app --------------------------------------------------------------------
create or replace function public.app_base()
returns text
language sql
stable
security definer set search_path = public
as $$
  select rtrim(coalesce(
    nullif((select c.valor from public.config_publica c where c.chave = 'app_url'), ''),
    (select s.app_url from public.salons s where s.app_url is not null order by s.created_at limit 1),
    'https://mimo.com.vc'), '/');
$$;

revoke execute on function public.app_base() from public, anon, authenticated;

-- 4. A moldura --------------------------------------------------------------------------
create or replace function public.email_layout(primeiro text, corpo_html text, chamada text, link text, rodape text)
returns text
language sql
immutable
as $$
  select
    '<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f2f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2026">'
    || '<div style="max-width:520px;margin:0 auto;padding:32px 20px">'
    || '<div style="background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 8px 30px rgba(61,12,78,.08)">'
    || '<div style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:#aa4cff;margin-bottom:6px">mimo</div>'
    || '<div style="font-size:13px;color:#ff2d7a;margin-bottom:22px">beleza na palma da mão</div>'
    || case when primeiro is not null then '<p style="font-size:18px;margin:0 0 12px"><strong>' || primeiro || ',</strong></p>' else '' end
    || corpo_html
    || case when chamada is not null and link is not null then
         '<a href="' || link || '" style="display:inline-block;background:linear-gradient(90deg,#ff2d7a,#ff7baa);color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:14px">' || chamada || '</a>'
       else '' end
    || case when rodape is not null then '<p style="font-size:12px;color:#8a8a94;margin:28px 0 0">' || rodape || '</p>' else '' end
    || '</div>'
    || '<p style="font-size:11px;color:#a5a5ad;text-align:center;margin:18px 0 0">MIMO · beleza na palma da mão</p>'
    || '</div></body></html>';
$$;

create or replace function public.escapar_html(t text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

-- 5. Um aviso vira e-mail ------------------------------------------------------------
create or replace function public.email_aviso(nome text, titulo text, corpo text, chamada text, link text)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare
  primeiro text := nullif(split_part(coalesce(nome, ''), ' ', 1), '');
  corpo_ text := nullif(btrim(coalesce(corpo, '')), '');
  chamada_ text := coalesce(chamada, 'Abrir o MIMO');
  rodape text := 'Você recebe este e-mail porque tem uma conta no MIMO. Para parar, desligue "Avisos por e-mail" em Perfil › Preferências.';
begin
  assunto := titulo;
  texto := coalesce(primeiro || ', ' || E'\n\n', '')
           || titulo
           || coalesce(E'\n\n' || corpo_, '')
           || E'\n\n' || chamada_ || ': ' || link
           || E'\n\n' || 'MIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:17px;font-weight:700;margin:0 0 10px">' || public.escapar_html(titulo) || '</p>'
    || case when corpo_ is not null then
         '<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#3d3d44">' || replace(public.escapar_html(corpo_), E'\n', '<br>') || '</p>'
       else '<div style="height:14px"></div>' end,
    public.escapar_html(chamada_), link, rodape);
  return next;
end;
$$;

-- 6. Boas-vindas na mesma moldura ---------------------------------------------------
create or replace function public.email_boas_vindas(nome text, quem_convidou text, papel text, link text)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare
  primeiro text := coalesce(nullif(split_part(coalesce(nome, ''), ' ', 1), ''), 'Oi');
  corpo text;
  chamada text;
  assunto_ text;
begin
  if papel in ('autonoma', 'salao') then
    assunto_ := 'Sua agenda no MIMO está pronta 💛';
    corpo := 'Sua conta está aberta. O próximo passo é cadastrar seus serviços e horários — leva poucos minutos — e depois compartilhar seu código com as clientes: elas entram na sua agenda e passam a marcar sozinhas pelo app.';
    chamada := 'Abrir minha agenda';
  elsif quem_convidou is not null then
    assunto_ := 'Você entrou na agenda de ' || quem_convidou || ' 💛';
    corpo := quem_convidou || ' te convidou para o MIMO e você já está na agenda. Abra o app para ver os horários livres e marcar quando quiser. A confirmação chega no seu WhatsApp e aqui no e-mail.';
    chamada := 'Ver horários';
  else
    assunto_ := 'Bem-vinda ao MIMO 💛';
    corpo := 'Sua conta está criada. Para ver horários e marcar, entre na agenda da sua profissional: peça o QR ou o código dela e escaneie pelo app.';
    chamada := 'Abrir o MIMO';
  end if;

  assunto := assunto_;
  texto := primeiro || ', ' || E'\n\n' || corpo || E'\n\n' || chamada || ': ' || link
           || E'\n\n' || 'MIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#3d3d44">' || public.escapar_html(corpo) || '</p>',
    chamada, link,
    'Se não foi você quem criou esta conta, é só ignorar este e-mail.');
  return next;
end;
$$;

-- 7. notificar(): app + WhatsApp + e-mail ----------------------------------------------
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
  regra record;
  pessoa record;
  e record;
  link text;
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

  -- e-mail: só os tipos marcados, só quem tem e-mail e não desligou
  begin
    select * into regra from public.email_regras r where r.kind = tipo and r.envia;
    if found then
      select u.email, p.full_name, p.aceita_email
        into pessoa
        from auth.users u
        join public.profiles p on p.id = u.id
       where u.id = destinatario;
      if found and pessoa.email is not null and pessoa.aceita_email then
        link := public.app_base() || case when url is null or url = '' then '/' when left(url, 1) = '/' then url else '/' || url end;
        select * into e from public.email_aviso(pessoa.full_name, titulo, texto, regra.chamada, link);
        perform public.enfileirar_email(pessoa.email, e.assunto, e.html, tipo, e.texto, pessoa.full_name, destinatario);
      end if;
    end if;
  exception when others then
    null;
  end;

  return novo_id;
end;
$$;

revoke execute on function
  public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
