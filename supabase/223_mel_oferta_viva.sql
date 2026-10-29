-- 223_mel_oferta_viva.sql
-- 3.77.1 — A oferta de outros salões não morre no relógio. Na conversa da Maria (o pedido não chegou ao salão), a Mel
-- ofereceu 3 salões às 12h30; às 12h40 o ocioso mandou o "posso encerrar? quer que eu envie seu pedido ao salão agora?"
-- (o texto genérico) e às 12h55 encerrou a conversa, levando as opções junto; quando ela respondeu "pode enviar para
-- outros", a Mel recomeçou do zero ("de qual salão você quer marcar?").
--   1. guia_whats_ociosas: a conversa com a oferta aberta (dados.opcoes) fica fora do "posso encerrar?" e do encerramento;
--      ela esquece sozinha depois de ocioso_horas, como qualquer conversa, e até lá a resposta da cliente vale.
--   2. guia_whats_oferecer: a conversa guarda o motivo da oferta (oferta_motivo), para a Mel não sugerir "esperar" um
--      salão que nem recebeu o pedido.
-- O resto é do código (whatsapp-webhook, guia-whats): a oferta na hora quando o pedido não chega ao salão, a lista de
-- novo quando ela responde sem o número, e a resposta à oferta que vale mesmo com a conversa já encerrada.

-- o ocioso não mexe na conversa com a oferta aberta (o resto é a 200)
create or replace function public.guia_whats_ociosas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ocioso_ativo or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'perguntar', '[]'::jsonb, 'encerrar', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ativo', true,
    'instancia', cfg.instancia,
    'texto_perguntar', cfg.msg_ocioso,
    'texto_encerrar', cfg.msg_encerramento,
    'perguntar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone)), '[]'::jsonb) from (
        select id, telefone from public.guia_whats_conversas
         where not teste and estado in ('conversando', 'confirmando') and cutucada_em is null and not (dados ? 'opcoes')
           and atualizada_em < now() - make_interval(mins => cfg.ocioso_perguntar_min)
           and atualizada_em > now() - make_interval(hours => cfg.ocioso_horas)
         order by atualizada_em limit 50) x),
    'encerrar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone)), '[]'::jsonb) from (
        select id, telefone from public.guia_whats_conversas
         where not teste and estado in ('conversando', 'confirmando') and cutucada_em is not null and not (dados ? 'opcoes')
           and cutucada_em < now() - make_interval(mins => cfg.ocioso_encerrar_min)
         order by cutucada_em limit 50) x)
  );
end $$;

-- a conversa guarda o motivo da oferta (o resto é a 222)
create or replace function public.guia_whats_oferecer(lead_ bigint, texto_ text, opcoes_ jsonb, motivo_ text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  op jsonb := case when jsonb_typeof(opcoes_) = 'array' then opcoes_ else '[]'::jsonb end;
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
  n bigint;
begin
  select * into ld from public.guia_whats_leads where id = lead_ for update;
  if ld.id is null then return null; end if;
  update public.guia_whats_leads set
    resgate_em = coalesce(resgate_em, now()),
    resgate_motivo = coalesce(resgate_motivo, case when motivo_ in ('demora', 'sem_contato', 'falhou', 'nao') then motivo_ end),
    resgate_opcoes = op
   where id = ld.id;
  if ld.conversa_id is null then return null; end if;
  update public.guia_whats_conversas c set
    estado = 'conversando', lugar_id = null, lead_id = null, cutucada_em = null,
    dados = (c.dados - 'pos_envio' - 'sem_avanco' - 'dona' - 'opcoes' - 'resgate_de' - 'salao_recusou' - 'oferta_motivo')
            || jsonb_build_object('salao_anterior', ld.salao_nome, 'resgate_de', ld.id, 'opcoes', op,
                                  'oferta_motivo', case when motivo_ in ('demora', 'sem_contato', 'falhou', 'nao') then motivo_ else 'demora' end),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
    atualizada_em = now()
   where c.id = ld.conversa_id and not c.teste
  returning c.id into n;
  return n;
end $$;

do $$ begin raise notice '223: a oferta de outros salões não morre no relógio (guia_whats_ociosas sem dados.opcoes, oferta_motivo)'; end $$;
