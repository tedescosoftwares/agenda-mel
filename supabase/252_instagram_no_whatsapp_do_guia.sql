-- 252 · O convite do Instagram no WhatsApp do guia, e quando ele aparece (4.2)
--
-- No site o convite aparece antes de chamar o salão; quase ninguém tocou em Seguir. No WhatsApp do guia a pessoa já está
-- conversando com o número da MIMO: no fim da conversa, a Mel pede uma ajudinha, numa segunda mensagem, uns segundos
-- depois da última:
--   no "sim" (o pedido foi para o salão): msg_insta_sim, "Enquanto o {salao} te responde, posso te pedir uma ajudinha?…"
--   no "não" (ela desistiu, ou a conversa encerrou sem avançar): msg_insta_nao
-- O link é o @ da MIMO (config_publica.instagram, o mesmo do site); sem @, nada sai. Quando aparece: insta_dias, por
-- número de WhatsApp (0 = em toda conversa; 30 = de novo só depois de 30 dias). Quem recebeu fica em guia_whats_insta
-- (o número, a última vez e quantas vezes), que só o servidor lê; a conta de "quantos receberam" vai para a Plataforma.
-- Tudo editável em Plataforma › Guia › WhatsApp › Configuração. Pode rodar de novo: nada é duplicado.

alter table public.guia_whats_config add column if not exists insta_ligado boolean not null default true;
alter table public.guia_whats_config add column if not exists insta_dias integer not null default 30;
alter table public.guia_whats_config add column if not exists msg_insta_sim text not null default
  E'Enquanto o {salao} te responde, posso te pedir uma ajudinha? 🙏\nA MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro os salões mais bem avaliados de {cidade}. Leva 2 segundos 💗\n👉 {link}';
alter table public.guia_whats_config add column if not exists msg_insta_nao text not null default
  E'Posso te pedir uma ajudinha antes de ir? 🙏\nA MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro os salões mais bem avaliados de {cidade}. Leva 2 segundos 💗\n👉 {link}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guia_whats_config_insta_dias_check') then
    alter table public.guia_whats_config add constraint guia_whats_config_insta_dias_check check (insta_dias between 0 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guia_whats_config_msg_insta_check') then
    alter table public.guia_whats_config add constraint guia_whats_config_msg_insta_check check (length(msg_insta_sim) between 10 and 1500 and length(msg_insta_nao) between 10 and 1500);
  end if;
end $$;

-- quem já recebeu o convite (por número): só as funções do servidor mexem
create table if not exists public.guia_whats_insta (
  telefone text primary key,
  ultimo_em timestamptz not null default now(),
  vezes integer not null default 1
);
alter table public.guia_whats_insta enable row level security;
revoke all on public.guia_whats_insta from public, anon, authenticated;

-- pode convidar este número agora? Devolve o link do Instagram (e anota) ou null: convite desligado, sem @ na
-- configuração, ou o número recebeu há menos de insta_dias. teste_ (o simulador da Plataforma) não anota nada.
create or replace function public.guia_whats_insta_convidar(tel_ text, teste_ boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
  arroba text;
  t text := regexp_replace(coalesce(tel_, ''), '\D', '', 'g');
  ultimo timestamptz;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not coalesce(cfg.insta_ligado, false) then return null; end if;
  select regexp_replace(regexp_replace(btrim(valor), '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@|/+$', '', 'g')
    into arroba from public.config_publica where chave = 'instagram';
  if coalesce(arroba, '') = '' then return null; end if;
  if teste_ then return 'https://instagram.com/' || arroba; end if;
  if t = '' then return null; end if;
  select ultimo_em into ultimo from public.guia_whats_insta where telefone = t;
  if ultimo is not null and cfg.insta_dias > 0 and ultimo > now() - make_interval(days => cfg.insta_dias) then return null; end if;
  insert into public.guia_whats_insta (telefone, ultimo_em, vezes) values (t, now(), 1)
    on conflict (telefone) do update set ultimo_em = now(), vezes = public.guia_whats_insta.vezes + 1;
  return 'https://instagram.com/' || arroba;
end $$;
revoke all on function public.guia_whats_insta_convidar(text, boolean) from public, anon, authenticated;

-- para a Plataforma: quantos números receberam o convite (no total e nos últimos 30 dias)
create or replace function public.guia_whats_insta_numeros()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma'; end if;
  return jsonb_build_object(
    'numeros', (select count(*) from public.guia_whats_insta),
    'ultimos_30', (select count(*) from public.guia_whats_insta where ultimo_em > now() - interval '30 days'),
    'envios', (select coalesce(sum(vezes), 0) from public.guia_whats_insta));
end $$;
revoke all on function public.guia_whats_insta_numeros() from public, anon;
grant execute on function public.guia_whats_insta_numeros() to authenticated;

-- o salvar da aba WhatsApp (o da 222) com os quatro campos do convite
create or replace function public.guia_whats_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text;
  avisos text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o WhatsApp do guia'; end if;
  if c ? 'numero' then
    num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), '');
    if num is not null and length(num) in (10, 11) then num := '55' || num; end if;
    if num is not null and num !~ '^[1-9][0-9]{9,14}$' then raise exception 'número inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  if c ? 'numero_avisos' then
    avisos := nullif(regexp_replace(coalesce(c ->> 'numero_avisos', ''), '\D', '', 'g'), '');
    if avisos is not null and length(avisos) in (10, 11) then avisos := '55' || avisos; end if;
    if avisos is not null and avisos !~ '^[1-9][0-9]{9,14}$' then raise exception 'número de avisos inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_whats_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      numero = case when c ? 'numero' then num else g.numero end,
      numero_avisos = case when c ? 'numero_avisos' then avisos else g.numero_avisos end,
      instancia = coalesce(nullif(lower(btrim(c ->> 'instancia')), ''), g.instancia),
      botoes = case when c ? 'botoes' then array(select distinct x from jsonb_array_elements_text(c -> 'botoes') x order by 1) else g.botoes end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      msg_cliente = coalesce(nullif(btrim(c ->> 'msg_cliente'), ''), g.msg_cliente),
      msg_salao = coalesce(nullif(btrim(c ->> 'msg_salao'), ''), g.msg_salao),
      msg_salao_resposta = coalesce(nullif(btrim(c ->> 'msg_salao_resposta'), ''), g.msg_salao_resposta),
      msg_encerramento = coalesce(nullif(btrim(c ->> 'msg_encerramento'), ''), g.msg_encerramento),
      msg_ocioso = coalesce(nullif(btrim(c ->> 'msg_ocioso'), ''), g.msg_ocioso),
      msg_dona = coalesce(nullif(btrim(c ->> 'msg_dona'), ''), g.msg_dona),
      sobre_agenda = coalesce((c ->> 'sobre_agenda')::boolean, g.sobre_agenda),
      msg_sobre_agenda = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda'), ''), g.msg_sobre_agenda),
      msg_sobre_agenda_site = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda_site'), ''), g.msg_sobre_agenda_site),
      resgate_min = coalesce((c ->> 'resgate_min')::integer, g.resgate_min),
      resgate_inicio = coalesce(nullif(btrim(c ->> 'resgate_inicio'), '')::time, g.resgate_inicio),
      resgate_fim = coalesce(nullif(btrim(c ->> 'resgate_fim'), '')::time, g.resgate_fim),
      resgate_opcoes = coalesce((c ->> 'resgate_opcoes')::integer, g.resgate_opcoes),
      msg_resgate = coalesce(nullif(btrim(c ->> 'msg_resgate'), ''), g.msg_resgate),
      enquete_ativa = coalesce((c ->> 'enquete_ativa')::boolean, g.enquete_ativa),
      enquete_pergunta = coalesce(nullif(btrim(c ->> 'enquete_pergunta'), ''), g.enquete_pergunta),
      enquete_sim = coalesce(nullif(btrim(c ->> 'enquete_sim'), ''), g.enquete_sim),
      enquete_nao = coalesce(nullif(btrim(c ->> 'enquete_nao'), ''), g.enquete_nao),
      msg_salao_vai_atender = coalesce(nullif(btrim(c ->> 'msg_salao_vai_atender'), ''), g.msg_salao_vai_atender),
      msg_salao_nao_atende = coalesce(nullif(btrim(c ->> 'msg_salao_nao_atende'), ''), g.msg_salao_nao_atende),
      avisar_cliente_nao = coalesce((c ->> 'avisar_cliente_nao')::boolean, g.avisar_cliente_nao),
      msg_cliente_nao_atende = coalesce(nullif(btrim(c ->> 'msg_cliente_nao_atende'), ''), g.msg_cliente_nao_atende),
      aviso_nao_atende = coalesce((c ->> 'aviso_nao_atende')::boolean, g.aviso_nao_atende),
      msg_aviso_nao_atende = coalesce(nullif(btrim(c ->> 'msg_aviso_nao_atende'), ''), g.msg_aviso_nao_atende),
      aviso_demora_min = coalesce((c ->> 'aviso_demora_min')::integer, g.aviso_demora_min),
      msg_aviso_demora = coalesce(nullif(btrim(c ->> 'msg_aviso_demora'), ''), g.msg_aviso_demora),
      cutucar_salao_min = coalesce((c ->> 'cutucar_salao_min')::integer, g.cutucar_salao_min),
      msg_cutucar_salao = coalesce(nullif(btrim(c ->> 'msg_cutucar_salao'), ''), g.msg_cutucar_salao),
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      exigir_preferencia = coalesce((c ->> 'exigir_preferencia')::boolean, g.exigir_preferencia),
      ocioso_ativo = coalesce((c ->> 'ocioso_ativo')::boolean, g.ocioso_ativo),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
      pos_envio = coalesce((c ->> 'pos_envio')::integer, g.pos_envio),
      max_sem_avanco = coalesce((c ->> 'max_sem_avanco')::integer, g.max_sem_avanco),
      ocioso_horas = coalesce((c ->> 'ocioso_horas')::integer, g.ocioso_horas),
      ocioso_perguntar_min = coalesce((c ->> 'ocioso_perguntar_min')::integer, g.ocioso_perguntar_min),
      ocioso_encerrar_min = coalesce((c ->> 'ocioso_encerrar_min')::integer, g.ocioso_encerrar_min),
      retencao_dias = coalesce((c ->> 'retencao_dias')::integer, g.retencao_dias),
      -- 252: o convite do Instagram nas pontas da conversa
      insta_ligado = coalesce((c ->> 'insta_ligado')::boolean, g.insta_ligado),
      insta_dias = coalesce((c ->> 'insta_dias')::integer, g.insta_dias),
      msg_insta_sim = coalesce(nullif(btrim(c ->> 'msg_insta_sim'), ''), g.msg_insta_sim),
      msg_insta_nao = coalesce(nullif(btrim(c ->> 'msg_insta_nao'), ''), g.msg_insta_nao),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'instancia' then 'instância inválida: letras minúsculas, números, - e _ (2 a 40)'
        when sqlerrm ~ 'botoes' then 'botões: whatsapp, ligar ou quero_marcar'
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'numero_avisos' then 'número de avisos inválido: use DDD e número'
        when sqlerrm ~ 'enquete_pergunta' then 'a pergunta da enquete: de 3 a 200 letras'
        when sqlerrm ~ 'enquete_(sim|nao)' then 'cada opção da enquete: de 2 a 60 letras'
        when sqlerrm ~ 'aviso_demora_min' then 'avisar a equipe da demora: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'cutucar_salao_min' then 'cutucar o salão: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'limite_respostas' then 'respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'pos_envio' then 'dúvidas depois do envio: de 0 a 20'
        when sqlerrm ~ 'max_sem_avanco' then 'mensagens sem avançar antes de encerrar: de 2 a 50'
        when sqlerrm ~ 'ocioso_perguntar_min' then 'minutos parada antes de perguntar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_encerrar_min' then 'minutos desde a pergunta antes de encerrar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_horas' then 'horas para esquecer a conversa parada: de 1 a 168'
        when sqlerrm ~ 'retencao_dias' then 'guardar as conversas: de 7 a 730 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação da Mel: de 20 a 6000 letras'
        when sqlerrm ~ 'msg_dona' then 'a mensagem da dona: de 10 a 4000 letras'
        when sqlerrm ~ 'resgate_janela' then 'a janela do resgate: o começo antes do fim (ex.: 08:00 a 21:00)'
        when sqlerrm ~ 'resgate_min' then 'oferecer outro salão depois de: 0 (desligado) ou de 5 a 1440 minutos'
        when sqlerrm ~ 'resgate_opcoes' then 'quantos salões sugerir: de 1 a 5'
        when sqlerrm ~ 'msg_resgate' then 'a mensagem do resgate: de 10 a 1500 letras, com {opcoes}'
        when sqlerrm ~ 'insta_dias' then 'o convite do Instagram de novo depois de: 0 (toda conversa) a 365 dias'
        when sqlerrm ~ 'msg_insta' then 'a mensagem do Instagram: de 10 a 1500 letras'
        when sqlerrm ~ 'msg_sobre_agenda_site' then 'a mensagem da MIMO Agenda com o comercial desligado: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_sobre_agenda' then 'a mensagem da MIMO Agenda: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais'
        else sqlerrm end;
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'valor inválido num campo de número, horário ou sim/não';
  end;
  if (select ligado and numero is null from public.guia_whats_config where id = 1) then
    update public.guia_whats_config set ligado = false where id = 1;
    raise exception 'para ligar, informe o número do WhatsApp do guia';
  end if;
  return (select to_jsonb(g) from public.guia_whats_config g where g.id = 1);
end $$;

-- o convite do SITE (config_publica.guia_instagram, salvo pela aba Instagram): quem ainda está com o texto padrão antigo
-- ("Antes de chamar, siga a MIMO no Instagram") passa para o pedido de ajuda; texto que alguém escreveu fica como está
do $$
declare v jsonb;
begin
  select valor::jsonb into v from public.config_publica where chave = 'guia_instagram';
  if v is not null and jsonb_typeof(v) = 'object' and coalesce(v ->> 'titulo', '') in ('', 'Antes de chamar, siga a MIMO no Instagram') then
    v := v || jsonb_build_object('titulo', 'Posso te pedir uma ajudinha? 🙏');
    if coalesce(v ->> 'texto', '') in ('', 'É de graça. Seguindo, você recebe:') then
      v := v || jsonb_build_object('texto', 'A MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro:');
    end if;
    update public.config_publica set valor = v::text, atualizado_em = now() where chave = 'guia_instagram';
  end if;
exception when others then
  raise notice '252: o convite do site não foi trocado (%): troque o texto na aba Instagram', sqlerrm;
end $$;do $$ begin raise notice '252: o convite do Instagram no WhatsApp do guia (insta_ligado, insta_dias, msg_insta_sim, msg_insta_nao, guia_whats_insta, guia_whats_insta_convidar, guia_whats_insta_numeros)'; end $$;
