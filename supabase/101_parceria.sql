-- 101 · Contrato de parceria (Lei 13.352/2016): a fase A.
--
-- O salão formaliza a relação com cada profissional pelo app: dados das
-- partes, os termos que a lei manda constar (cotas, retenção, repasse,
-- materiais, rescisão com aviso prévio, responsabilidades), o contrato
-- em PDF gerado no aparelho, o envio (o app dela e e-mail; WhatsApp fica
-- para depois),
-- a assinatura (pelo app, ou o PDF assinado no gov.br/cartório de
-- volta), a homologação no sindicato e o encerramento.
--
-- A situação é derivada dos fatos (gatilho): rascunho → enviado →
-- assinado (as duas partes) → vigente (assinado e homologado) → encerrado.
-- "Assinado sem homologação" fica em 'assinado', de propósito: o painel
-- mostra como pendência, não como contrato pronto.

-- 1. Dados fiscais do salão, para o contrato ----------------------------------------------
alter table public.salons
  add column if not exists cnpj text,
  add column if not exists razao_social text,
  add column if not exists responsavel_nome text,
  add column if not exists responsavel_cpf text;
grant update (cnpj, razao_social, responsavel_nome, responsavel_cpf) on public.salons to authenticated;

-- 2. A tabela ----------------------------------------------------------------------------------
create table if not exists public.parcerias (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'assinado', 'vigente', 'encerrado')),

  -- os termos
  inicio date not null default current_date,
  cota_pct numeric(5,2) not null default 50 check (cota_pct > 0 and cota_pct < 100),   -- a parte da profissional
  base_calculo text not null default 'bruto' check (base_calculo in ('bruto', 'liquido')),
  excecoes jsonb not null default '[]'::jsonb,                                             -- [{nome, cota_pct}] por serviço/categoria
  periodicidade text not null default 'semanal' check (periodicidade in ('semanal', 'quinzenal', 'mensal')),
  dia_repasse text,
  materiais text not null default 'salao' check (materiais in ('salao', 'profissional', 'misto')),
  materiais_detalhe text,
  retencao text not null default 'profissional' check (retencao in ('salao', 'profissional')),
  aviso_previo_dias integer not null default 30 check (aviso_previo_dias >= 30),
  funcoes text,
  horario text,
  sindicato text,
  observacoes text,

  -- as partes, congeladas no contrato
  salao_dados jsonb not null default '{}'::jsonb,
  prof_dados jsonb not null default '{}'::jsonb,
  testemunhas jsonb not null default '[]'::jsonb,

  -- o documento
  versao_modelo text,
  conteudo jsonb,                 -- os blocos do contrato, como foram para o PDF
  pdf_path text,
  pdf_hash text,
  gerado_em timestamptz,
  enviado_em timestamptz,
  enviado_por text[] not null default '{}',

  -- assinaturas: [{parte, modo, em, user_id, nome, cpf, hash, arquivo}]
  assinaturas jsonb not null default '[]'::jsonb,
  assinado_pdf_path text,

  -- homologação
  homologacao text not null default 'pendente' check (homologacao in ('pendente', 'homologado', 'nao_obtida', 'dispensada')),
  homologacao_em date,
  homologacao_orgao text,
  homologacao_motivo text,
  homologacao_path text,

  -- encerramento
  encerrado_em date,
  encerramento_motivo text,
  encerramento_aviso_em date,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.parcerias is 'Contrato de parceria salão-parceiro / profissional-parceira (Lei 13.352/2016). Um aberto por profissional.';

-- um contrato aberto por profissional
create unique index if not exists parcerias_uma_aberta on public.parcerias (professional_id) where status <> 'encerrado';
create index if not exists parcerias_salao on public.parcerias (salon_id, status);

alter table public.parcerias enable row level security;
drop policy if exists "dona ve parcerias" on public.parcerias;
create policy "dona ve parcerias" on public.parcerias for select to authenticated
  using (public.is_admin_do_salao(salon_id) or public.eh_plataforma()
         or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = auth.uid()));
drop policy if exists "dona cria parceria" on public.parcerias;
create policy "dona cria parceria" on public.parcerias for insert to authenticated
  with check (public.is_admin_do_salao(salon_id)
              and exists (select 1 from public.professionals p where p.id = professional_id and p.salon_id = salon_id));
drop policy if exists "dona edita parceria" on public.parcerias;
create policy "dona edita parceria" on public.parcerias for update to authenticated
  using (public.is_admin_do_salao(salon_id)) with check (public.is_admin_do_salao(salon_id));
drop policy if exists "dona apaga rascunho" on public.parcerias;
create policy "dona apaga rascunho" on public.parcerias for delete to authenticated
  using (public.is_admin_do_salao(salon_id) and status = 'rascunho');
grant select, insert, update, delete on public.parcerias to authenticated;

-- 3. A situação segue os fatos ---------------------------------------------------------------
create or replace function public.parceria_assinada_por(assinaturas jsonb, parte text)
returns boolean
language sql
immutable
as $$
  select exists (select 1 from jsonb_array_elements(coalesce(assinaturas, '[]'::jsonb)) a where a ->> 'parte' = parte);
$$;

create or replace function public.parceria_status_auto()
returns trigger
language plpgsql
as $$
declare ambas boolean;
begin
  new.atualizado_em := now();
  ambas := public.parceria_assinada_por(new.assinaturas, 'profissional') and public.parceria_assinada_por(new.assinaturas, 'salao');
  if new.encerrado_em is not null then new.status := 'encerrado';
  elsif ambas and new.homologacao = 'homologado' then new.status := 'vigente';
  elsif ambas then new.status := 'assinado';
  elsif new.enviado_em is not null then new.status := 'enviado';
  else new.status := 'rascunho';
  end if;
  -- rascunho não carrega assinatura nem envio
  if new.status = 'rascunho' then new.assinaturas := '[]'::jsonb; end if;
  return new;
end;
$$;
drop trigger if exists tg_parceria_status on public.parcerias;
create trigger tg_parceria_status before insert or update on public.parcerias
  for each row execute function public.parceria_status_auto();

-- 4. Os arquivos: bucket privado, pasta <salao>/<parceria>/ ---------------------------------
insert into storage.buckets (id, name, public) values ('contratos', 'contratos', false) on conflict (id) do nothing;

create or replace function public.pode_ver_contrato(caminho text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.parcerias pr
    where pr.id::text = (storage.foldername(caminho))[2]
      and pr.salon_id::text = (storage.foldername(caminho))[1]
      and (public.is_admin_do_salao(pr.salon_id) or public.eh_plataforma()
           or exists (select 1 from public.professionals p where p.id = pr.professional_id and p.user_id = auth.uid()))
  );
$$;
revoke execute on function public.pode_ver_contrato(text) from public, anon;
grant execute on function public.pode_ver_contrato(text) to authenticated;

drop policy if exists "contrato: quem e da parceria ve" on storage.objects;
create policy "contrato: quem e da parceria ve" on storage.objects for select to authenticated
  using (bucket_id = 'contratos' and public.pode_ver_contrato(name));
drop policy if exists "contrato: quem e da parceria envia" on storage.objects;
create policy "contrato: quem e da parceria envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'contratos' and public.pode_ver_contrato(name));
drop policy if exists "contrato: dona troca" on storage.objects;
create policy "contrato: dona troca" on storage.objects for update to authenticated
  using (bucket_id = 'contratos' and public.is_admin_do_salao(((storage.foldername(name))[1])::uuid));
drop policy if exists "contrato: dona remove" on storage.objects;
create policy "contrato: dona remove" on storage.objects for delete to authenticated
  using (bucket_id = 'contratos' and public.is_admin_do_salao(((storage.foldername(name))[1])::uuid));

-- 5. Enviar: congela e avisa a profissional --------------------------------------------------
create or replace function public.parceria_enviar(parceria uuid, canais text[] default '{app,email}')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare pr public.parcerias%rowtype; p public.professionals%rowtype; s public.salons%rowtype; texto text;
begin
  select * into pr from public.parcerias where id = parceria;
  if pr.id is null then raise exception 'Contrato não encontrado.'; end if;
  if not public.is_admin_do_salao(pr.salon_id) then raise exception 'Só a dona do salão envia o contrato.'; end if;
  if pr.status not in ('rascunho', 'enviado') then raise exception 'Este contrato já foi assinado; para mudar os termos, encerre e faça outro.'; end if;
  if pr.pdf_path is null or pr.pdf_hash is null then raise exception 'Gere o PDF antes de enviar.'; end if;
  select * into p from public.professionals where id = pr.professional_id;
  select * into s from public.salons where id = pr.salon_id;

  update public.parcerias set enviado_em = coalesce(enviado_em, now()), enviado_por = canais where id = parceria;

  if p.user_id is not null and ('app' = any(canais) or 'whatsapp' = any(canais) or 'email' = any(canais)) then
    texto := s.name || ' preparou o seu contrato de parceria: ' || to_char(pr.cota_pct, 'FM990D00') || '% do valor de cada serviço para você'
          || ', repasse ' || pr.periodicidade || ', a partir de ' || to_char(pr.inicio, 'DD/MM/YYYY')
          || '. Leia com calma e, se estiver de acordo, assine pelo app ou pelo gov.br.';
    perform public.notificar(p.user_id, 'contrato_parceria', 'Seu contrato de parceria chegou', texto, '/pro/contrato',
      jsonb_build_object('professional_id', p.id, 'parceria_id', pr.id));
  end if;
  return jsonb_build_object('ok', true, 'tem_login', p.user_id is not null, 'telefone', p.phone);
end;
$$;
revoke execute on function public.parceria_enviar(uuid, text[]) from public, anon;
grant execute on function public.parceria_enviar(uuid, text[]) to authenticated;

-- voltar ao rascunho para mudar os termos (só antes de as duas assinarem)
create or replace function public.parceria_voltar_rascunho(parceria uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare pr public.parcerias%rowtype;
begin
  select * into pr from public.parcerias where id = parceria;
  if pr.id is null then raise exception 'Contrato não encontrado.'; end if;
  if not public.is_admin_do_salao(pr.salon_id) then raise exception 'Só a dona do salão mexe no contrato.'; end if;
  if pr.status not in ('enviado') then raise exception 'Só um contrato enviado e ainda não assinado pelas duas partes volta a rascunho.'; end if;
  update public.parcerias set enviado_em = null, enviado_por = '{}', assinaturas = '[]'::jsonb, pdf_path = null, pdf_hash = null, gerado_em = null, conteudo = null
   where id = parceria;
end;
$$;
revoke execute on function public.parceria_voltar_rascunho(uuid) from public, anon;
grant execute on function public.parceria_voltar_rascunho(uuid) to authenticated;

-- 6. Assinar ------------------------------------------------------------------------------------
-- Quem chama define a parte: a profissional (dona do login da ficha) ou a
-- dona do salão. `modo` = app (aceite eletrônico no MIMO, exige o hash do
-- PDF lido), govbr, cartorio ou outro (o PDF assinado sobe junto).
create or replace function public.parceria_assinar(parceria uuid, modo text, hash text default null, arquivo text default null, parte_forcada text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  pr public.parcerias%rowtype; p public.professionals%rowtype; s public.salons%rowtype;
  parte text; quem record; assin jsonb; q record; ambas boolean;
begin
  select * into pr from public.parcerias where id = parceria;
  if pr.id is null then raise exception 'Contrato não encontrado.'; end if;
  select * into p from public.professionals where id = pr.professional_id;
  select * into s from public.salons where id = pr.salon_id;
  if modo not in ('app', 'govbr', 'cartorio', 'outro') then raise exception 'Modo de assinatura desconhecido.'; end if;

  if p.user_id = auth.uid() then parte := 'profissional';
  elsif public.is_admin_do_salao(pr.salon_id) then
    -- a dona registra a própria assinatura; e, com o PDF assinado fora do app, pode registrar a da profissional
    parte := case when parte_forcada = 'profissional' and modo <> 'app' then 'profissional' else 'salao' end;
  else raise exception 'Você não é parte deste contrato.'; end if;

  if pr.status not in ('enviado', 'assinado', 'vigente') then raise exception 'O contrato precisa ser enviado antes de assinar.'; end if;
  if public.parceria_assinada_por(pr.assinaturas, parte) then raise exception 'Esta parte já assinou.'; end if;
  if modo = 'app' and (hash is null or hash <> pr.pdf_hash) then
    raise exception 'O documento lido não bate com o contrato enviado. Abra o contrato de novo e tente outra vez.';
  end if;
  if modo <> 'app' and arquivo is null and pr.assinado_pdf_path is null then
    raise exception 'Envie o PDF assinado junto.';
  end if;

  select pf.full_name, pf.cpf into quem from public.profiles pf where pf.id = auth.uid();
  assin := jsonb_build_object('parte', parte, 'modo', modo, 'em', now(), 'user_id', auth.uid(),
             'nome', coalesce(quem.full_name, case when parte = 'salao' then s.name else p.name end),
             'cpf', case when parte = 'profissional' then coalesce(pr.prof_dados ->> 'cpf', quem.cpf) else coalesce(pr.salao_dados ->> 'responsavel_cpf', quem.cpf) end,
             'hash', pr.pdf_hash, 'arquivo', arquivo);
  update public.parcerias
     set assinaturas = assinaturas || jsonb_build_array(assin),
         assinado_pdf_path = coalesce(arquivo, assinado_pdf_path)
   where id = parceria
   returning * into pr;
  ambas := pr.status in ('assinado', 'vigente');

  -- avisos: a profissional assinou → a casa sabe; as duas → a profissional sabe que fechou
  if parte = 'profissional' then
    for q in select m.user_id from public.salon_members m where m.salon_id = pr.salon_id and m.papel = 'admin' and m.user_id <> p.user_id loop
      perform public.notificar(q.user_id, 'contrato_assinado', p.name || ' assinou o contrato de parceria',
        case when ambas then 'As duas partes assinaram. Falta só a homologação no sindicato, se for o caso.' else 'Agora é a sua vez: assine pelo app em Equipe › ' || p.name || ' › Parceria.' end,
        '/admin/equipe/' || p.id || '/parceria', jsonb_build_object('professional_id', p.id, 'parceria_id', pr.id));
    end loop;
  elsif ambas and p.user_id is not null then
    perform public.notificar(p.user_id, 'contrato_completo', 'Contrato de parceria assinado pelas duas partes',
      'O contrato com ' || s.name || ' está assinado. Você pode baixar o PDF quando quiser em Ajustes › Meu contrato.',
      '/pro/contrato', jsonb_build_object('professional_id', p.id, 'parceria_id', pr.id));
  end if;
  return jsonb_build_object('ok', true, 'parte', parte, 'status', pr.status);
end;
$$;
revoke execute on function public.parceria_assinar(uuid, text, text, text, text) from public, anon;
grant execute on function public.parceria_assinar(uuid, text, text, text, text) to authenticated;

-- 7. Homologar e encerrar --------------------------------------------------------------------------
create or replace function public.parceria_homologar(parceria uuid, situacao text, em date default null, orgao text default null, motivo text default null, arquivo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare pr public.parcerias%rowtype;
begin
  select * into pr from public.parcerias where id = parceria;
  if pr.id is null then raise exception 'Contrato não encontrado.'; end if;
  if not public.is_admin_do_salao(pr.salon_id) then raise exception 'Só a dona do salão registra a homologação.'; end if;
  if situacao not in ('pendente', 'homologado', 'nao_obtida', 'dispensada') then raise exception 'Situação desconhecida.'; end if;
  if situacao = 'homologado' and pr.status not in ('assinado', 'vigente') then raise exception 'Homologa-se um contrato assinado pelas duas partes.'; end if;
  update public.parcerias
     set homologacao = situacao, homologacao_em = case when situacao = 'homologado' then coalesce(em, current_date) else em end,
         homologacao_orgao = orgao, homologacao_motivo = motivo, homologacao_path = coalesce(arquivo, homologacao_path)
   where id = parceria returning * into pr;
  return jsonb_build_object('ok', true, 'status', pr.status);
end;
$$;
revoke execute on function public.parceria_homologar(uuid, text, date, text, text, text) from public, anon;
grant execute on function public.parceria_homologar(uuid, text, date, text, text, text) to authenticated;

create or replace function public.parceria_encerrar(parceria uuid, em date, motivo text default null, aviso_em date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare pr public.parcerias%rowtype; p public.professionals%rowtype;
begin
  select * into pr from public.parcerias where id = parceria;
  if pr.id is null then raise exception 'Contrato não encontrado.'; end if;
  if not public.is_admin_do_salao(pr.salon_id) then raise exception 'Só a dona do salão encerra o contrato.'; end if;
  if pr.status = 'encerrado' then raise exception 'Este contrato já está encerrado.'; end if;
  update public.parcerias set encerrado_em = em, encerramento_motivo = motivo, encerramento_aviso_em = aviso_em where id = parceria returning * into pr;
  select * into p from public.professionals where id = pr.professional_id;
  if p.user_id is not null and pr.enviado_em is not null then
    perform public.notificar(p.user_id, 'contrato_encerrado', 'Contrato de parceria encerrado',
      'O contrato de parceria termina em ' || to_char(em, 'DD/MM/YYYY') || coalesce('. Motivo: ' || motivo, '') || '. O histórico fica guardado em Ajustes › Meu contrato.',
      '/pro/contrato', jsonb_build_object('professional_id', p.id, 'parceria_id', pr.id));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.parceria_encerrar(uuid, date, text, date) from public, anon;
grant execute on function public.parceria_encerrar(uuid, date, text, date) to authenticated;

-- 8. Consultas -------------------------------------------------------------------------------------
-- a profissional: o contrato dela (o aberto; senão, o último)
create or replace function public.minha_parceria()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select to_jsonb(pr) || jsonb_build_object('salao_nome', s.name, 'profissional_nome', p.name)
  from public.parcerias pr
  join public.professionals p on p.id = pr.professional_id
  join public.salons s on s.id = pr.salon_id
  where p.user_id = auth.uid()
  order by (pr.status <> 'encerrado') desc, pr.criado_em desc
  limit 1;
$$;
revoke execute on function public.minha_parceria() from public, anon;
grant execute on function public.minha_parceria() to authenticated;

-- a dona: a situação de cada profissional ativa (para a Equipe e o painel)
create or replace function public.parcerias_da_equipe(salao uuid)
returns table (professional_id uuid, nome text, parceria_id uuid, status text, homologacao text, inicio date, enviado_em timestamptz, assinou_profissional boolean, assinou_salao boolean)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.name, pr.id, coalesce(pr.status, 'sem_contrato'), pr.homologacao, pr.inicio, pr.enviado_em,
         public.parceria_assinada_por(pr.assinaturas, 'profissional'), public.parceria_assinada_por(pr.assinaturas, 'salao')
  from public.professionals p
  left join public.parcerias pr on pr.professional_id = p.id and pr.status <> 'encerrado'
  where p.salon_id = salao and p.active
    and (public.is_admin_do_salao(salao) or public.eh_plataforma())
    -- a dona autônoma não faz contrato consigo mesma
    and not exists (select 1 from public.salons s where s.id = salao and s.tipo = 'autonoma' and s.owner_id = p.user_id)
  order by p.name;
$$;
revoke execute on function public.parcerias_da_equipe(uuid) from public, anon;
grant execute on function public.parcerias_da_equipe(uuid) to authenticated;

-- 9. Avisos: modelos e regras ------------------------------------------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.contrato_parceria', 'push', 'Contrato de parceria chegou', 'O salão enviou o contrato de parceria para a profissional ler e assinar.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 830,
  '{"titulo":"Seu contrato de parceria chegou","texto":"Studio Mel preparou o seu contrato de parceria: 60% do valor de cada serviço para você, repasse semanal, a partir de 01/10/2026. Leia com calma e, se estiver de acordo, assine pelo app ou pelo gov.br."}'),
('push.contrato_assinado', 'push', 'Profissional assinou o contrato', 'Vai para a dona quando a profissional assina.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 831,
  '{"titulo":"Ana Oliveira assinou o contrato de parceria","texto":"Agora é a sua vez: assine pelo app em Equipe › Ana Oliveira › Parceria."}'),
('push.contrato_completo', 'push', 'Contrato assinado pelas duas partes', 'Vai para a profissional quando as duas assinaturas estão no contrato.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 832,
  '{"titulo":"Contrato de parceria assinado pelas duas partes","texto":"O contrato com Studio Mel está assinado. Você pode baixar o PDF quando quiser em Ajustes › Meu contrato."}'),
('push.contrato_encerrado', 'push', 'Contrato encerrado', 'Vai para a profissional quando a dona encerra a parceria.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 833,
  '{"titulo":"Contrato de parceria encerrado","texto":"O contrato de parceria termina em 31/10/2026. O histórico fica guardado em Ajustes › Meu contrato."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('contrato_parceria', true), ('contrato_assinado', true), ('contrato_completo', true), ('contrato_encerrado', true) on conflict (kind) do nothing;
insert into public.email_regras (kind, envia, chamada) values ('contrato_parceria', true, 'Ler o contrato'), ('contrato_completo', true, 'Ver meu contrato') on conflict (kind) do nothing;
