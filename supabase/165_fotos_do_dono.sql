-- 165: o dono manda as fotos (3.15).
--
-- Quando a equipe confirma uma reivindicação ("Sim, sou responsável", 159)
-- na aba Interesses, a pessoa recebe um segundo e-mail: "Confirmado. Quer
-- mandar as fotos?", com um link só dela
--   <app>/saloes/<cidade>/<salão>/fotos/<token>
-- que vale 30 dias. Na página do link ela escolhe até 8 fotos, declara que
-- são do salão (dela, da equipe, ou com autorização de quem fotografou) e
-- envia. As fotos entram na página na hora, pelo mesmo bucket 'guia' e o
-- mesmo campo fotos do Editar → Fotos (164); a primeira vira a capa.
--
-- O que muda:
--   - guia_interesses: token_fotos (32 hex, único), token_fotos_expira,
--     fotos_enviadas, fotos_enviadas_em, email_fotos_id;
--   - um gatilho: status vira 'confirmada' (com e-mail) → token + e-mail na fila;
--   - guia_link_fotos(interesse, renovar): a Plataforma copia o link para
--     mandar pelo WhatsApp, ou renova um vencido;
--   - guia_fotos_dono(token): o que a página do link precisa saber (anon);
--   - guia_fotos_dono_gravar(token, urls): só a chave de serviço (a função
--     guia-fotos-dono chama depois de subir os arquivos). Só aceita URL do
--     bucket guia, da pasta do salão, com o prefixo dono-; junta sem repetir,
--     até 8, e anota em origem.fotos_dono quem mandou e quando.
-- O público nunca lê guia_interesses: só o token abre a porta, e a porta só
-- devolve o nome do salão, as fotos que já estão na página e o primeiro nome
-- de quem reivindicou. Idempotente.

-- ---- as colunas -------------------------------------------------------------------------------
alter table public.guia_interesses add column if not exists token_fotos text;
alter table public.guia_interesses add column if not exists token_fotos_expira timestamptz;
alter table public.guia_interesses add column if not exists fotos_enviadas integer not null default 0;
alter table public.guia_interesses add column if not exists fotos_enviadas_em timestamptz;
alter table public.guia_interesses add column if not exists email_fotos_id uuid references public.email_outbox (id) on delete set null;
create unique index if not exists guia_interesses_token_fotos on public.guia_interesses (token_fotos) where token_fotos is not null;
comment on column public.guia_interesses.token_fotos is 'Fotos do dono (165): a chave do link de envio; só a Plataforma e quem recebeu o e-mail têm.';
comment on column public.guia_interesses.fotos_enviadas is 'Fotos do dono (165): quantas fotos a pessoa já mandou pelo link.';

-- o link de envio de uma reivindicação
create or replace function public.guia_url_fotos(l public.guia_lugares, token text)
returns text language sql stable set search_path = public as $$
  select public.app_base() || '/saloes/' || l.cidade_slug || '/' || l.slug || '/fotos/' || token
$$;
revoke execute on function public.guia_url_fotos(public.guia_lugares, text) from public, anon, authenticated;

-- ---- o e-mail: "Confirmado. Quer mandar as fotos?" --------------------------------------------
create or replace function public.email_fotos_dono(nome text, salao text, link text)
returns table (assunto text, html text, texto text)
language plpgsql immutable as $$
declare
  primeiro text := (select p from (select nullif(split_part(btrim(coalesce(nome, '')), ' ', 1), '') as p) x where p ~ '^[[:alpha:]''-]{2,30}$');
  s text := coalesce(nullif(btrim(salao), ''), 'o salão');
  p1 text; p2 text; passos text[]; rodape text;
  par text := '<p style="font-size:15px;line-height:1.55;margin:0 0 14px;color:#3d3d44">';
begin
  assunto := 'Confirmado: você responde por ' || s || '. Quer mandar as fotos?';
  p1 := 'Confirmamos você como responsável pela página de ' || s || ' no guia de salões da MIMO. Daqui em diante, o que você pedir sobre ela (corrigir um dado, tirar do ar) a gente faz sem precisar provar de novo.';
  p2 := 'E a página pode ficar com a cara do salão: mande até 8 fotos pelo link abaixo. A primeira vira a capa, e elas aparecem também quando alguém compartilha a página no WhatsApp. É de graça.';
  passos := array[
    'Só fotos do salão: suas, de alguém da equipe, ou que você tem autorização para usar. Nada tirado da internet.',
    'Fotos do espaço, da fachada e dos trabalhos rendem mais do que logo e arte.',
    'O link vale por 30 dias e é só seu: não repasse.'];
  rodape := 'Você recebe este e-mail porque pediu, em "É o seu salão?", para ser o responsável pela página de ' || s
            || ' no guia da MIMO, e a equipe confirmou. Se não foi você, responda este e-mail.';

  texto := coalesce(primeiro || E',\n\n', '') || p1 || E'\n\n' || p2
           || E'\n\n1. ' || passos[1] || E'\n2. ' || passos[2] || E'\n3. ' || passos[3]
           || E'\n\nMandar as fotos: ' || link
           || E'\n\n' || rodape
           || E'\n\nMIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:17px;font-weight:700;margin:0 0 10px">Confirmado!</p>'
    || par || public.escapar_html(p1) || '</p>'
    || par || public.escapar_html(p2) || '</p>'
    || '<ol style="font-size:15px;line-height:1.55;margin:0 0 18px;padding-left:20px;color:#3d3d44">'
    || '<li style="margin-bottom:8px">' || public.escapar_html(passos[1]) || '</li>'
    || '<li style="margin-bottom:8px">' || public.escapar_html(passos[2]) || '</li>'
    || '<li>' || public.escapar_html(passos[3]) || '</li></ol>'
    || '<div style="height:10px"></div>',
    'Mandar as fotos de ' || public.escapar_html(s),
    public.escapar_html(link),
    public.escapar_html(rodape));
  return next;
end $$;
revoke execute on function public.email_fotos_dono(text, text, text) from public, anon, authenticated;

-- ---- confirmou: nasce o token e sai o e-mail -------------------------------------------------
create or replace function public.guia_interesses_fotos_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lug public.guia_lugares;
  correio record;
begin
  if new.tipo = 'sou_dono' and new.status = 'confirmada' and old.status is distinct from 'confirmada' and new.email is not null then
    if new.token_fotos is null or coalesce(new.token_fotos_expira, now()) <= now() then
      new.token_fotos := md5(gen_random_uuid()::text || clock_timestamp()::text || random()::text);
      new.token_fotos_expira := now() + interval '30 days';
    end if;
    begin
      select * into lug from public.guia_lugares where id = new.lugar_id;
      if found then
        select * into correio from public.email_fotos_dono(new.nome, lug.nome, public.guia_url_fotos(lug, new.token_fotos));
        new.email_fotos_id := public.enfileirar_email(new.email, correio.assunto, correio.html, 'guia_fotos_dono', correio.texto, null, null);
      end if;
    exception when others then
      raise notice 'e-mail das fotos da reivindicação % não enfileirado: %', new.id, sqlerrm;
    end;
    begin perform public.chutar_agora(); exception when others then null; end;
  end if;
  return new;
end $$;
revoke execute on function public.guia_interesses_fotos_link() from public, anon, authenticated;
drop trigger if exists guia_interesses_fotos_link on public.guia_interesses;
create trigger guia_interesses_fotos_link before update on public.guia_interesses
  for each row execute function public.guia_interesses_fotos_link();

-- ---- a Plataforma copia (ou renova) o link ----------------------------------------------------
create or replace function public.guia_link_fotos(interesse_ uuid, renovar_ boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i public.guia_interesses;
  lug public.guia_lugares;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma'; end if;
  select * into i from public.guia_interesses where id = interesse_ and tipo = 'sou_dono';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'reivindicação não encontrada'); end if;
  if i.status is distinct from 'confirmada' then return jsonb_build_object('ok', false, 'motivo', 'a reivindicação precisa estar confirmada'); end if;
  select * into lug from public.guia_lugares where id = i.lugar_id;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'salão não encontrado'); end if;
  if renovar_ or i.token_fotos is null or coalesce(i.token_fotos_expira, now()) <= now() then
    update public.guia_interesses
       set token_fotos = md5(gen_random_uuid()::text || clock_timestamp()::text || random()::text),
           token_fotos_expira = now() + interval '30 days'
     where id = i.id
     returning * into i;
  end if;
  return jsonb_build_object('ok', true, 'url', public.guia_url_fotos(lug, i.token_fotos), 'expira', i.token_fotos_expira,
    'enviadas', i.fotos_enviadas, 'enviadas_em', i.fotos_enviadas_em);
end $$;
revoke execute on function public.guia_link_fotos(uuid, boolean) from public, anon;
grant execute on function public.guia_link_fotos(uuid, boolean) to authenticated;

-- ---- a página do link: o que ela precisa saber (qualquer um com o token) ---------------------
create or replace function public.guia_fotos_dono(token_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  i public.guia_interesses;
  lug public.guia_lugares;
  primeiro text;
begin
  if token_ is null or token_ !~ '^[0-9a-f]{32}$' then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  select * into i from public.guia_interesses where token_fotos = token_ and tipo = 'sou_dono';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  if i.status is distinct from 'confirmada' then return jsonb_build_object('ok', false, 'motivo', 'reivindicação não confirmada'); end if;
  if coalesce(i.token_fotos_expira, now()) <= now() then return jsonb_build_object('ok', false, 'motivo', 'link vencido'); end if;
  select * into lug from public.guia_lugares where id = i.lugar_id;
  if not found or lug.status = 'removido' then return jsonb_build_object('ok', false, 'motivo', 'página fora do ar'); end if;
  primeiro := (select p from (select nullif(split_part(btrim(coalesce(i.nome, '')), ' ', 1), '') as p) x where p ~ '^[[:alpha:]''-]{2,30}$');
  return jsonb_build_object('ok', true,
    'lugar', jsonb_build_object('id', lug.id, 'nome', lug.nome, 'cidade', lug.cidade, 'cidade_slug', lug.cidade_slug, 'slug', lug.slug,
      'categoria', lug.categoria, 'fotos', to_jsonb(public.guia_fotos(lug)), 'no_ar', lug.status = 'publicado'),
    'nome', primeiro, 'expira', i.token_fotos_expira, 'enviadas', i.fotos_enviadas, 'limite', 8);
end $$;
revoke execute on function public.guia_fotos_dono(text) from public;
grant execute on function public.guia_fotos_dono(text) to anon, authenticated;

-- ---- gravar o que subiu: só a chave de serviço (a função guia-fotos-dono) -------------------
create or replace function public.guia_fotos_dono_gravar(token_ text, urls_ text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i public.guia_interesses;
  lug public.guia_lugares;
  atuais text[];
  novas text[] := '{}';
  u text;
  prefixo text;
begin
  if token_ is null then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  select * into i from public.guia_interesses where token_fotos = token_ and tipo = 'sou_dono';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'link inválido'); end if;
  if i.status is distinct from 'confirmada' then return jsonb_build_object('ok', false, 'motivo', 'reivindicação não confirmada'); end if;
  if coalesce(i.token_fotos_expira, now()) <= now() then return jsonb_build_object('ok', false, 'motivo', 'link vencido'); end if;
  select * into lug from public.guia_lugares where id = i.lugar_id for update;
  if not found or lug.status = 'removido' then return jsonb_build_object('ok', false, 'motivo', 'página fora do ar'); end if;

  -- só objeto do bucket guia, da pasta deste salão, enviado pela função (prefixo dono-)
  prefixo := '/storage/v1/object/public/guia/' || lug.id::text || '/dono-';
  atuais := coalesce(lug.fotos, '{}');
  foreach u in array coalesce(urls_, '{}') loop
    if u is null or position(prefixo in u) = 0 or u ~ '[[:space:]"''<>]' then continue; end if;
    if u = any (atuais) or u = any (novas) then continue; end if;
    if array_length(atuais, 1) is not distinct from 8 or coalesce(array_length(atuais, 1), 0) + coalesce(array_length(novas, 1), 0) >= 8 then exit; end if;
    novas := novas || u;
  end loop;
  if coalesce(array_length(novas, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'fotos', to_jsonb(atuais), 'novas', 0);
  end if;
  update public.guia_lugares
     set fotos = atuais || novas,
         origem = origem || jsonb_build_object('fotos_dono', jsonb_build_object('em', now(), 'interesse', i.id, 'quantas', array_length(novas, 1),
                    'declaracao', 'enviadas pelo responsável confirmado, que declarou serem do salão'))
   where id = lug.id;
  update public.guia_interesses set fotos_enviadas = fotos_enviadas + array_length(novas, 1), fotos_enviadas_em = now() where id = i.id;
  return jsonb_build_object('ok', true, 'fotos', to_jsonb(atuais || novas), 'novas', array_length(novas, 1));
end $$;
revoke execute on function public.guia_fotos_dono_gravar(text, text[]) from public, anon, authenticated;
grant execute on function public.guia_fotos_dono_gravar(text, text[]) to service_role;

do $$
declare n int;
begin
  select count(*) into n from public.guia_interesses where tipo = 'sou_dono' and status = 'confirmada';
  raise notice '165: fotos do dono prontas (% reivindicações já confirmadas; o link delas sai em Interesses → Link das fotos)', n;
end $$;
