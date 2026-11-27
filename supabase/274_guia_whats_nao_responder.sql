-- 274 · Números que o WhatsApp do guia não responde (4.42)
--
-- O número da Mel também é usado pela equipe da MIMO no WhatsApp Web. Quando alguém da equipe chama uma pessoa por
-- ele, a resposta dela caía no bot, que respondia no meio da conversa. Agora a Plataforma (Guia › WhatsApp › Não
-- responder) põe o número numa lista antes de chamar: enquanto ele estiver lá, a Mel, o onboarding e os lembretes
-- automáticos (ainda está aí?, cutucada do salão) não mandam nada para ele. A mensagem continua chegando no celular.
-- A entrada pode valer até ser tirada ou por um prazo (2 h, 24 h), para não ficar esquecida.
-- O voto na enquete "vai atender?" continua valendo: é a resposta a um pedido de cliente, não conversa.

create table if not exists public.guia_whats_nao_responder (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  telefone text not null,
  nome text,
  ate timestamptz,
  criado_por uuid,
  criado_em timestamptz not null default now()
);
alter table public.guia_whats_nao_responder enable row level security;
revoke all on public.guia_whats_nao_responder from public, anon, authenticated;

-- o robô pergunta antes de responder (só a chave de serviço chama)
create or replace function public.guia_whats_calado(tel text)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select exists (select 1 from public.guia_whats_nao_responder n
                  where n.chave = public.telefone_chave(tel) and (n.ate is null or n.ate > now()));
$$;
revoke execute on function public.guia_whats_calado(text) from public, anon, authenticated;
grant execute on function public.guia_whats_calado(text) to service_role;

create or replace function public.guia_whats_calados()
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no WhatsApp do guia'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'telefone', n.telefone, 'nome', n.nome, 'ate', n.ate, 'criado_em', n.criado_em) order by n.criado_em desc)
                     from public.guia_whats_nao_responder n where n.ate is null or n.ate > now()), '[]'::jsonb);
end;
$$;
revoke execute on function public.guia_whats_calados() from public, anon;
grant execute on function public.guia_whats_calados() to authenticated;

-- horas nulo = até alguém tirar
create or replace function public.guia_whats_calar(tel text, nome_ text default null, horas integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare ch text := public.telefone_chave(tel); fim timestamptz;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no WhatsApp do guia'; end if;
  if ch is null then raise exception 'Confira o número: DDD + número.'; end if;
  if horas is not null then fim := now() + make_interval(hours => greatest(1, least(horas, 720))); end if;
  delete from public.guia_whats_nao_responder where ate is not null and ate <= now();
  insert into public.guia_whats_nao_responder (chave, telefone, nome, ate, criado_por)
  values (ch, btrim(tel), nullif(btrim(coalesce(nome_, '')), ''), fim, auth.uid())
  on conflict (chave) do update set telefone = excluded.telefone, nome = coalesce(excluded.nome, public.guia_whats_nao_responder.nome), ate = excluded.ate, criado_em = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.guia_whats_calar(text, text, integer) from public, anon;
grant execute on function public.guia_whats_calar(text, text, integer) to authenticated;

create or replace function public.guia_whats_falar(id_ uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma mexe no WhatsApp do guia'; end if;
  delete from public.guia_whats_nao_responder where id = id_;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.guia_whats_falar(uuid) from public, anon;
grant execute on function public.guia_whats_falar(uuid) to authenticated;

notify pgrst, 'reload schema';
