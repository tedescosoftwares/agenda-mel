-- 109: o que é de quem. Cada item da comanda vira uma linha que sabe a
-- profissional, o horário, o valor bruto e a parte do desconto que lhe
-- cabe. É a base do repasse: o relatório por período já separa o que é
-- de cada uma (e aplica a cota do contrato de parceria vigente, quando
-- houver), mesmo antes de existir a transferência de dinheiro.

-- ------------------------------------------------------------------
-- 1. Os itens da comanda, normalizados
-- ------------------------------------------------------------------
create table if not exists public.comanda_itens (
  id uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  professional_id uuid references public.professionals (id) on delete set null,
  service_id uuid references public.services (id) on delete set null,
  nome text not null,
  qtd integer not null default 1,
  preco_cents integer not null default 0,      -- unitário
  valor_cents integer not null default 0,      -- qtd × preço (bruto)
  desconto_cents integer not null default 0,   -- a parte do desconto da comanda que cabe a este item (rateio)
  liquido_cents integer not null default 0,    -- valor − desconto
  ordem integer not null default 1,
  dia date not null,
  status text not null default 'fechada',      -- espelha a comanda: fechada / estornada
  criado_em timestamptz not null default now()
);
create index if not exists comanda_itens_salao_dia on public.comanda_itens (salon_id, dia);
create index if not exists comanda_itens_prof_dia on public.comanda_itens (professional_id, dia);
create index if not exists comanda_itens_comanda on public.comanda_itens (comanda_id);

alter table public.comanda_itens enable row level security;
drop policy if exists "itens: a casa ve" on public.comanda_itens;
create policy "itens: a casa ve" on public.comanda_itens for select to authenticated
  using (public.is_admin_do_salao(salon_id) or public.eh_plataforma()
         or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = auth.uid()));
grant select on public.comanda_itens to authenticated;

-- Refaz as linhas de uma comanda a partir do jsonb. O desconto é rateado
-- proporcionalmente ao valor de cada item, com arredondamento acumulado
-- (a soma dos rateios bate exatamente com o desconto da comanda).
create or replace function public.comanda_itens_sincronizar(comanda uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare c public.comandas%rowtype; it jsonb; i integer := 0; subtotal integer := 0; acumulado integer := 0; rateado integer := 0; v integer; d integer; pid uuid; aid uuid; sid uuid;
begin
  select * into c from public.comandas where id = comanda;
  if c.id is null then return; end if;
  delete from public.comanda_itens where comanda_id = comanda;
  for it in select * from jsonb_array_elements(c.itens) loop
    subtotal := subtotal + coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
  end loop;
  for it in select * from jsonb_array_elements(c.itens) loop
    i := i + 1;
    v := coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    acumulado := acumulado + v;
    if subtotal > 0 then d := round(c.desconto_cents::numeric * acumulado / subtotal)::integer - rateado; else d := 0; end if;
    rateado := rateado + d;
    begin pid := nullif(it ->> 'professional_id', '')::uuid; exception when others then pid := null; end;
    begin aid := nullif(it ->> 'appointment_id', '')::uuid; exception when others then aid := null; end;
    begin sid := nullif(it ->> 'service_id', '')::uuid; exception when others then sid := null; end;
    insert into public.comanda_itens (comanda_id, salon_id, appointment_id, professional_id, service_id, nome, qtd, preco_cents, valor_cents, desconto_cents, liquido_cents, ordem, dia, status)
    values (comanda, c.salon_id, coalesce(aid, c.appointment_id), coalesce(pid, c.professional_id), sid, coalesce(it ->> 'nome', 'Serviço'),
            greatest(1, coalesce((it ->> 'qtd')::integer, 1)), coalesce((it ->> 'preco_cents')::integer, 0), v, d, v - d, i,
            (c.fechada_em at time zone 'America/Sao_Paulo')::date, c.status);
  end loop;
end;
$$;
revoke execute on function public.comanda_itens_sincronizar(uuid) from public, anon, authenticated;

create or replace function public.comandas_sincronizar_itens()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.comanda_itens_sincronizar(new.id);
  return new;
end;
$$;
drop trigger if exists comandas_itens_sync on public.comandas;
create trigger comandas_itens_sync
  after insert or update of itens, desconto_cents, status, fechada_em on public.comandas
  for each row execute function public.comandas_sincronizar_itens();

-- as comandas que já existem entram na base
do $$
declare cid uuid;
begin
  for cid in select id from public.comandas loop perform public.comanda_itens_sincronizar(cid); end loop;
end $$;

-- ------------------------------------------------------------------
-- 2. O relatório: o que é de quem, num período
-- ------------------------------------------------------------------
-- A cota vem do contrato de parceria vigente da profissional (cota_pct,
-- base bruto/líquido, exceções por nome de serviço). Sem contrato, a
-- linha sai sem repasse calculado: só o que ela produziu.
create or replace function public.cota_do_item(parceria public.parcerias, nome text)
returns numeric
language sql
immutable
as $$
  select coalesce(
    (select (e ->> 'cota_pct')::numeric from jsonb_array_elements(coalesce(parceria.excecoes, '[]'::jsonb)) e
      where lower(btrim(coalesce(e ->> 'nome', ''))) = lower(btrim(coalesce(nome, ''))) limit 1),
    parceria.cota_pct);
$$;

create or replace function public.pdv_repasse(salao uuid, de date, ate date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; minha uuid; dona boolean;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  if not dona then
    select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() limit 1;
    if minha is null then raise exception 'Só a casa ou a própria profissional vê o repasse.'; end if;
  end if;
  if ate < de then raise exception 'O período está invertido.'; end if;
  if ate - de > 92 then raise exception 'Escolha um período de até 3 meses.'; end if;

  with itens as (
    select ci.*, coalesce(nullif(btrim(pf.full_name), ''), c.cliente_nome, 'Cliente') cliente, p.name profissional, c.fechada_em,
           pa.id parceria_id, pa.cota_pct, pa.base_calculo, pa.periodicidade,
           case when pa.id is null then null else public.cota_do_item(pa, ci.nome) end cota,
           case when pa.id is null then null
                else round((case when pa.base_calculo = 'liquido' then ci.liquido_cents else ci.valor_cents end) * public.cota_do_item(pa, ci.nome) / 100.0)::integer end repasse_cents
    from public.comanda_itens ci
    join public.comandas c on c.id = ci.comanda_id
    left join public.profiles pf on pf.id = c.client_id
    left join public.professionals p on p.id = ci.professional_id
    left join lateral (select * from public.parcerias x where x.salon_id = salao and x.professional_id = ci.professional_id and x.status = 'vigente' and x.inicio <= ci.dia order by x.inicio desc limit 1) pa on true
    where ci.salon_id = salao and ci.status = 'fechada' and ci.dia between de and ate
      and (minha is null or ci.professional_id = minha)
  )
  select jsonb_build_object(
    'de', de, 'ate', ate,
    'total', (select jsonb_build_object('bruto_cents', coalesce(sum(valor_cents), 0), 'desconto_cents', coalesce(sum(desconto_cents), 0), 'liquido_cents', coalesce(sum(liquido_cents), 0),
                                        'repasse_cents', coalesce(sum(repasse_cents), 0), 'comandas', count(distinct comanda_id), 'itens', count(*)) from itens),
    'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object(
        'professional_id', g.professional_id, 'nome', coalesce(g.profissional, 'Sem profissional'), 'comandas', g.comandas, 'itens', g.n,
        'bruto_cents', g.bruto, 'desconto_cents', g.desc_, 'liquido_cents', g.liq,
        'contrato', case when g.parceria_id is null then null else jsonb_build_object('parceria_id', g.parceria_id, 'cota_pct', g.cota_pct, 'base_calculo', g.base_calculo, 'periodicidade', g.periodicidade) end,
        'repasse_cents', g.repasse, 'casa_cents', case when g.parceria_id is null then null else g.liq - g.repasse end
      ) order by g.liq desc), '[]'::jsonb)
      from (select professional_id, profissional, count(distinct comanda_id) comandas, count(*) n, sum(valor_cents) bruto, sum(desconto_cents) desc_, sum(liquido_cents) liq,
                   max(parceria_id::text)::uuid parceria_id, max(cota_pct) cota_pct, max(base_calculo) base_calculo, max(periodicidade) periodicidade, sum(repasse_cents) repasse
            from itens group by professional_id, profissional) g),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'dia', i.dia, 'fechada_em', i.fechada_em, 'comanda_id', i.comanda_id, 'appointment_id', i.appointment_id, 'cliente', i.cliente,
        'professional_id', i.professional_id, 'profissional', i.profissional, 'nome', i.nome, 'qtd', i.qtd,
        'valor_cents', i.valor_cents, 'desconto_cents', i.desconto_cents, 'liquido_cents', i.liquido_cents, 'cota_pct', i.cota, 'repasse_cents', i.repasse_cents
      ) order by i.fechada_em desc, i.ordem), '[]'::jsonb) from itens i)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.pdv_repasse(uuid, date, date) from public, anon;
grant execute on function public.pdv_repasse(uuid, date, date) to authenticated;

-- ------------------------------------------------------------------
-- 3. O cupom diz com quem foi cada serviço, quando houve mais de uma
-- ------------------------------------------------------------------
create or replace function public.cupom_html(comanda uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare c public.comandas%rowtype; s public.salons%rowtype; a public.appointments%rowtype; it jsonb; pg jsonb; linhas text := ''; pags text := ''; quando text; varias boolean;
begin
  select * into c from public.comandas where id = comanda;
  if c.id is null then return null; end if;
  select * into s from public.salons where id = c.salon_id;
  if c.appointment_id is not null then select * into a from public.appointments where id = c.appointment_id; end if;
  quando := to_char(coalesce(a.date, (c.fechada_em at time zone 'America/Sao_Paulo')::date), 'DD/MM/YYYY') || case when a.start_time is not null then ' às ' || to_char(a.start_time, 'HH24:MI') else '' end;
  select count(distinct coalesce(e ->> 'professional_id', '')) > 1 into varias from jsonb_array_elements(c.itens) e;
  for it in select * from jsonb_array_elements(c.itens) loop
    linhas := linhas || '<tr><td style="padding:6px 0;border-bottom:1px solid #f0e6f2">' || public.escapar_html(coalesce(it ->> 'nome', 'Serviço'))
      || case when coalesce((it ->> 'qtd')::integer, 1) > 1 then ' × ' || (it ->> 'qtd') else '' end
      || case when varias and nullif(it ->> 'profissional', '') is not null then '<span style="color:#8a8a94;font-size:12px"> · com ' || public.escapar_html(split_part(it ->> 'profissional', ' ', 1)) || '</span>' else '' end
      || '</td><td style="padding:6px 0;border-bottom:1px solid #f0e6f2;text-align:right;white-space:nowrap">R$ '
      || to_char(coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1)) / 100.0, 'FM999G990D00') || '</td></tr>';
  end loop;
  for pg in select * from jsonb_array_elements(c.pagamentos) loop
    pags := pags || '<tr><td style="padding:4px 0;color:#6b7280">' || public.rotulo_forma(pg ->> 'forma')
      || case when nullif(pg ->> 'parcelas', '') is not null and (pg ->> 'parcelas')::integer > 1 then ' em ' || (pg ->> 'parcelas') || 'x' else '' end
      || case when nullif(pg ->> 'detalhe', '') is not null and (pg ->> 'forma') <> 'app' then ' · ' || public.escapar_html(pg ->> 'detalhe') else '' end
      || '</td><td style="padding:4px 0;text-align:right;white-space:nowrap">R$ ' || to_char(coalesce((pg ->> 'valor_cents')::integer, 0) / 100.0, 'FM999G990D00') || '</td></tr>'
      || case when coalesce((pg ->> 'troco_cents')::integer, 0) > 0 then '<tr><td style="padding:0 0 4px;color:#6b7280;font-size:12px">entregue R$ ' || to_char((pg ->> 'recebido_cents')::integer / 100.0, 'FM999G990D00') || ' · troco R$ ' || to_char((pg ->> 'troco_cents')::integer / 100.0, 'FM999G990D00') || '</td><td></td></tr>' else '' end;
  end loop;
  return '<p style="margin:0 0 4px;font-size:15px">Seu comprovante em <strong>' || public.escapar_html(s.name) || '</strong></p>'
    || '<p style="margin:0 0 18px;color:#6b7280;font-size:13px">' || quando || case when c.atendida_por is not null then ' · com ' || public.escapar_html(c.atendida_por) else '' end || '</p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">' || linhas
    || case when c.desconto_cents > 0 then '<tr><td style="padding:6px 0;color:#6b7280">Desconto</td><td style="padding:6px 0;text-align:right">− R$ ' || to_char(c.desconto_cents / 100.0, 'FM999G990D00') || '</td></tr>' else '' end
    || '<tr><td style="padding:10px 0 4px;font-weight:700;font-size:16px">Total</td><td style="padding:10px 0 4px;text-align:right;font-weight:800;font-size:18px;color:#3d0c4e">R$ ' || to_char(c.total_cents / 100.0, 'FM999G990D00') || '</td></tr>'
    || '</table>'
    || '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;border-top:1px dashed #e5e7eb;padding-top:8px">' || pags || '</table>'
    || case when s.address is not null then '<p style="margin:18px 0 0;font-size:12px;color:#8a8a94">' || public.escapar_html(s.name) || case when s.cnpj is not null then ' · CNPJ ' || s.cnpj else '' end || '<br>' || public.escapar_html(coalesce(s.address, '')) || case when s.city is not null then ' · ' || public.escapar_html(s.city) else '' end || '</p>' else '' end
    || '<p style="margin:12px 0 18px;font-size:12px;color:#8a8a94">Comprovante nº ' || left(c.id::text, 8) || ' · emitido pelo MIMO. Não é documento fiscal.</p>';
end;
$$;
revoke execute on function public.cupom_html(uuid) from public, anon, authenticated;
