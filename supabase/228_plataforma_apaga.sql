-- 228 · A plataforma apaga salões e pessoas (3.84)
--
-- Para limpar o banco dos testes (e atender pedido de exclusão), a Plataforma apaga de verdade:
--   · um salão (ou autônoma): os agendamentos dele, e tudo que é dele sai junto (equipe, serviços, horários,
--     vínculos, comandas, pagamentos, promoções…); a página do guia, se havia, continua, solta do salão;
--     com_donas: a conta da dona também, quando ela não tem outro salão e não é da plataforma;
--   · uma pessoa (cliente, profissional, dona): a conta (auth.users) e o que é dela (agendamentos, vínculos,
--     favoritas, pagamentos…); a ficha de profissional num salão fica, sem conta. Dona de salão não sai por
--     aqui: apaga o salão com a dona, em Salões.
-- Nunca apaga conta da plataforma nem quem está apagando. Antes, plataforma_apagar_previa mostra o que vai
-- junto (a tela pede para digitar APAGAR). Cada item apaga sozinho: um erro pula aquele e segue. Tudo fica
-- em plataforma_apagados (quem, quando, o quê). Nenhum aviso sai para ninguém: os gatilhos de apagar não
-- notificam (conferido), e agendamento apagado não é cancelado (não libera vaga, não avisa a cliente).
-- E plataforma_pessoas ganha "negocio" (salao/autonoma) para a lista de Pessoas mostrar quem é dona de quê.

create table if not exists public.plataforma_apagados (
  id bigserial primary key,
  quando timestamptz not null default now(),
  por uuid,
  tipo text not null check (tipo in ('salao', 'pessoa')),
  alvo uuid not null,
  nome text,
  resumo jsonb not null default '{}'::jsonb
);
alter table public.plataforma_apagados enable row level security;
drop policy if exists "plataforma ve o que apagou" on public.plataforma_apagados;
create policy "plataforma ve o que apagou" on public.plataforma_apagados for select to authenticated using (public.eh_plataforma());
grant select on public.plataforma_apagados to authenticated;

-- o que vai junto com um salão
create or replace function public.plataforma_resumo_salao(sid uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'cidade', s.city, 'criado_em', s.created_at,
    'dona', (select jsonb_build_object('id', p.id, 'nome', p.full_name, 'email', u.email, 'papel', p.role,
                                       'outros_saloes', (select count(*) from public.salons o where o.id <> s.id and (o.owner_id = p.id or exists (select 1 from public.salon_members m where m.salon_id = o.id and m.user_id = p.id and m.papel = 'admin'))))
             from public.profiles p left join auth.users u on u.id = p.id where p.id = s.owner_id),
    'profissionais', (select count(*) from public.professionals x where x.salon_id = s.id),
    'servicos', (select count(*) from public.services x where x.salon_id = s.id),
    'clientes', (select count(*) from public.vinculos x where x.salon_id = s.id and x.saiu_em is null),
    'agendamentos', (select count(*) from public.appointments x where x.salon_id = s.id),
    'agendamentos_futuros', (select count(*) from public.appointments x where x.salon_id = s.id and x.date >= (public.agora_local())::date and x.status in ('pendente', 'confirmado')),
    'pagamentos', (select count(*) from public.pagamentos x where x.salon_id = s.id),
    'pagamentos_pagos', (select count(*) from public.pagamentos x where x.salon_id = s.id and x.pago_em is not null),
    'mensalidades_pagas', (select count(*) from public.cobrancas_mimo x where x.salon_id = s.id and x.pago_em is not null),
    'no_guia', exists (select 1 from public.guia_lugares g where g.salon_id = s.id)
  )
  from public.salons s where s.id = sid;
$$;
revoke execute on function public.plataforma_resumo_salao(uuid) from public, anon, authenticated;

-- o que vai junto com uma pessoa, e o que impede
create or replace function public.plataforma_resumo_pessoa(uid uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'nome', p.full_name, 'email', u.email, 'telefone', p.phone, 'papel', p.role, 'criado_em', coalesce(u.created_at, p.created_at),
    'impede', case
      when p.id = auth.uid() then 'É a sua conta.'
      when p.role = 'plataforma' then 'É uma conta da plataforma.'
      when exists (select 1 from public.salons s where s.owner_id = p.id) then
        'É dona de ' || (select string_agg(s.name || case when s.tipo = 'autonoma' then ' (autônoma)' else '' end, ', ') from public.salons s where s.owner_id = p.id)
        || '. Apague o salão com a conta da dona, em Salões.'
      end,
    'agendamentos', (select count(*) from public.appointments x where x.client_id = p.id),
    'agendamentos_futuros', (select count(*) from public.appointments x where x.client_id = p.id and x.date >= (public.agora_local())::date and x.status in ('pendente', 'confirmado')),
    'vinculos', (select count(*) from public.vinculos x where x.client_id = p.id and x.saiu_em is null),
    'pagamentos_pagos', (select count(*) from public.pagamentos x where x.client_id = p.id and x.pago_em is not null),
    'profissional_em', (select string_agg(s.name, ', ') from public.professionals x join public.salons s on s.id = x.salon_id where x.user_id = p.id)
  )
  from public.profiles p left join auth.users u on u.id = p.id where p.id = uid;
$$;
revoke execute on function public.plataforma_resumo_pessoa(uuid) from public, anon, authenticated;

create or replace function public.plataforma_apagar_previa(tipo_ text, ids uuid[])
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if tipo_ = 'salao' then
    return (select coalesce(jsonb_agg(public.plataforma_resumo_salao(i)), '[]'::jsonb) from unnest(coalesce(ids, '{}')) i where exists (select 1 from public.salons s where s.id = i));
  elsif tipo_ = 'pessoa' then
    return (select coalesce(jsonb_agg(public.plataforma_resumo_pessoa(i)), '[]'::jsonb) from unnest(coalesce(ids, '{}')) i where exists (select 1 from public.profiles p where p.id = i));
  end if;
  raise exception 'Tipo desconhecido.';
end;
$$;
revoke execute on function public.plataforma_apagar_previa(text, uuid[]) from public, anon;
grant execute on function public.plataforma_apagar_previa(text, uuid[]) to authenticated;

create or replace function public.plataforma_apagar(tipo_ text, ids uuid[], com_donas boolean default true)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  i uuid; r jsonb; dona jsonb; dona_id uuid;
  apagados integer := 0; contas integer := 0; pulados jsonb := '[]'::jsonb;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if coalesce(array_length(ids, 1), 0) = 0 then return jsonb_build_object('ok', true, 'apagados', 0, 'contas', 0, 'pulados', pulados); end if;
  if array_length(ids, 1) > 200 then raise exception 'No máximo 200 de uma vez.'; end if;

  foreach i in array ids loop
    r := null; dona := null; dona_id := null;
    begin
      if tipo_ = 'salao' then
        r := public.plataforma_resumo_salao(i);
        if r is null then continue; end if;
        dona := r -> 'dona';
        dona_id := nullif(dona ->> 'id', '')::uuid;
        -- os agendamentos travam o salão (e a equipe e os serviços): saem primeiro, e o resto vai em cascata
        delete from public.platform_transactions where salon_id = i;
        delete from public.appointments where salon_id = i;
        delete from public.salons where id = i;
        insert into public.plataforma_apagados (por, tipo, alvo, nome, resumo) values (auth.uid(), 'salao', i, r ->> 'nome', r);
        apagados := apagados + 1;
        -- a conta da dona, se ela só tinha este salão e não é da plataforma
        if com_donas and dona_id is not null and dona_id <> auth.uid() and coalesce(dona ->> 'papel', '') <> 'plataforma'
           and not exists (select 1 from public.salons o where o.owner_id = dona_id)
           and not exists (select 1 from public.salon_members m where m.user_id = dona_id and m.papel = 'admin') then
          r := public.plataforma_resumo_pessoa(dona_id);
          delete from public.appointments where client_id = dona_id;
          delete from auth.users where id = dona_id;
          delete from public.profiles where id = dona_id;   -- se não havia conta de login, a ficha sai mesmo assim
          insert into public.plataforma_apagados (por, tipo, alvo, nome, resumo) values (auth.uid(), 'pessoa', dona_id, r ->> 'nome', r || jsonb_build_object('com_o_salao', i));
          contas := contas + 1;
        end if;
      elsif tipo_ = 'pessoa' then
        r := public.plataforma_resumo_pessoa(i);
        if r is null then continue; end if;
        if r ->> 'impede' is not null then
          pulados := pulados || jsonb_build_object('id', i, 'nome', r ->> 'nome', 'motivo', r ->> 'impede');
          continue;
        end if;
        delete from public.appointments where client_id = i;
        delete from auth.users where id = i;
        delete from public.profiles where id = i;
        insert into public.plataforma_apagados (por, tipo, alvo, nome, resumo) values (auth.uid(), 'pessoa', i, r ->> 'nome', r);
        apagados := apagados + 1;
      else
        raise exception 'Tipo desconhecido.';
      end if;
    exception when others then
      pulados := pulados || jsonb_build_object('id', i, 'nome', coalesce(r ->> 'nome', ''), 'motivo', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'apagados', apagados, 'contas', contas, 'pulados', pulados);
end;
$$;
revoke execute on function public.plataforma_apagar(text, uuid[], boolean) from public, anon;
grant execute on function public.plataforma_apagar(text, uuid[], boolean) to authenticated;

-- Pessoas: quem é dona de quê. "negocio" diz se a conta tem um salão ('salao') ou só uma agenda autônoma
-- ('autonoma'); "saloes" passa a incluir os de que ela é dona (não só onde é membro), com "(autônoma)" ao lado.
drop function if exists public.plataforma_pessoas(text, integer);
create function public.plataforma_pessoas(busca text default null, quantas integer default 100)
returns table (
  id uuid, nome text, email text, telefone text, papel text, desde date,
  saloes text, vinculos integer, atendimentos integer, ultimo_acesso timestamptz,
  faltas integer, cancelamentos integer, remarcacoes integer, negocio text
)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.full_name, u.email, p.phone, p.role, p.created_at::date,
         (select string_agg(distinct s.name || case when s.tipo = 'autonoma' then ' (autônoma)' else '' end, ', ')
          from public.salons s
          where s.owner_id = p.id or exists (select 1 from public.salon_members m where m.salon_id = s.id and m.user_id = p.id)),
         (select count(*)::integer from public.vinculos v where v.client_id = p.id and v.saiu_em is null),
         f.concluidos,
         (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz,
         f.faltas, f.cancelamentos, f.remarcacoes,
         case when exists (select 1 from public.salons s where s.owner_id = p.id and s.tipo is distinct from 'autonoma') then 'salao'
              when exists (select 1 from public.salons s where s.owner_id = p.id) then 'autonoma' end
  from public.profiles p
  left join auth.users u on u.id = p.id
  cross join lateral (
    select count(*) filter (where a.status = 'concluido')::integer as concluidos,
           count(*) filter (where a.status = 'faltou')::integer as faltas,
           count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where a.remarca_de is not null)::integer as remarcacoes
    from public.appointments a where a.client_id = p.id
  ) f
  where public.eh_plataforma()
    and (busca is null or btrim(busca) = ''
         or p.full_name ilike '%' || btrim(busca) || '%'
         or u.email ilike '%' || btrim(busca) || '%'
         or p.phone ilike '%' || btrim(busca) || '%')
  order by p.created_at desc
  limit greatest(1, least(coalesce(quantas, 100), 500));
$$;
revoke execute on function public.plataforma_pessoas(text, integer) from public, anon;
grant execute on function public.plataforma_pessoas(text, integer) to authenticated;

do $$ begin raise notice '228: a plataforma apaga salões e pessoas (com prévia e registro em plataforma_apagados)'; end $$;
