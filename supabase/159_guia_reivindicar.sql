-- 159: "É o seu salão?" vira uma reivindicação simples (3.12).
--
-- Decisão do dono do produto: por enquanto, a reivindicação só gera um
-- aviso para a equipe na Plataforma e uma confirmação por e-mail para
-- quem reivindicou. Sem código por WhatsApp, sem painel do dono.
--
-- Reaproveita o que a 153 já tinha:
--   - guia_interesses (tipo 'sou_dono') guarda o pedido, agora com o
--     e-mail (obrigatório), a ligação com o salão (dona, sócia, gerente,
--     funcionária), o aceite de que a pessoa responde pelo salão e um
--     status que a equipe muda: nova, em contato, confirmada, recusada;
--   - guia_registrar_interesse() continua sendo a única porta do público.
--     Os outros pedidos (quero marcar, corrigir, remover) seguem iguais;
--     todos ganham o campo-armadilha contra robô (preenchido = finge que
--     deu certo e não grava nada).
--
-- O aviso na Plataforma é o que já existia: a linha nova entra sem
-- atendimento, então aparece no número "interesses novos" do topo do Guia
-- e na aba Interesses; e a reivindicação entra também na "Atividade
-- recente" da Visão Geral (plataforma_atividade).
-- A confirmação vai pela fila de e-mail (email_outbox, 054), com a moldura
-- de sempre (email_layout, 058); o relógio (mimo-emails) e a função
-- enviar-email mandam pelo Resend, sem segredo novo.
--
-- Proteções: e-mail validado; o mesmo e-mail no mesmo salão conta uma vez
-- por dia (sem e-mail repetido); um e-mail reivindica no máximo 3 vezes
-- por dia (contando pela caixa: sem "+apelido" e, no Gmail, sem pontos);
-- um salão recebe no máximo 10 reivindicações por dia; uma rede (código do
-- dia do IP, ou do /64 no IPv6, que não identifica ninguém e não junta com
-- as métricas da 156) no máximo 5; e 300 por dia no total. O nome só entra
-- na saudação do e-mail quando parece um nome (um link ali viraria link
-- clicável num e-mail assinado pela MIMO). O público nunca lê
-- guia_interesses nem email_outbox (RLS); a função só devolve ok/motivo,
-- nunca o e-mail.
-- Idempotente.

-- ---- os dados novos do pedido ------------------------------------------------------------
alter table public.guia_interesses add column if not exists email text;
alter table public.guia_interesses add column if not exists ligacao text;
alter table public.guia_interesses add column if not exists aceite_em timestamptz;
alter table public.guia_interesses add column if not exists status text;
alter table public.guia_interesses add column if not exists status_em timestamptz;
alter table public.guia_interesses add column if not exists status_por uuid references auth.users (id) on delete set null;
alter table public.guia_interesses add column if not exists email_id uuid references public.email_outbox (id) on delete set null;
alter table public.guia_interesses add column if not exists rede text;   -- código do dia só do IP; só serve para o limite do dia

comment on column public.guia_interesses.email is 'Reivindicação (159): e-mail de quem pediu. Só a Plataforma vê; nunca vai para o site.';
comment on column public.guia_interesses.ligacao is 'Reivindicação (159): dona, socia, gerente ou funcionaria.';
comment on column public.guia_interesses.aceite_em is 'Reivindicação (159): quando a pessoa declarou que responde pelo salão.';
comment on column public.guia_interesses.status is 'Reivindicação (159): nova, em_contato, confirmada, recusada. A equipe muda na aba Interesses.';
comment on column public.guia_interesses.email_id is 'Reivindicação (159): o e-mail de confirmação na fila (email_outbox).';
comment on column public.guia_interesses.rede is 'Código do dia do IP (sal do dia, 156); não identifica ninguém e não junta com site_eventos.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'guia_interesses_ligacao_ok') then
    alter table public.guia_interesses add constraint guia_interesses_ligacao_ok
      check (ligacao is null or ligacao in ('dona', 'socia', 'gerente', 'funcionaria'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guia_interesses_status_ok') then
    alter table public.guia_interesses add constraint guia_interesses_status_ok
      check (status is null or status in ('nova', 'em_contato', 'confirmada', 'recusada'));
  end if;
end $$;

-- as reivindicações de antes (só nome e WhatsApp): abertas viram nova; atendidas, em contato
update public.guia_interesses set status = case when atendido_em is null then 'nova' else 'em_contato' end
 where tipo = 'sou_dono' and status is null;

create index if not exists guia_interesses_email on public.guia_interesses (email, criado_em) where email is not null;
create index if not exists guia_interesses_tipo on public.guia_interesses (tipo, criado_em);
create index if not exists guia_interesses_rede on public.guia_interesses (rede, criado_em) where rede is not null;

-- quem mexe continua sendo só a Plataforma (as policies e grants da 153 valem para as colunas novas)
alter table public.guia_interesses enable row level security;
revoke all on public.guia_interesses from anon;

-- ---- status e "atendido" andam juntos ------------------------------------------------------
-- "interesses novos" (topo do Guia) conta o que está sem atendido_em. Para a reivindicação:
-- nova = ninguém pegou ainda; em contato, confirmada ou recusada = alguém pegou.
-- A tela manda os dois campos já certos; o gatilho garante para quem mexer por fora
-- (e para o "Marcar atendido"/"Reabrir" da tela antiga, que só mexe em atendido_em).
create or replace function public.guia_interesses_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_em := now();
    new.status_por := auth.uid();
    if new.status = 'nova' then
      new.atendido_em := null; new.atendido_por := null;
    elsif new.status is not null then
      new.atendido_em := coalesce(new.atendido_em, now());
      new.atendido_por := coalesce(new.atendido_por, auth.uid());
    end if;
  elsif new.status is not null and new.atendido_em is distinct from old.atendido_em then
    if new.atendido_em is null then new.status := 'nova';
    elsif new.status = 'nova' then new.status := 'em_contato';
    end if;
    if new.status is distinct from old.status then new.status_em := now(); new.status_por := auth.uid(); end if;
  end if;
  return new;
end $$;
revoke execute on function public.guia_interesses_status() from public, anon, authenticated;
drop trigger if exists guia_interesses_status on public.guia_interesses;
create trigger guia_interesses_status before update on public.guia_interesses
  for each row execute function public.guia_interesses_status();

-- ---- a ligação, como se escreve ----------------------------------------------------------
create or replace function public.guia_ligacao_rotulo(l text)
returns text language sql immutable as $$
  select case l when 'dona' then 'dona' when 'socia' then 'sócia' when 'gerente' then 'gerente' when 'funcionaria' then 'funcionária' end
$$;

-- a caixa de um e-mail, para os limites: sem o "+apelido" e, no Gmail, sem os pontos
-- (fulana+1@gmail.com e f.ulana@gmail.com caem na mesma caixa que fulana@gmail.com)
create or replace function public.guia_chave_email(x text)
returns text language sql immutable set search_path = public as $$
  select case when split_part(r, '@', 2) in ('gmail.com', 'googlemail.com') then replace(split_part(r, '@', 1), '.', '') || '@gmail.com' else r end
    from (select regexp_replace(lower(btrim(x)), '\+[^@]*@', '@') as r) s
$$;
revoke execute on function public.guia_chave_email(text) from public, anon, authenticated;

-- ---- o e-mail de confirmação --------------------------------------------------------------
-- Simples e honesto: recebemos, em quantos dias úteis a gente fala com você, o que acontece
-- depois e como pedir para corrigir ou remover a página. prazo: dias úteis (a tela mostra o
-- mesmo número, que a função guia_registrar_interesse devolve).
create or replace function public.email_reivindicacao(nome text, salao text, ligacao text, link text, prazo integer)
returns table (assunto text, html text, texto text)
language plpgsql immutable as $$
declare
  -- a primeira palavra do nome, só se parecer um nome (um link digitado no nome não abre o e-mail da MIMO)
  primeiro text := (select p from (select nullif(split_part(btrim(coalesce(nome, '')), ' ', 1), '') as p) x where p ~ '^[[:alpha:]''-]{2,30}$');
  s text := coalesce(nullif(btrim(salao), ''), 'o salão');
  lig text := public.guia_ligacao_rotulo(ligacao);
  dias text := prazo || case when prazo = 1 then ' dia útil' else ' dias úteis' end;
  p1 text; passos text[]; p3 text; rodape text;
  par text := '<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#3d3d44">';
begin
  assunto := 'Recebemos seu pedido sobre ' || s;
  p1 := 'Recebemos o seu pedido sobre a página de ' || s || ' no guia de salões da MIMO'
        || coalesce(': você nos contou que é ' || lig || ' do salão e responde por ele', '') || '.';
  passos := array[
    'Em até ' || dias || ', alguém da equipe da MIMO fala com você, por este e-mail ou pelo WhatsApp, se você deixou, para confirmar que você responde pelo salão.',
    'Confirmado, a gente anota você como responsável pela página. Daí em diante, o que você pedir sobre ela (corrigir horário, telefone, serviços ou tirar do ar) é atendido sem precisar provar de novo.',
    'Enquanto isso, a página continua no ar do jeito que está. Nada muda nela sem a gente falar com você.'];
  p3 := 'Viu algum dado errado ou prefere tirar a página do ar? É só responder este e-mail ou escrever para contato@mimo.com.vc contando o que mudou. No fim da própria página também dá para pedir a correção ou a remoção.';
  rodape := 'Você recebe este e-mail porque alguém usou este endereço no "É o seu salão?" da página de ' || s
            || ' no guia da MIMO. Se não foi você, pode ignorar este e-mail: nada muda na página.';

  texto := coalesce(primeiro || E',\n\n', '') || p1
           || E'\n\nO que acontece agora:\n1. ' || passos[1] || E'\n2. ' || passos[2] || E'\n3. ' || passos[3]
           || E'\n\n' || p3
           || coalesce(E'\n\nA página: ' || link, '')
           || E'\n\n' || rodape
           || E'\n\nMIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:17px;font-weight:700;margin:0 0 10px">Recebemos seu pedido</p>'
    || par || public.escapar_html(p1) || '</p>'
    || '<p style="font-size:15px;font-weight:700;margin:18px 0 8px;color:#1f2026">O que acontece agora</p>'
    || '<ol style="font-size:15px;line-height:1.55;margin:0 0 18px;padding-left:20px;color:#3d3d44">'
    || '<li style="margin-bottom:8px">' || public.escapar_html(passos[1]) || '</li>'
    || '<li style="margin-bottom:8px">' || public.escapar_html(passos[2]) || '</li>'
    || '<li>' || public.escapar_html(passos[3]) || '</li></ol>'
    || par || public.escapar_html(p3) || '</p>'
    || '<div style="height:10px"></div>',
    case when link is not null then 'Ver a página de ' || public.escapar_html(s) end,
    public.escapar_html(link),
    public.escapar_html(rodape));
  return next;
end $$;
revoke execute on function public.email_reivindicacao(text, text, text, text, integer) from public, anon, authenticated;

-- ---- a porta do público -------------------------------------------------------------------
-- A assinatura cresceu (e-mail, ligação, aceite, armadilha): a de 5 parâmetros sai para o
-- PostgREST não ficar com duas candidatas. Quem chama com os 5 de antes continua funcionando.
drop function if exists public.guia_registrar_interesse(uuid, text, text, text, text);

create or replace function public.guia_registrar_interesse(
  lugar_ uuid,
  tipo_ text,
  nome_ text default null,
  contato_ text default null,
  mensagem_ text default null,
  email_ text default null,
  ligacao_ text default null,
  aceite_ boolean default false,
  armadilha_ text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n text := nullif(left(btrim(coalesce(nome_, '')), 80), '');
  k text := nullif(left(btrim(coalesce(contato_, '')), 120), '');
  m text := nullif(left(btrim(coalesce(mensagem_, '')), 600), '');
  e text := nullif(lower(btrim(coalesce(email_, ''))), '');
  lig text := nullif(lower(btrim(coalesce(ligacao_, ''))), '');
  prazo integer := 3;                     -- dias úteis para a equipe falar com quem reivindicou
  l public.guia_lugares;
  cab jsonb;
  ip text;
  rede_ text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  sal_ text;
  novo uuid;
  correio record;
  correio_id uuid;
begin
  -- campo-armadilha: gente não vê, robô preenche. Finge que deu certo e não grava nada.
  if nullif(btrim(coalesce(armadilha_, '')), '') is not null then
    return jsonb_build_object('ok', true);
  end if;
  if tipo_ is null or tipo_ not in ('quero_marcar', 'sou_dono', 'corrigir', 'remover') then
    return jsonb_build_object('ok', false, 'motivo', 'pedido desconhecido');
  end if;
  select * into l from public.guia_lugares where id = lugar_ and status = 'publicado';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'página não encontrada');
  end if;

  -- ---- os outros pedidos: como na 153 ----
  if tipo_ <> 'sou_dono' then
    if tipo_ <> 'quero_marcar' and k is null then
      return jsonb_build_object('ok', false, 'motivo', 'deixe um WhatsApp ou e-mail para a gente responder');
    end if;
    -- freio para robô: o mesmo contato no mesmo pedido, 3 por dia; a mesma página, 200 por dia
    if k is not null and (select count(*) from public.guia_interesses where lugar_id = lugar_ and tipo = tipo_ and contato = k and criado_em > now() - interval '1 day') >= 3 then
      return jsonb_build_object('ok', true, 'repetido', true);
    end if;
    if (select count(*) from public.guia_interesses where lugar_id = lugar_ and criado_em > now() - interval '1 day') >= 200 then
      return jsonb_build_object('ok', false, 'motivo', 'muitos pedidos hoje; tente amanhã');
    end if;
    insert into public.guia_interesses (lugar_id, tipo, nome, contato, mensagem) values (lugar_, tipo_, n, k, m);
    return jsonb_build_object('ok', true);
  end if;

  -- ---- a reivindicação ----
  if n is null or length(n) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'conte seu nome para a gente saber com quem falar');
  end if;
  if e is null or length(e) > 120 or e !~ '^[a-z0-9._%+''-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'motivo', 'confira o e-mail: é por ele que a confirmação chega');
  end if;
  if k is not null and length(regexp_replace(k, '\D', '', 'g')) not between 10 and 13 then
    return jsonb_build_object('ok', false, 'motivo', 'confira o WhatsApp: DDD e número, como (13) 99999-9999');
  end if;
  if lig is null or lig not in ('dona', 'socia', 'gerente', 'funcionaria') then
    return jsonb_build_object('ok', false, 'motivo', 'conte qual é a sua ligação com o salão');
  end if;
  if not coalesce(aceite_, false) then
    return jsonb_build_object('ok', false, 'motivo', 'confirme que você responde pelo salão');
  end if;

  -- o mesmo e-mail no mesmo salão em 24 h conta uma vez (e não manda outro e-mail); a conta é
  -- pela caixa (guia_chave_email), para o "+apelido" não furar o limite
  if exists (select 1 from public.guia_interesses where lugar_id = lugar_ and tipo = 'sou_dono' and public.guia_chave_email(email) = public.guia_chave_email(e) and criado_em > now() - interval '1 day') then
    return jsonb_build_object('ok', true, 'repetido', true, 'prazo', prazo);
  end if;
  if (select count(*) from public.guia_interesses where tipo = 'sou_dono' and public.guia_chave_email(email) = public.guia_chave_email(e) and criado_em > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos pedidos com este e-mail hoje; tente amanhã ou escreva para contato@mimo.com.vc');
  end if;
  if (select count(*) from public.guia_interesses where lugar_id = lugar_ and tipo = 'sou_dono' and criado_em > now() - interval '1 day') >= 10
     or (select count(*) from public.guia_interesses where lugar_id = lugar_ and criado_em > now() - interval '1 day') >= 200
     or (select count(*) from public.guia_interesses where tipo = 'sou_dono' and criado_em > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos pedidos hoje; tente amanhã ou escreva para contato@mimo.com.vc');
  end if;

  -- a rede: o IP com o sal do dia (156) e um rótulo próprio, para não bater com site_eventos.rede
  begin
    begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
    ip := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''));
    if ip is not null then
      insert into public.site_sal (dia) values (hoje) on conflict (dia) do nothing;
      if found then delete from public.site_sal where dia < hoje; end if;
      select sal into sal_ from public.site_sal where dia = hoje;
      rede_ := left(encode(sha256(convert_to(coalesce(sal_, '') || '|reivindicar|' || public.rede_do_ip(ip), 'UTF8')), 'hex'), 16);
    end if;
  exception when others then rede_ := null;
  end;
  if rede_ is not null and (select count(*) from public.guia_interesses where rede = rede_ and tipo = 'sou_dono' and criado_em > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'motivo', 'muitos pedidos hoje; tente amanhã ou escreva para contato@mimo.com.vc');
  end if;

  insert into public.guia_interesses (lugar_id, tipo, nome, contato, mensagem, email, ligacao, aceite_em, status, rede)
  values (lugar_, 'sou_dono', n, k, m, e, lig, now(), 'nova', rede_)
  returning id into novo;

  -- a confirmação na fila; se der errado, o pedido fica (a equipe vê que a confirmação não saiu)
  begin
    select * into correio from public.email_reivindicacao(n, l.nome, lig,
      public.app_base() || '/saloes/' || l.cidade_slug || '/' || l.slug, prazo);
    -- sem o nome no destinatário: é texto livre de quem preencheu
    correio_id := public.enfileirar_email(e, correio.assunto, correio.html, 'guia_reivindicacao', correio.texto, null, null);
    if correio_id is not null then
      update public.guia_interesses set email_id = correio_id where id = novo;
    end if;
  exception when others then
    raise notice 'confirmação da reivindicação % não enfileirada: %', novo, sqlerrm;
  end;
  begin perform public.chutar_agora(); exception when others then null; end;

  return jsonb_build_object('ok', true, 'prazo', prazo);
end $$;
revoke execute on function public.guia_registrar_interesse(uuid, text, text, text, text, text, text, boolean, text) from public;
grant execute on function public.guia_registrar_interesse(uuid, text, text, text, text, text, text, boolean, text) to anon, authenticated;
comment on function public.guia_registrar_interesse(uuid, text, text, text, text, text, text, boolean, text) is
  'Guia (153, 159): os pedidos das páginas. sou_dono = reivindicação: nome, e-mail, ligação e aceite; manda a confirmação por e-mail. Devolve só ok/repetido/motivo/prazo.';

-- ---- a Plataforma: como está a confirmação de cada reivindicação --------------------------
-- { "<id do pedido>": { status, enviado_em, erro } }; a equipe vê se o e-mail saiu ou voltou.
create or replace function public.guia_confirmacoes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(i.id, jsonb_build_object('status', e.status, 'enviado_em', e.enviado_em, 'erro', left(e.erro, 200))), '{}'::jsonb)
    from public.guia_interesses i join public.email_outbox e on e.id = i.email_id
   where public.eh_plataforma() and i.tipo = 'sou_dono'
$$;
revoke execute on function public.guia_confirmacoes() from public, anon;
grant execute on function public.guia_confirmacoes() to authenticated;

-- ---- a Visão Geral: a reivindicação entra na "Atividade recente" --------------------------
-- a mesma função da 056, com uma linha a mais (sem e-mail nem telefone; só a Plataforma lê)
create or replace function public.plataforma_atividade(quantas integer default 20)
returns table (tipo text, titulo text, detalhe text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select * from (
    select 'salao'::text as tipo,
           ('Novo ' || case when s.tipo = 'autonoma' then 'agenda autônoma' else 'salão' end)::text as titulo,
           (s.name || case when s.city is not null then ' · ' || s.city else '' end)::text as detalhe,
           s.created_at as quando
    from public.salons s
    union all
    select 'profissional', 'Profissional criada', p.name || ' · ' || (select name from public.salons where id = p.salon_id), p.created_at
    from public.professionals p
    union all
    select 'cliente', 'Nova conta', coalesce(pf.full_name, 'sem nome') || ' · ' || pf.role, pf.created_at
    from public.profiles pf
    union all
    select 'vinculo', 'Cliente entrou na agenda',
           coalesce((select full_name from public.profiles where id = v.client_id), 'cliente') || ' → '
           || (select name from public.salons where id = v.salon_id) || ' · por ' || v.como, v.criado_em
    from public.vinculos v
    union all
    select 'atendimento', 'Atendimento concluído',
           coalesce(a.service_name, (select name from public.services where id = a.service_id), 'serviço') || ' · '
           || coalesce((select full_name from public.profiles where id = a.client_id), a.guest_name, 'cliente')
           || ' com ' || (select name from public.professionals where id = a.professional_id),
           (a.date + a.end_time) at time zone 'America/Sao_Paulo'
    from public.appointments a where a.status = 'concluido' and a.date >= (public.agora_local())::date - 30
    union all
    select 'salao', 'Reivindicação no guia',
           gl.nome || ' · ' || coalesce(gi.nome, 'sem nome') || coalesce(' (' || public.guia_ligacao_rotulo(gi.ligacao) || ')', ''),
           gi.criado_em
    from public.guia_interesses gi join public.guia_lugares gl on gl.id = gi.lugar_id
    where gi.tipo = 'sou_dono'
  ) x
  where public.eh_plataforma()
  order by quando desc
  limit greatest(1, least(coalesce(quantas, 20), 100));
$$;
revoke execute on function public.plataforma_atividade(integer) from public, anon;
grant execute on function public.plataforma_atividade(integer) to authenticated;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from public.guia_interesses where tipo = 'sou_dono';
  raise notice '159: reivindicação pronta (e-mail de confirmação na fila, aviso no Guia e na Visão Geral); % reivindicações no banco', n;
end $$;
