-- 280 · Excluir o perfil de uma profissional (4.54)
--
-- Desativar só tira a agenda do ar; a ficha, a página, as avaliações e o link continuam guardados. Agora o salão pode
-- também EXCLUIR o perfil de quem saiu (menos a dona). Vai embora, sem volta: a página e o link dela, o QR, a foto, a
-- bio, o contato, os serviços e horários dela, os bloqueios, as avaliações que ela recebeu, as favoritas e preferidas,
-- a fila de espera e as promoções dela, e a ligação com a conta dela (a conta continua existindo, como cliente).
-- O que fica: os atendimentos que já aconteceram e as comandas, porque são o histórico e o financeiro do salão
-- (faturamento, repasse, ficha das clientes). Nesses, o nome dela continua aparecendo. Contrato de parceria e aceites
-- também ficam: são documentos. Quando existe esse histórico, a ficha vira uma linha vazia e escondida (excluida_em);
-- sem histórico, a linha é apagada de verdade.
-- Horário futuro marcado trava a exclusão: primeiro remarca ou cancela.

alter table public.professionals add column if not exists excluida_em timestamptz;

-- o que a tela mostra antes de confirmar
create or replace function public.equipe_excluir_previa(prof uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare p public.professionals%rowtype;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.manda_no_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  return jsonb_build_object(
    'nome', p.name, 'tem_conta', p.user_id is not null,
    'avaliacoes', (select count(*) from public.reviews r where r.professional_id = p.id),
    'atendimentos', (select count(*) from public.appointments a where a.professional_id = p.id and a.status = 'concluido'),
    'futuros', (select count(*) from public.appointments a where a.professional_id = p.id and a.status in ('pendente', 'confirmado', 'aguardando_pagamento') and a.date >= public.agora_local()::date),
    'preferida_de', (select count(*) from public.profissional_preferida x where x.professional_id = p.id));
end;
$$;
revoke execute on function public.equipe_excluir_previa(uuid) from public, anon;
grant execute on function public.equipe_excluir_previa(uuid) to authenticated;

create or replace function public.equipe_excluir(prof uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; s public.salons%rowtype; futuros integer; tem boolean; conta uuid;
begin
  select * into p from public.professionals where id = prof for update;
  if p.id is null or not public.manda_no_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  select * into s from public.salons where id = p.salon_id;
  if p.user_id is not null and p.user_id = s.owner_id then raise exception 'A ficha da dona não pode ser excluída. Para parar de atender, desligue a chave dela na Equipe.'; end if;
  select count(*) into futuros from public.appointments a
   where a.professional_id = p.id and a.status in ('pendente', 'confirmado', 'aguardando_pagamento') and a.date >= public.agora_local()::date;
  if futuros > 0 then
    raise exception 'Ela ainda tem % % na agenda. Remarque ou cancele antes de excluir o perfil.', futuros, case when futuros = 1 then 'horário marcado' else 'horários marcados' end;
  end if;

  conta := p.user_id;
  delete from public.professional_services where professional_id = p.id;
  delete from public.professional_hours where professional_id = p.id;
  delete from public.professional_blocks where professional_id = p.id;
  delete from public.reviews where professional_id = p.id;
  delete from public.client_favorites where professional_id = p.id;
  delete from public.profissional_preferida where professional_id = p.id;
  delete from public.acessos_equipe where professional_id = p.id;
  delete from public.waitlist_entries where professional_id = p.id;
  delete from public.promocoes where professional_id = p.id;
  delete from public.client_nudges where professional_id = p.id;
  delete from public.fechamentos_lembrados where professional_id = p.id;

  tem := exists (select 1 from public.appointments a where a.professional_id = p.id)
      or exists (select 1 from public.comanda_itens ci where ci.professional_id = p.id)
      or exists (select 1 from public.parcerias x where x.professional_id = p.id);
  if tem then
    update public.professionals set
      situacao = 'inativa', user_id = null, phone = null, email = null, photo_url = null, bio = null, especialidade = null,
      instagram = null, whatsapp_publico = null, codigo = null, slug = 'excluida-' || replace(id::text, '-', ''), excluida_em = now()
    where id = p.id;
  else
    delete from public.professionals where id = p.id;
  end if;

  -- a conta dela continua sendo dela: só deixa de ser profissional deste salão
  if conta is not null then
    delete from public.salon_members where salon_id = p.salon_id and user_id = conta and papel = 'profissional';
    update public.profiles set role = 'cliente'
     where id = conta and role = 'profissional' and not exists (select 1 from public.professionals x where x.user_id = conta);
  end if;
  return jsonb_build_object('ok', true, 'apagada', not tem, 'guardou_historico', tem);
end;
$$;
revoke execute on function public.equipe_excluir(uuid) from public, anon;
grant execute on function public.equipe_excluir(uuid) to authenticated;

-- a lista da Equipe não mostra as fichas excluídas (a linha só existe para o histórico)
create or replace function public.equipe_da_casa(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email, 'photo_url', p.photo_url, 'especialidade', p.especialidade, 'slug', p.slug, 'bio', p.bio,
    'user_id', p.user_id, 'vinculo', p.vinculo, 'situacao', p.situacao, 'permissoes', p.permissoes, 'cota_pct', p.cota_pct, 'cota_excecoes', p.cota_excecoes,
    'usa_horario_salao', p.usa_horario_salao, 'configurada_em', p.configurada_em, 'ativada_em', p.ativada_em, 'created_at', p.created_at,
    'categorias', to_jsonb(p.categorias),
    'dona', p.user_id is not null and p.user_id = s.owner_id,
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object('service_id', ps.service_id, 'preco_cents', ps.preco_cents, 'duracao_minutos', ps.duracao_minutos) order by sv.name), '[]'::jsonb)
                 from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
                 from public.professional_hours h where h.professional_id = p.id),
    'token', (select a.token from public.acessos_equipe a where a.professional_id = p.id and a.usado_em is null order by a.criado_em desc limit 1),
    'acesso_enviado_em', (select max(a.enviado_em) from public.acessos_equipe a where a.professional_id = p.id),
    'parceria', (select x.status from public.parcerias x where x.professional_id = p.id order by x.inicio desc limit 1),
    'tem_historico', exists (select 1 from public.appointments a where a.professional_id = p.id)
  ) order by (p.situacao = 'inativa'), p.created_at), '[]'::jsonb)
  from public.professionals p
  join public.salons s on s.id = p.salon_id
  where p.salon_id = salao and public.is_admin_do_salao(salao) and p.excluida_em is null;
$$;
revoke execute on function public.equipe_da_casa(uuid) from public, anon;
grant execute on function public.equipe_da_casa(uuid) to authenticated;

notify pgrst, 'reload schema';
