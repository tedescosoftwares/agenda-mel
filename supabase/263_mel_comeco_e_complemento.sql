-- 263: o complemento do pedido e o convite do Instagram na conversa (4.8, o resto do pacote 2 das conversas reais)
--   1. A cliente que diz o dia, o horário ou um detalhe DEPOIS que o pedido já foi ("Quinta pela manhã") ouvia "vou passar
--      essa preferência para o salão", e nada ia. Agora vai: guia_whats_lead_complemento atualiza o pedido da conversa e
--      devolve o que a Mel precisa para avisar o salão (até 2 complementos por pedido; só pedido que chegou ao salão e
--      que o salão não recusou).
--   2. O convite do Instagram sai como segunda mensagem e não ficava na conversa (a Plataforma e as exportações não o
--      mostravam): guia_whats_conversa_nota guarda uma mensagem da Mel na conversa, sem mexer no estado nem nos relógios.
-- (O começo mais curto da 4.8 é só código: a primeira resposta da Mel pergunta o serviço e usa o nome do perfil.)
-- Idempotente.

alter table public.guia_whats_leads add column if not exists complementos integer not null default 0;

create or replace function public.guia_whats_lead_complemento(conversa_ bigint, servico_ text, preferencia_ text, observacao_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cv public.guia_whats_conversas;
  ld public.guia_whats_leads;
begin
  select * into cv from public.guia_whats_conversas where id = conversa_;
  if cv.id is null or cv.lead_id is null or cv.teste then return null; end if;
  select * into ld from public.guia_whats_leads where id = cv.lead_id for update;
  if ld.id is null or ld.salao_tel is null or ld.complementos >= 2 or ld.voto = 'nao'
     or ld.status not in ('enviado', 'salao_respondeu', 'salao_quer_conhecer', 'salao_vai_atender') then
    return null;
  end if;
  update public.guia_whats_leads set
    servico = coalesce(nullif(left(btrim(coalesce(servico_, '')), 200), ''), servico),
    preferencia = coalesce(nullif(left(btrim(coalesce(preferencia_, '')), 200), ''), preferencia),
    observacao = coalesce(nullif(left(btrim(coalesce(observacao_, '')), 400), ''), observacao),
    complementos = complementos + 1
   where id = ld.id
  returning * into ld;
  return jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'salao_tel', ld.salao_tel, 'cliente_nome', ld.cliente_nome,
                            'cliente_tel', ld.cliente_tel, 'token', ld.token, 'servico', ld.servico, 'preferencia', ld.preferencia, 'observacao', ld.observacao);
end $$;
revoke execute on function public.guia_whats_lead_complemento(bigint, text, text, text) from public, anon, authenticated;

create or replace function public.guia_whats_conversa_nota(id_ bigint, texto_ text)
returns void language sql security definer set search_path = public as $$
  update public.guia_whats_conversas c set
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now()))
                     with ordinality as e(m, o) order by o desc limit 60) t)
   where c.id = id_ and btrim(coalesce(texto_, '')) <> ''
$$;
revoke execute on function public.guia_whats_conversa_nota(bigint, text) from public, anon, authenticated;

do $$
begin
  raise notice '263: o complemento do pedido (guia_whats_lead_complemento, complementos) e o convite do Instagram na conversa (guia_whats_conversa_nota)';
end $$;
