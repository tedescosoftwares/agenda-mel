-- 126 · Teste grátis e modo leitura
--
-- O salão (tipo 'salao') ganha 7 dias grátis contados da ativação: o
-- momento em que o link e o QR Code são liberados no painel (Configurar ›
-- Ativação). A autônoma segue grátis. Quem conclui o cadastro e não ativa
-- em 30 dias tem o teste começando sozinho.
--
-- Acabou o teste sem assinar? 5 dias de MODO LEITURA: os agendamentos que
-- já existem continuam valendo e a dona segue vendo tudo, mas o salão não
-- recebe agendamento novo (link, assistente, comanda — a trigger barra
-- todo mundo). Depois disso o painel fica pausado.
--
-- A assinatura paga (cartão, Pix Automático, Pix avulso) é a parte 2: por
-- ora `assinatura_definir` deixa a plataforma (ou o SQL) marcar 'ativa'.
--
-- Fases que `acesso_do_salao` devolve:
--   gratis        autônoma
--   configurando  salão que ainda não ativou (ainda montando serviços e equipe)
--   teste         nos 7 dias grátis
--   ativa         assinatura em dia (ou cortesia, sem prazo)
--   leitura       teste ou pagamento vencido, dentro da tolerância
--   bloqueado     passou a tolerância

alter table public.salons add column if not exists ativado_em timestamptz;

create table if not exists public.assinaturas (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  situacao text not null default 'teste' check (situacao in ('teste', 'ativa', 'cancelada')),
  teste_ate timestamptz,
  -- 'ativa' com pago_ate nulo = sem prazo (cortesia ou acerto manual)
  pago_ate timestamptz,
  metodo text,          -- cortesia | manual | cartao | pix_automatico | pix (parte 2)
  referencia text,      -- id da assinatura/cobrança no gateway (parte 2)
  avisos jsonb not null default '{}'::jsonb,   -- quais lembretes já saíram
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.assinaturas enable row level security;
drop policy if exists "dona ve a assinatura" on public.assinaturas;
create policy "dona ve a assinatura" on public.assinaturas
  for select to authenticated using (public.is_admin_do_salao(salon_id) or public.eh_plataforma());

create or replace function public.regras_da_assinatura()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('teste_dias', 7, 'tolerancia_dias', 5, 'prazo_ativacao_dias', 30);
$$;
grant execute on function public.regras_da_assinatura() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Em que pé está o acesso do salão
-- ---------------------------------------------------------------------------
create or replace function public.acesso_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  r jsonb := public.regras_da_assinatura();
  agora timestamptz := now();
  fim timestamptz;
  tol timestamptz;
  fase text;
begin
  select * into s from public.salons where id = salao;
  if not found then return null; end if;
  if s.tipo = 'autonoma' then return jsonb_build_object('fase', 'gratis', 'tipo', s.tipo); end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then
    return jsonb_build_object('fase', 'configurando', 'tipo', s.tipo,
      'teste_dias', r ->> 'teste_dias',
      'prazo_ativacao', case when s.onboarding_concluido_em is not null then s.onboarding_concluido_em + make_interval(days => (r ->> 'prazo_ativacao_dias')::int) end);
  end if;

  if a.situacao = 'ativa' and a.pago_ate is null then
    return jsonb_build_object('fase', 'ativa', 'tipo', s.tipo, 'situacao', a.situacao, 'metodo', a.metodo, 'sem_prazo', true);
  end if;

  fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
  tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
  fase := case when agora < fim then (case when a.situacao = 'teste' then 'teste' else 'ativa' end)
               when agora < tol then 'leitura'
               else 'bloqueado' end;
  return jsonb_build_object(
    'fase', fase, 'tipo', s.tipo, 'situacao', a.situacao, 'metodo', a.metodo,
    'ate', fim, 'tolerancia_ate', tol,
    'dias', greatest(0, ceil(extract(epoch from (fim - agora)) / 86400.0))::int,
    'dias_tolerancia', greatest(0, ceil(extract(epoch from (tol - agora)) / 86400.0))::int,
    'teste', a.situacao = 'teste');
end;
$$;
revoke execute on function public.acesso_do_salao(uuid) from public, anon;
grant execute on function public.acesso_do_salao(uuid) to authenticated;

create or replace function public.aceita_agendamentos(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(public.acesso_do_salao(salao) ->> 'fase', 'gratis') in ('gratis', 'configurando', 'teste', 'ativa');
$$;
grant execute on function public.aceita_agendamentos(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ativar: libera link e QR e começa a contar o teste
-- ---------------------------------------------------------------------------
create or replace function public.salao_ativar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  r jsonb := public.regras_da_assinatura();
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona ativa o salão.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  update public.salons set ativado_em = coalesce(ativado_em, now()) where id = salao;
  if s.tipo <> 'autonoma' then
    insert into public.assinaturas (salon_id, situacao, teste_ate)
    values (salao, 'teste', now() + make_interval(days => (r ->> 'teste_dias')::int))
    on conflict (salon_id) do nothing;
  end if;
  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.salao_ativar(uuid) from public, anon;
grant execute on function public.salao_ativar(uuid) to authenticated;

-- A plataforma (ou o SQL, no servidor) marca a assinatura na mão: cortesia
-- sem prazo, pagamento recebido até tal dia, ou cancelamento.
--   select public.assinatura_definir('<id do salão>', 'ativa', null, 'cortesia');
--   select public.assinatura_definir('<id do salão>', 'ativa', now() + interval '30 days', 'pix', 'pay_123');
create or replace function public.assinatura_definir(salao uuid, situacao_ text, ate timestamptz default null, metodo_ text default 'manual', referencia_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma mexe na assinatura.'; end if;
  if situacao_ not in ('teste', 'ativa', 'cancelada') then raise exception 'Situação inválida: %', situacao_; end if;
  insert into public.assinaturas (salon_id, situacao, teste_ate, pago_ate, metodo, referencia, atualizado_em)
  values (salao, situacao_, case when situacao_ = 'teste' then ate end, case when situacao_ <> 'teste' then ate end, metodo_, referencia_, now())
  on conflict (salon_id) do update set
    situacao = excluded.situacao,
    teste_ate = coalesce(excluded.teste_ate, public.assinaturas.teste_ate),
    pago_ate = case when excluded.situacao = 'teste' then public.assinaturas.pago_ate else excluded.pago_ate end,
    metodo = excluded.metodo, referencia = excluded.referencia,
    avisos = '{}'::jsonb, atualizado_em = now();
  update public.salons set ativado_em = coalesce(ativado_em, now()) where id = salao;
  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.assinatura_definir(uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.assinatura_definir(uuid, text, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Modo leitura: nenhum agendamento novo entra (link, assistente, comanda)
-- ---------------------------------------------------------------------------
create or replace function public.barrar_modo_leitura()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare sal uuid := new.salon_id; fase text;
begin
  if sal is null then select salon_id into sal from public.professionals where id = new.professional_id; end if;
  if sal is null then return new; end if;
  fase := public.acesso_do_salao(sal) ->> 'fase';
  if fase = 'leitura' then
    raise exception 'Este salão não está recebendo agendamentos novos no momento. Os horários já marcados continuam valendo.';
  elsif fase = 'bloqueado' then
    raise exception 'Este salão está pausado e não recebe agendamentos no momento.';
  end if;
  return new;
end;
$$;
drop trigger if exists zz_modo_leitura on public.appointments;
create trigger zz_modo_leitura
  before insert on public.appointments
  for each row execute function public.barrar_modo_leitura();

-- a página do salão diz se está aceitando; a cliente vê o aviso antes de tentar
create or replace function public.pagina_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', (select jsonb_build_object(
        'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'descricao', s.descricao, 'fotos', to_jsonb(s.fotos), 'logo_url', s.logo_url,
        'endereco', s.address, 'cidade', s.city, 'cep', s.cep, 'lat', s.lat, 'lng', s.lng, 'telefone', s.phone, 'whatsapp', coalesce(s.whatsapp, s.phone), 'instagram', s.instagram,
        'pagamento', public.pagamento_do_salao(s.id),
        'aceita', public.aceita_agendamentos(s.id))
      from public.salons s where s.id = salao and s.active),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
      from public.business_hours h where h.salon_id = salao),
    'nota', (select jsonb_build_object('media', round(avg(r.nota)::numeric, 1), 'quantas', count(*))
      from public.reviews r join public.professionals p on p.id = r.professional_id where p.salon_id = salao),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'foto', p.photo_url, 'bio', p.bio,
        'faz', (select coalesce(jsonb_agg(sv.name order by sv.name), '[]'::jsonb) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
        'nota', (select round(avg(r.nota)::numeric, 1) from public.reviews r where r.professional_id = p.id)
      ) order by p.name), '[]'::jsonb)
      from public.professionals p where p.salon_id = salao and p.active),
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', sv.id, 'name', sv.name, 'price', sv.price, 'duration_minutes', sv.duration_minutes, 'images', to_jsonb(sv.images),
        'description', sv.description, 'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'destaque', sv.destaque, 'a_partir', sv.a_partir,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'foto', p.photo_url, 'preco_cents', ps.preco_cents, 'duracao_minutos', ps.duracao_minutos) order by p.name), '[]'::jsonb)
                 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'capas', (select coalesce(jsonb_object_agg(k.categoria_id, to_jsonb(k.imagens)), '{}'::jsonb) from public.capas_do_salao(salao) k),
    'preferida', (select professional_id from public.profissional_preferida where client_id = auth.uid() and salon_id = salao),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
grant execute on function public.pagina_do_salao(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A rotina: começa o teste de quem demorou e avisa a dona nos marcos
-- ---------------------------------------------------------------------------
insert into public.push_regras (kind, envia) values
  ('teste_comecou', true), ('teste_acabando', true), ('modo_leitura', true), ('painel_bloqueado', true)
on conflict (kind) do nothing;
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('teste_acabando', true, 'utilidade', null), ('modo_leitura', true, 'utilidade', null), ('painel_bloqueado', true, 'utilidade', null)
on conflict (kind) do nothing;

create or replace function public.cuidar_das_assinaturas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r jsonb := public.regras_da_assinatura();
  s record;
  a record;
  quantos integer := 0;
  fim timestamptz;
  tol timestamptz;
  painel text;
begin
  -- concluiu o cadastro, não ativou em 30 dias: o teste começa sozinho
  for s in
    select x.id, x.owner_id, x.name from public.salons x
    where x.tipo <> 'autonoma' and x.active
      and x.onboarding_concluido_em is not null
      and x.onboarding_concluido_em + make_interval(days => (r ->> 'prazo_ativacao_dias')::int) <= now()
      and not exists (select 1 from public.assinaturas y where y.salon_id = x.id)
  loop
    insert into public.assinaturas (salon_id, situacao, teste_ate, avisos)
    values (s.id, 'teste', now() + make_interval(days => (r ->> 'teste_dias')::int), jsonb_build_object('comecou', now()))
    on conflict (salon_id) do nothing;
    update public.salons set ativado_em = coalesce(ativado_em, now()) where id = s.id;
    if s.owner_id is not null then
      perform public.notificar(s.owner_id, 'teste_comecou', 'Seu teste grátis começou',
        format('%s tem 7 dias grátis a partir de hoje. Cadastre os serviços e a equipe pra receber agendamentos.', s.name),
        '/admin/configurar', jsonb_build_object('salon_id', s.id));
    end if;
    quantos := quantos + 1;
  end loop;

  -- os marcos: 2 dias antes de acabar, quando acaba (modo leitura) e quando o painel pausa
  for a in
    select y.*, x.owner_id, x.name from public.assinaturas y join public.salons x on x.id = y.salon_id
    where x.active and (y.situacao = 'teste' or y.pago_ate is not null)
  loop
    fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
    if fim is null or a.owner_id is null then continue; end if;
    tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
    painel := case when a.situacao = 'teste' then 'teste' else 'assinatura' end;

    if now() >= tol and a.avisos ->> 'bloqueado' is null then
      perform public.notificar(a.owner_id, 'painel_bloqueado', 'Painel pausado',
        format('O %s de %s venceu e o painel foi pausado. Fale com a MIMO pra reativar: nada foi apagado.', painel, a.name),
        '/admin', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('bloqueado', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    elsif now() >= fim and now() < tol and a.avisos ->> 'leitura' is null then
      perform public.notificar(a.owner_id, 'modo_leitura',
        case when a.situacao = 'teste' then 'Seu teste grátis acabou' else 'Sua assinatura venceu' end,
        format('%s está em modo leitura por %s dias: os horários marcados continuam valendo, mas o link não recebe agendamento novo. Assine pra voltar a receber.', a.name, r ->> 'tolerancia_dias'),
        '/admin', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('leitura', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    elsif now() >= fim - interval '2 days' and now() < fim and a.avisos ->> 'acabando' is null then
      perform public.notificar(a.owner_id, 'teste_acabando',
        case when a.situacao = 'teste' then 'Seu teste grátis acaba em 2 dias' else 'Sua assinatura vence em 2 dias' end,
        format('%s: %s. Depois disso o link para de receber agendamento novo.',
          a.name, case when a.situacao = 'teste' then 'faltam 2 dias de teste grátis' else 'a assinatura vence em 2 dias' end),
        '/admin', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('acabando', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    end if;
  end loop;
  return quantos;
end;
$$;
revoke execute on function public.cuidar_das_assinaturas() from public, anon, authenticated;

create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  perguntas integer := 0;
  fechamentos integer := 0;
  concluidos integer := 0;
  avaliacoes integer := 0;
  reservas integer := 0;
  creditos integer := 0;
  assinaturas integer := 0;
  pagamentos jsonb := '{}'::jsonb;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    perguntas := coalesce(public.perguntar_se_veio(), 0);
  exception when others then perguntas := -1;
  end;
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  begin
    avaliacoes := coalesce(public.convidar_avaliacoes(), 0);
  exception when others then avaliacoes := -1;
  end;
  begin
    reservas := coalesce(public.expirar_reservas_nao_pagas(), 0);
  exception when others then reservas := -1;
  end;
  begin
    creditos := coalesce(public.expirar_creditos(), 0);
  exception when others then creditos := -1;
  end;
  begin
    assinaturas := coalesce(public.cuidar_das_assinaturas(), 0);
  exception when others then assinaturas := -1;
  end;
  begin
    pagamentos := public.chutar_pagamentos();
  exception when others then pagamentos := jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'avaliacoes', avaliacoes,
    'reservas_expiradas', reservas,
    'creditos_vencidos', creditos,
    'assinaturas', assinaturas,
    'pagamentos', pagamentos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;
