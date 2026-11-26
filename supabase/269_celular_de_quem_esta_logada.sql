-- =============================================================
-- MIMO — 269: o celular dos avisos é de quem está logada
--
-- 1. O push ficava preso na primeira conta que ligou os avisos no aparelho. A linha de push_subscriptions é única
--    por endpoint (o endereço do aparelho) e só a dona dela pode mexer: quem entrava com outra conta no mesmo
--    celular via "avisos ligados" (o navegador tem a assinatura), mas os avisos seguiam para a conta anterior,
--    e ligar de novo esbarrava na regra da tabela. Conta apagada e recriada dava no mesmo: o aparelho dizia
--    "ligado" e o banco não tinha linha nenhuma.
--      registrar_celular()   o aparelho passa para quem está logada (cria ou toma a linha do endpoint)
--      esquecer_celular()    ao sair da conta, o aparelho deixa de receber os avisos dela
--    O app chama a primeira ao entrar (se o aparelho já tem a permissão) e a segunda ao sair.
--
-- 2. notificar() sem destinatário não faz nada, em vez de estourar: cancelar o horário confirmado de uma cliente
--    sem cadastro derrubava o cancelamento (avisa_cliente_do_cancelamento não conferia o client_id).
--
-- 3. chutar_push() também olha os aparelhos do app da loja (push_tokens_app): quem só tinha o app da loja
--    esperava o aviso de outra pessoa (ou o relógio) para o envio ser disparado.
-- =============================================================

-- 1. O aparelho é de quem está logada ----------------------------------------------------
create or replace function public.registrar_celular(endpoint_ text, p256dh_ text, auth_ text, agente_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  antes uuid;
begin
  if eu is null then raise exception 'Entre na conta para ligar os avisos.'; end if;
  if coalesce(endpoint_, '') !~ '^https://' or length(endpoint_) > 2000
     or coalesce(p256dh_, '') = '' or coalesce(auth_, '') = '' then
    raise exception 'Assinatura de avisos inválida.';
  end if;
  select s.user_id into antes from public.push_subscriptions s where s.endpoint = endpoint_;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, agente)
  values (eu, endpoint_, p256dh_, auth_, left(agente_, 200))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        agente = excluded.agente, falhas = 0;
  return jsonb_build_object('ok', true, 'novo', antes is null, 'trocou_de_conta', antes is not null and antes <> eu);
end;
$$;
revoke execute on function public.registrar_celular(text, text, text, text) from public, anon;
grant execute on function public.registrar_celular(text, text, text, text) to authenticated;

create or replace function public.esquecer_celular(endpoint_ text)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = endpoint_ and user_id = auth.uid();
$$;
revoke execute on function public.esquecer_celular(text) from public, anon;
grant execute on function public.esquecer_celular(text) to authenticated;

-- 2. Aviso sem destinatário não derruba a ação -----------------------------------------------
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
  m record;
  titulo_app text := titulo;
  texto_app text := texto;
  push_ligado boolean := true;
begin
  -- 269: sem conta não há para quem avisar. Antes, o aviso "para ninguém" estourava (user_id é obrigatório) e levava
  -- junto a ação inteira: o salão não conseguia cancelar o horário confirmado de uma cliente sem cadastro
  if destinatario is null then
    return null;
  end if;

  -- o aviso no app e o push podem ter sido reescritos na plataforma
  begin
    select * into m from public.montar_push(tipo, destinatario, titulo, texto, carga_ok);
    if found then titulo_app := m.titulo_; texto_app := m.texto_; end if;
  exception when others then null;
  end;
  begin
    select r.envia into push_ligado from public.push_regras r where r.kind = tipo;
    if not found then push_ligado := true; end if;
  exception when others then push_ligado := true;
  end;

  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at, push_em, push_resultado)
  values (destinatario, tipo, titulo_app, texto_app, url, carga_ok, vence_em,
          case when push_ligado then null else now() end,
          case when push_ligado then null else 'desligado na plataforma' end)
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

  -- push e e-mail saem agora, uma chamada por transação
  perform public.chutar_agora();

  return novo_id;
end;
$$;

-- 3. O envio na hora também vale para o app da loja ------------------------------------------
create or replace function public.chutar_push()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  url text; chave text; pedido bigint;
begin
  if not exists (select 1 from public.notifications n where n.push_em is null and n.created_at > now() - interval '24 hours'
                 and (exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
                   or exists (select 1 from public.push_tokens_app t where t.user_id = n.user_id))) then
    return jsonb_build_object('ok', true, 'vazio', true);
  end if;
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;
  if url is null or chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem credenciais — rode select public.ligar_relogio(url, chave)');
  end if;
  begin
    execute format(
      $q$ select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000) $q$,
      rtrim(url, '/') || '/functions/v1/enviar-push',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net indisponível: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;
revoke execute on function public.chutar_push() from public, anon, authenticated;

do $$ begin raise notice '269: registrar_celular, esquecer_celular, notificar sem destinatário e chutar_push com o app da loja'; end $$;
