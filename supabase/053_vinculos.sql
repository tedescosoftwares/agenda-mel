-- =============================================================
-- MIMO — 053: o vínculo — a cliente só enxerga quem a trouxe
--
-- Até aqui a cliente era livre no marketplace: abria o app e via
-- todas as profissionais de todos os salões. O modelo agora é outro,
-- e é o que protege quem trabalha:
--
--   • uma cliente só vê as agendas dos salões em que ENTROU
--   • entra por um código curto (ANA7K2) — em QR, em link, digitado
--   • o código é de uma profissional OU do salão; o vínculo é sempre
--     com o SALÃO, e registra quem trouxe
--   • autônoma é um salão de uma pessoa só: mesmo modelo, mesma regra
--   • profissional que sai do salão não leva vínculo nenhum: a carteira
--     é da casa (e é da autônoma, quando ela é a casa)
--   • sem vínculo não há brecha: a RLS de professionals recusa, não é
--     só a tela que esconde
--
-- O vínculo nasce por sete caminhos e todos passam por uma função:
--   qr | link | codigo    a cliente agiu (tela "Entrar numa agenda")
--   cadastro              o código veio junto do cadastro, nos metadados
--                         da conta — gravado no servidor, não se perde
--   vitrine/agendamento   marcou por /p/<slug> ou pelo app
--   encaixe               a profissional encaixou pelo telefone; ela se
--                         cadastrou depois com o mesmo número
--   whatsapp              marcou pelo bot (vira 'agendamento')
-- =============================================================

-- 1. Códigos curtos ----------------------------------------------------------
-- Seis letras sem 0/O/1/I, únicas entre profissionais E salões: um código
-- resolve para uma coisa só, sem precisar dizer de quem é.
create or replace function public.gerar_codigo_curto()
returns text
language plpgsql
volatile
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.professionals where codigo = c)
         and not exists (select 1 from public.salons where codigo = c);
  end loop;
  return c;
end;
$$;

alter table public.salons add column if not exists codigo text unique;
alter table public.salons add column if not exists tipo text not null default 'salao';
do $$ begin
  alter table public.salons add constraint salons_tipo_conhecido check (tipo in ('salao', 'autonoma'));
exception when duplicate_object then null; end $$;
alter table public.professionals add column if not exists codigo text unique;

update public.salons set codigo = public.gerar_codigo_curto() where codigo is null;
update public.professionals set codigo = public.gerar_codigo_curto() where codigo is null;

create or replace function public.poe_codigo_curto()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null then new.codigo := public.gerar_codigo_curto(); end if;
  return new;
end;
$$;

drop trigger if exists tg_codigo_salao on public.salons;
create trigger tg_codigo_salao before insert on public.salons
  for each row execute function public.poe_codigo_curto();
drop trigger if exists tg_codigo_profissional on public.professionals;
create trigger tg_codigo_profissional before insert on public.professionals
  for each row execute function public.poe_codigo_curto();

-- o código é público por natureza (está no QR): anon pode ler
grant select (codigo) on public.professionals to anon, authenticated;

-- 2. A tabela -------------------------------------------------------------------
create table if not exists public.vinculos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  -- quem trouxe: a profissional do código, ou null = o próprio salão
  trazida_por uuid references public.professionals (id) on delete set null,
  como text not null default 'codigo'
    check (como in ('qr', 'link', 'codigo', 'cadastro', 'vitrine', 'agendamento', 'encaixe', 'whatsapp')),
  criado_em timestamptz not null default now(),
  saiu_em timestamptz,
  unique (client_id, salon_id)
);

create index if not exists vinculos_salao_idx on public.vinculos (salon_id) where saiu_em is null;
create index if not exists vinculos_trazida_idx on public.vinculos (trazida_por) where saiu_em is null;

alter table public.vinculos enable row level security;

drop policy if exists "cada uma ve seus vinculos" on public.vinculos;
create policy "cada uma ve seus vinculos"
  on public.vinculos for select
  to authenticated
  using (client_id = auth.uid()
         or public.is_admin_do_salao(salon_id)
         or exists (select 1 from public.professionals p
                    where p.salon_id = vinculos.salon_id and p.user_id = auth.uid()));

-- escrita só pelas funções abaixo
revoke insert, update, delete, truncate, references, trigger on public.vinculos
  from anon, authenticated;

-- 3. Perguntas que a RLS faz -----------------------------------------------------
create or replace function public.tem_vinculo(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.vinculos v
                 where v.client_id = auth.uid() and v.salon_id = salao and v.saiu_em is null);
$$;

-- equipe de qualquer salão: dona, admin ou profissional com conta
create or replace function public.eh_equipe()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.salon_members m where m.user_id = auth.uid())
    or exists (select 1 from public.professionals p where p.user_id = auth.uid())
    or exists (select 1 from public.salons s where s.owner_id = auth.uid()));
$$;

grant execute on function public.tem_vinculo(uuid) to anon, authenticated;
grant execute on function public.eh_equipe() to anon, authenticated;

-- 4. A trava: sem vínculo, a cliente logada não vê profissional nenhuma ------------
-- Anônima continua vendo as ativas: é a vitrine pública (/p/<slug>), a porta
-- de entrada. Logada e sem vínculo, a lista vem vazia — do banco, não da tela.
drop policy if exists "ver profissionais" on public.professionals;
create policy "ver profissionais"
  on public.professionals for select
  to anon, authenticated
  using (
    (active and (auth.uid() is null or public.eh_equipe() or public.tem_vinculo(salon_id)))
    or public.is_admin_do_salao(salon_id)
    or user_id = auth.uid()
  );

-- 5. Criar o vínculo (por dentro) ------------------------------------------------
create or replace function public.vincular_interno(cliente uuid, salao uuid, prof uuid, jeito text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v public.vinculos%rowtype;
  novo boolean := false;
begin
  select * into v from public.vinculos where client_id = cliente and salon_id = salao;
  if not found then
    insert into public.vinculos (client_id, salon_id, trazida_por, como)
    values (cliente, salao, prof, coalesce(jeito, 'codigo'))
    returning * into v;
    novo := true;
  elsif v.saiu_em is not null then
    -- voltou: reabre, e a atribuição de quem trouxe fica a original
    update public.vinculos set saiu_em = null where id = v.id returning * into v;
    novo := true;
  end if;
  return jsonb_build_object('id', v.id, 'novo', novo, 'trazida_por', v.trazida_por);
end;
$$;

revoke execute on function public.vincular_interno(uuid, uuid, uuid, text) from public, anon, authenticated;

-- 6. O que um código significa (público: vai na tela antes do login) -------------
create or replace function public.resolver_codigo(chave text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
        'tipo', 'profissional', 'codigo', p.codigo,
        'nome', p.name, 'foto', p.photo_url, 'especialidade', p.especialidade,
        'profissional_id', p.id,
        'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city,
                                    'tipo', s.tipo, 'logo', s.logo_url))
     from public.professionals p join public.salons s on s.id = p.salon_id
     where p.codigo = upper(btrim(chave)) and p.active and s.active),
    (select jsonb_build_object(
        'tipo', 'salao', 'codigo', s.codigo,
        'nome', s.name, 'foto', s.logo_url, 'especialidade', null,
        'profissional_id', null,
        'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city,
                                    'tipo', s.tipo, 'logo', s.logo_url))
     from public.salons s
     where s.codigo = upper(btrim(chave)) and s.active));
$$;

grant execute on function public.resolver_codigo(text) to anon, authenticated;

-- 7. Vincular (a cliente logada) ------------------------------------------------------
create or replace function public.vincular(codigo text, jeito text default 'codigo')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  alvo jsonb;
  r jsonb;
  quem text;
begin
  if auth.uid() is null then
    raise exception 'entre na sua conta primeiro';
  end if;
  if public.eh_equipe() then
    raise exception 'Você está logada como equipe. Saia da conta e entre como cliente.';
  end if;

  alvo := public.resolver_codigo(codigo);
  if alvo is null then
    return jsonb_build_object('ok', false, 'motivo', 'código não encontrado. Confere as seis letras?');
  end if;

  r := public.vincular_interno(auth.uid(), (alvo -> 'salao' ->> 'id')::uuid,
                               (alvo ->> 'profissional_id')::uuid,
                               case when jeito in ('qr', 'link', 'codigo') then jeito else 'codigo' end);

  select p.name into quem from public.professionals p where p.id = (r ->> 'trazida_por')::uuid;

  return jsonb_build_object('ok', true,
    'novo', (r ->> 'novo')::boolean,
    'salao', alvo -> 'salao',
    'trazida_por', quem,
    'tipo', alvo ->> 'tipo');
end;
$$;

revoke execute on function public.vincular(text, text) from public, anon;
grant execute on function public.vincular(text, text) to authenticated;

-- sair de uma agenda (a cliente) e desvincular uma cliente (o salão)
create or replace function public.sair_da_agenda(salao uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.vinculos set saiu_em = now()
  where client_id = auth.uid() and salon_id = salao and saiu_em is null;
$$;

create or replace function public.desvincular_cliente(salao uuid, cliente uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'só o salão desvincula';
  end if;
  update public.vinculos set saiu_em = now()
  where client_id = cliente and salon_id = salao and saiu_em is null;
end;
$$;

revoke execute on function public.sair_da_agenda(uuid) from public, anon;
grant execute on function public.sair_da_agenda(uuid) to authenticated;
revoke execute on function public.desvincular_cliente(uuid, uuid) from public, anon;
grant execute on function public.desvincular_cliente(uuid, uuid) to authenticated;

-- 8. O que a cliente vê: suas agendas, agrupadas por salão ---------------------------
create or replace function public.minhas_agendas()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'tipo', s.tipo,
                                'cidade', s.city, 'logo', s.logo_url, 'codigo', s.codigo),
    'entrou_em', v.criado_em,
    'como', v.como,
    'trazida_por', (select jsonb_build_object('id', p.id, 'nome', p.name, 'ativa', p.active)
                    from public.professionals p where p.id = v.trazida_por),
    'profissionais', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', p.id, 'nome', p.name, 'foto', p.photo_url,
                        'especialidade', p.especialidade, 'slug', p.slug)
                        order by p.name), '[]'::jsonb)
                      from public.professionals p
                      where p.salon_id = s.id and p.active)
  ) order by v.criado_em), '[]'::jsonb)
  from public.vinculos v
  join public.salons s on s.id = v.salon_id
  where v.client_id = auth.uid() and v.saiu_em is null and s.active;
$$;

revoke execute on function public.minhas_agendas() from public, anon;
grant execute on function public.minhas_agendas() to authenticated;

-- 9. O que o salão vê: suas clientes, quem trouxe, por onde entrou, com quem faz ----
create or replace function public.clientes_do_salao(salao uuid)
returns table (
  client_id uuid,
  nome text,
  telefone text,
  entrou_em timestamptz,
  como text,
  trazida_por text,
  trazida_por_ativa boolean,
  servico_de_entrada text,
  com_quem text,
  atendimentos integer,
  ultima_visita date
)
language sql
stable
security definer set search_path = public
as $$
  select v.client_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Sem nome'),
         pf.phone,
         v.criado_em,
         v.como,
         tp.name,
         coalesce(tp.active, false),
         (select coalesce(a.service_name, sv.name)
          from public.appointments a left join public.services sv on sv.id = a.service_id
          where a.client_id = v.client_id and a.salon_id = salao and a.status <> 'cancelado'
          order by a.date, a.start_time limit 1),
         (select p2.name
          from public.appointments a join public.professionals p2 on p2.id = a.professional_id
          where a.client_id = v.client_id and a.salon_id = salao and a.status = 'concluido'
          group by p2.name order by count(*) desc, max(a.date) desc limit 1),
         (select count(*)::integer from public.appointments a
          where a.client_id = v.client_id and a.salon_id = salao and a.status = 'concluido'),
         (select max(a.date) from public.appointments a
          where a.client_id = v.client_id and a.salon_id = salao and a.status = 'concluido')
  from public.vinculos v
  join public.profiles pf on pf.id = v.client_id
  left join public.professionals tp on tp.id = v.trazida_por
  where v.salon_id = salao and v.saiu_em is null
    and public.is_admin_do_salao(salao)
  order by v.criado_em desc;
$$;

revoke execute on function public.clientes_do_salao(uuid) from public, anon;
grant execute on function public.clientes_do_salao(uuid) to authenticated;

-- 10. O que a profissional vê: quem ela trouxe ------------------------------------------
create or replace function public.minhas_trazidas()
returns table (
  client_id uuid,
  nome text,
  entrou_em timestamptz,
  como text,
  ultima_visita date
)
language sql
stable
security definer set search_path = public
as $$
  select v.client_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Sem nome'),
         v.criado_em,
         v.como,
         (select max(a.date) from public.appointments a
          where a.client_id = v.client_id and a.salon_id = v.salon_id and a.status = 'concluido')
  from public.vinculos v
  join public.profiles pf on pf.id = v.client_id
  join public.professionals p on p.id = v.trazida_por
  where p.user_id = auth.uid() and v.saiu_em is null
  order by v.criado_em desc;
$$;

revoke execute on function public.minhas_trazidas() from public, anon;
grant execute on function public.minhas_trazidas() to authenticated;

-- código novo (o antigo morre na hora)
create or replace function public.novo_codigo()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c text := public.gerar_codigo_curto();
  n integer;
begin
  update public.professionals set codigo = c where user_id = auth.uid();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'você não tem ficha de profissional'; end if;
  return c;
end;
$$;

create or replace function public.novo_codigo_do_salao(salao uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c text := public.gerar_codigo_curto();
begin
  if not public.is_admin_do_salao(salao) then raise exception 'só o salão troca o código dele'; end if;
  update public.salons set codigo = c where id = salao;
  return c;
end;
$$;

revoke execute on function public.novo_codigo() from public, anon;
grant execute on function public.novo_codigo() to authenticated;
revoke execute on function public.novo_codigo_do_salao(uuid) from public, anon;
grant execute on function public.novo_codigo_do_salao(uuid) to authenticated;

-- 11. Abrir um negócio: autônoma ou salão -------------------------------------------------
-- Uma pessoa logada vira profissional autônoma (salão de uma) ou dona de
-- salão. Também é o que o cadastro chama, pelos metadados, quando a
-- pessoa escolheu "sou profissional" antes de criar a conta.
create or replace function public.slug_de(texto text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.abrir_negocio_interno(conta uuid, tipo text, nome_negocio text, cidade text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  nome_pessoa text;
  fone text;
  salao uuid;
  prof uuid;
  base text;
  s text;
  i integer := 0;
begin
  if tipo not in ('autonoma', 'salao') then
    raise exception 'tipo tem de ser autonoma ou salao';
  end if;
  if exists (select 1 from public.salon_members where user_id = conta)
     or exists (select 1 from public.professionals where user_id = conta)
     or exists (select 1 from public.salons where owner_id = conta) then
    raise exception 'essa conta já faz parte de um salão';
  end if;

  select full_name, phone into nome_pessoa, fone from public.profiles where id = conta;
  nome_negocio := coalesce(nullif(btrim(nome_negocio), ''), nome_pessoa, 'Minha agenda');

  -- slug único
  base := coalesce(nullif(public.slug_de(nome_negocio), ''), 'agenda');
  s := base;
  while exists (select 1 from public.salons where slug = s) loop
    i := i + 1; s := base || '-' || i;
  end loop;

  insert into public.salons (name, slug, owner_id, city, phone, tipo)
  values (nome_negocio, s, conta, nullif(btrim(cidade), ''), fone, tipo)
  returning id into salao;

  insert into public.salon_members (salon_id, user_id, papel)
  values (salao, conta, 'admin') on conflict do nothing;

  if tipo = 'autonoma' then
    base := coalesce(nullif(public.slug_de(nome_pessoa), ''), 'profissional');
    s := base; i := 0;
    while exists (select 1 from public.professionals where slug = s) loop
      i := i + 1; s := base || '-' || i;
    end loop;
    insert into public.professionals (salon_id, user_id, name, slug, phone, aceite_manual)
    values (salao, conta, coalesce(nome_pessoa, nome_negocio), s, fone, true)
    returning id into prof;
    insert into public.salon_members (salon_id, user_id, papel)
    values (salao, conta, 'profissional') on conflict do nothing;
    update public.profiles set role = 'profissional' where id = conta;
  else
    update public.profiles set role = 'admin' where id = conta;
  end if;

  return jsonb_build_object('ok', true, 'salao_id', salao, 'professional_id', prof, 'tipo', tipo);
end;
$$;

revoke execute on function public.abrir_negocio_interno(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.abrir_negocio(tipo text, nome_negocio text default null, cidade text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'entre na sua conta primeiro'; end if;
  return public.abrir_negocio_interno(auth.uid(), tipo, nome_negocio, cidade);
end;
$$;

revoke execute on function public.abrir_negocio(text, text, text) from public, anon;
grant execute on function public.abrir_negocio(text, text, text) to authenticated;

-- 12. O cadastro carrega o código (e a escolha de "sou profissional") -----------------------
-- Tudo que a pessoa decidiu ANTES de ter conta vem em raw_user_meta_data e
-- é aplicado aqui, no servidor, no instante em que o perfil nasce. Não
-- depende de aba, de aparelho nem de terminar o cadastro no mesmo lugar.
-- Nenhuma dessas etapas pode derrubar o cadastro: cada uma é protegida.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  convite text := nullif(upper(btrim(meta ->> 'codigo_convite')), '');
  papel text := nullif(meta ->> 'papel_desejado', '');
  alvo jsonb;
  fone text;
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    meta ->> 'full_name',
    meta ->> 'phone',
    public.gerar_codigo_indicacao(meta ->> 'full_name')
  );

  -- (a) veio por um código: entra na agenda antes de abrir o app
  if convite is not null then
    begin
      alvo := public.resolver_codigo(convite);
      if alvo is not null then
        perform public.vincular_interno(new.id, (alvo -> 'salao' ->> 'id')::uuid,
                                        (alvo ->> 'profissional_id')::uuid, 'cadastro');
      end if;
    exception when others then
      raise notice 'convite % não aplicado: %', convite, sqlerrm;
    end;
  end if;

  -- (b) já foi encaixada pelo telefone: os horários passam a ser dela, e o
  --     salão que a encaixou vira vínculo
  fone := public.telefone_e164(meta ->> 'phone');
  if fone is not null then
    begin
      update public.appointments a
      set client_id = new.id
      where a.client_id is null
        and public.telefone_e164(a.guest_phone) = fone;

      perform public.vincular_interno(new.id, a.salon_id, a.professional_id, 'encaixe')
      from (select distinct on (salon_id) salon_id, professional_id
            from public.appointments
            where client_id = new.id
            order by salon_id, date) a;
    exception when others then
      raise notice 'encaixes de % não amarrados: %', fone, sqlerrm;
    end;
  end if;

  -- (c) escolheu "sou profissional" / "tenho um salão" no cadastro
  if papel in ('autonoma', 'salao') then
    begin
      perform public.abrir_negocio_interno(new.id, papel, meta ->> 'nome_negocio', meta ->> 'cidade');
    exception when others then
      raise notice 'negócio de % não aberto: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- 13. Agendou, entrou ----------------------------------------------------------------------
-- Pela vitrine, pelo app ou pelo bot: um agendamento com cliente é vínculo.
create or replace function public.vincula_ao_agendar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.client_id is null or new.salon_id is null then
    return new;
  end if;
  -- a equipe marcando para si mesma não é cliente
  if exists (select 1 from public.professionals p where p.user_id = new.client_id and p.salon_id = new.salon_id) then
    return new;
  end if;
  perform public.vincular_interno(new.client_id, new.salon_id, new.professional_id, 'agendamento');
  return new;
exception when others then
  raise notice 'vínculo ao agendar não criado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists tg_vincula_ao_agendar on public.appointments;
create trigger tg_vincula_ao_agendar
  after insert on public.appointments
  for each row execute function public.vincula_ao_agendar();

-- 14. Quem já agendou alguma vez já está dentro ------------------------------------------
insert into public.vinculos (client_id, salon_id, trazida_por, como, criado_em)
select distinct on (a.client_id, a.salon_id)
       a.client_id, a.salon_id, a.professional_id, 'agendamento', a.created_at
from public.appointments a
join public.profiles pf on pf.id = a.client_id
where a.client_id is not null and a.salon_id is not null
  and pf.role = 'cliente'
  and not exists (select 1 from public.professionals p where p.user_id = a.client_id)
order by a.client_id, a.salon_id, a.created_at
on conflict (client_id, salon_id) do nothing;
