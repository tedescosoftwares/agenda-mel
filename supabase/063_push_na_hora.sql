-- 063 · O push sai na hora, não na próxima batida do relógio
--
-- O relógio bate a cada minuto; um aviso criado no segundo 5 esperava
-- até 55 s parado na fila. Agora quem cria o aviso (notificar) já chuta
-- a função de push — e a de e-mail — uma vez por transação, via
-- pg_net (assíncrono, sai depois do commit). O relógio continua como
-- rede de segurança para o que ficar para trás.
create or replace function public.chutar_agora()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('agenda_mel.chutei', true), '') = '1' then return; end if;
  perform set_config('agenda_mel.chutei', '1', true);
  begin
    perform public.chutar_push();
  exception when others then null;
  end;
  begin
    perform public.chutar_emails();
  exception when others then null;
  end;
end;
$$;
revoke execute on function public.chutar_agora() from public, anon, authenticated;

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

  -- push e e-mail saem agora, uma chamada por transação
  perform public.chutar_agora();

  return novo_id;
end;
$$;

revoke execute on function
  public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
