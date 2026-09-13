-- 086 · Destaques do salão e aprovação da promoção da profissional
--
-- 1. "Serviços em destaque" na home da cliente passam a ser escolhidos
--    pelo salão (ou pela autônoma): services.destaque.
-- 2. A profissional de um salão cria a promoção dela, mas ela só entra
--    no ar depois que a dona aprova. A autônoma é a própria dona, então
--    a dela já nasce aprovada. Qualquer edição da profissional volta
--    para a fila. A dona aprova ou recusa (com motivo) em Admin ›
--    Promoções; as duas são avisadas.

alter table public.services add column if not exists destaque boolean not null default false;
create index if not exists services_destaque_idx on public.services (salon_id) where destaque and active;

alter table public.promocoes add column if not exists aprovacao text not null default 'aprovada'
  check (aprovacao in ('aprovada', 'pendente', 'recusada'));
alter table public.promocoes add column if not exists motivo_recusa text check (motivo_recusa is null or length(motivo_recusa) <= 200);
alter table public.promocoes add column if not exists aprovada_em timestamptz;
alter table public.promocoes add column if not exists aprovada_por uuid;

-- quem administra o salão: a dona e os admins
create or replace function public.admins_do_salao(salao uuid)
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  select s.owner_id from public.salons s where s.id = salao and s.owner_id is not null
  union
  select m.user_id from public.salon_members m where m.salon_id = salao and m.papel = 'admin';
$$;
revoke execute on function public.admins_do_salao(uuid) from public, anon, authenticated;

-- antes de gravar: quem não administra o salão não decide a aprovação
create or replace function public.fila_de_aprovacao_da_promocao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare administra boolean;
begin
  administra := public.eh_plataforma() or (new.salon_id is not null and public.is_admin_do_salao(new.salon_id));
  if new.professional_id is null or administra then
    -- salão, plataforma ou a dona editando a de uma profissional: vale o que veio
    if tg_op = 'INSERT' and new.aprovacao is null then new.aprovacao := 'aprovada'; end if;
    if tg_op = 'UPDATE' and new.aprovacao is distinct from old.aprovacao then
      new.aprovada_em := now(); new.aprovada_por := auth.uid();
      if new.aprovacao <> 'recusada' then new.motivo_recusa := null; end if;
    end if;
    return new;
  end if;
  -- a profissional: nasce pendente; mexeu no conteúdo, volta para a fila
  if tg_op = 'INSERT' then
    new.aprovacao := 'pendente'; new.motivo_recusa := null; new.aprovada_em := null; new.aprovada_por := null;
  else
    new.aprovacao := old.aprovacao; new.motivo_recusa := old.motivo_recusa;
    new.aprovada_em := old.aprovada_em; new.aprovada_por := old.aprovada_por;
    if (new.titulo, new.texto, new.imagem_url, new.service_id, new.desconto_pct, new.inicio, new.fim)
       is distinct from (old.titulo, old.texto, old.imagem_url, old.service_id, old.desconto_pct, old.inicio, old.fim) then
      new.aprovacao := 'pendente'; new.motivo_recusa := null; new.aprovada_em := null; new.aprovada_por := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fila_de_aprovacao_da_promocao on public.promocoes;
create trigger fila_de_aprovacao_da_promocao before insert or update on public.promocoes
  for each row execute function public.fila_de_aprovacao_da_promocao();

-- depois de gravar: avisa a dona (pendente) ou a profissional (decidida)
create or replace function public.avisa_aprovacao_da_promocao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare quem uuid; nome_prof text; conta_prof uuid; nome_salao text;
begin
  if new.professional_id is null then return new; end if;
  select p.name, p.user_id into nome_prof, conta_prof from public.professionals p where p.id = new.professional_id;
  select s.name into nome_salao from public.salons s where s.id = new.salon_id;
  if new.aprovacao = 'pendente' and (tg_op = 'INSERT' or old.aprovacao <> 'pendente') then
    for quem in select * from public.admins_do_salao(new.salon_id) loop
      if quem <> coalesce(conta_prof, '00000000-0000-0000-0000-000000000000') then
        perform public.notificar(quem, 'promocao_pendente', coalesce(nome_prof, 'Uma profissional') || ' pediu uma promoção',
          '"' || new.titulo || '"' || case when new.desconto_pct is not null then ' com ' || new.desconto_pct || '% de desconto' else '' end
          || '. Só entra no ar depois que você aprovar.',
          '/admin/promocoes', jsonb_build_object('promocao_id', new.id, 'professional_id', new.professional_id));
      end if;
    end loop;
  elsif tg_op = 'UPDATE' and new.aprovacao <> old.aprovacao and conta_prof is not null then
    if new.aprovacao = 'aprovada' then
      perform public.notificar(conta_prof, 'promocao_aprovada', 'Promoção aprovada! 🎉',
        '"' || new.titulo || '" foi aprovada ' || coalesce('pelo ' || nome_salao, 'pelo salão') || ' e já aparece para as suas clientes.',
        '/pro/promocoes', jsonb_build_object('promocao_id', new.id));
    elsif new.aprovacao = 'recusada' then
      perform public.notificar(conta_prof, 'promocao_recusada', 'Promoção não aprovada',
        '"' || new.titulo || '" não foi aprovada' || coalesce(': ' || new.motivo_recusa, '') || '. Ajuste e envie de novo, se quiser.',
        '/pro/promocoes', jsonb_build_object('promocao_id', new.id));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists avisa_aprovacao_da_promocao on public.promocoes;
create trigger avisa_aprovacao_da_promocao after insert or update on public.promocoes
  for each row execute function public.avisa_aprovacao_da_promocao();

-- só a aprovada aparece para a cliente
create or replace function public.promocoes_visiveis_para(cliente uuid)
returns setof public.promocoes
language sql
stable
security definer set search_path = public
as $$
  with minhas_profs as (
    select f.professional_id from public.client_favorites f where f.client_id = cliente
    union
    select a.professional_id from public.appointments a where a.client_id = cliente and a.professional_id is not null
    union
    select v.trazida_por from public.vinculos v where v.client_id = cliente and v.saiu_em is null and v.trazida_por is not null
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v where v.client_id = cliente and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id
  ),
  hoje as (select (public.agora_local())::date as d)
  select pr.*
  from public.promocoes pr
  cross join hoje
  left join public.professionals p on p.id = pr.professional_id
  where cliente is not null
    and pr.ativa and pr.aprovacao = 'aprovada' and pr.inicio <= hoje.d and (pr.fim is null or pr.fim >= hoje.d)
    and (p.id is null or p.active)
    and (pr.salon_id is null
         or (pr.professional_id is not null and pr.professional_id in (select professional_id from minhas_profs))
         or (pr.professional_id is null and pr.salon_id in (select salon_id from meus_saloes)));
$$;

-- os destaques da home: o que os salões da cliente marcaram
create or replace function public.destaques_para_mim()
returns table (id uuid, name text, price numeric, duration_minutes integer, images text[], is_combo boolean, salon_id uuid, salao text, quem jsonb)
language sql
stable
security definer set search_path = public
as $$
  select sv.id, sv.name, sv.price, sv.duration_minutes, sv.images, sv.is_combo, sv.salon_id, s.name,
         (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
            from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active
           where ps.service_id = sv.id)
  from public.services sv
  join public.salons s on s.id = sv.salon_id and s.active
  where sv.active and sv.destaque
    and sv.salon_id in (select v.salon_id from public.vinculos v where v.client_id = auth.uid() and v.saiu_em is null)
  order by s.name, sv.name
  limit 12;
$$;
revoke execute on function public.destaques_para_mim() from public, anon;
grant execute on function public.destaques_para_mim() to authenticated;

-- push dos avisos novos
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.promocao_pendente', 'push', 'Promoção para aprovar', 'Uma profissional do salão pediu uma promoção; a dona decide.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 815,
  '{"titulo":"Ana pediu uma promoção","texto":"“Esmaltação em gel com 20% off” com 20% de desconto. Só entra no ar depois que você aprovar."}'),
('push.promocao_aprovada', 'push', 'Promoção aprovada', 'A dona aprovou a promoção da profissional.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 816,
  '{"titulo":"Promoção aprovada! 🎉","texto":"“Esmaltação em gel com 20% off” foi aprovada pelo Studio Mel e já aparece para as suas clientes."}'),
('push.promocao_recusada', 'push', 'Promoção não aprovada', 'A dona não aprovou a promoção da profissional.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 817,
  '{"titulo":"Promoção não aprovada","texto":"“Esmaltação em gel com 20% off” não foi aprovada: desconto alto demais. Ajuste e envie de novo, se quiser."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('promocao_pendente', true), ('promocao_aprovada', true), ('promocao_recusada', true) on conflict (kind) do nothing;
