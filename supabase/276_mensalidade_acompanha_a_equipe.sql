-- 276 · A mensalidade aberta acompanha a equipe (4.45)
--
-- O Pix da próxima mensalidade é gerado dias antes do vencimento, com o valor das agendas daquele dia, e é "uma
-- aberta por vez". Se o salão adicionava (ou tirava) uma profissional com esse Pix aberto, ele continuava no valor
-- antigo: pagava 3 agendas e ficava com 4, ou o contrário. Agora, quando o número de agendas muda:
--
--   • mensalidade aberta (renovação) com outro valor: sai e nasce outra, no valor certo (cobranca_renovacao_preparar,
--     que já fazia isso quando a dona trocava de plano), e a dona é avisada;
--   • Pix de ativação aberto (inicial) com outro valor: sai, e a dona gera outro em Plano e mensalidade;
--   • a cobrança que saiu fica marcada (apagar_no_asaas): a função assinatura-cuidar apaga no Asaas, para ninguém
--     pagar o valor velho. Se ela pagou no meio do caminho, o pagamento vale e a cobrança nova é que sai.
--
-- Cobrança já paga não é tocada (para essa existe o Pix da diferença, 265). Nada aqui trava o cadastro da
-- profissional: se a conta falhar, fica só um aviso no log do banco.

alter table public.cobrancas_mimo add column if not exists apagar_no_asaas boolean not null default false;

create or replace function public.cobrancas_acompanhar_equipe(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype; c public.cobrancas_mimo%rowtype; m jsonb; cheio integer; total integer; r jsonb; nova uuid; mudou integer := 0;
begin
  select * into s from public.salons where id = salao;
  if s.id is null or s.tipo = 'autonoma' then return jsonb_build_object('mudou', 0); end if;

  -- a mensalidade seguinte
  select * into c from public.cobrancas_mimo x
   where x.salon_id = salao and x.tipo = 'renovacao' and x.status in ('a_criar', 'aguardando') and x.metodo = 'pix'
   order by x.criado_em desc limit 1;
  if c.id is not null then
    m := public.mensalidade_do_salao(salao);
    cheio := coalesce((m ->> 'valor_cents')::int, 0);
    total := public.preco_do_plano(cheio, c.meses, public.desconto_do_plano(c.meses, false));
    if cheio > 0 and total <> c.total_cents then
      r := public.cobranca_renovacao_preparar(salao, c.metodo, c.meses);
      nova := (r ->> 'id')::uuid;
      update public.cobrancas_mimo x set apagar_no_asaas = true, erro = 'a equipe mudou: substituída por outra no valor novo'
       where x.salon_id = salao and x.status = 'cancelado' and x.cobranca_id is not null
         and x.cobranca_id in (select jsonb_array_elements_text(coalesce(r -> 'anteriores', '[]'::jsonb)));
      mudou := mudou + 1;
      if s.owner_id is not null then
        begin
          perform public.notificar(s.owner_id, 'cobranca_pix', 'Sua mensalidade foi atualizada',
            format('%s: a equipe passou para %s %s com agenda, e a mensalidade aberta foi de %s para %s. O Pix anterior não vale mais; o novo está em Plano e mensalidade.',
              s.name, m ->> 'agendas', case when (m ->> 'agendas')::int = 1 then 'profissional' else 'profissionais' end, public.reais(c.total_cents), public.reais(total)),
            '/admin/assinatura', jsonb_build_object('salon_id', salao, 'cobranca', nova));
          -- o aviso "sua mensalidade está pronta" da rotina não repete para esta
          update public.assinaturas set avisos = avisos || jsonb_build_object('pix_' || nova::text, now()) where salon_id = salao;
        exception when others then null;
        end;
      end if;
    end if;
  end if;

  -- o Pix de ativação (antes de o salão estar ativo): o valor segue as agendas liberadas
  select * into c from public.cobrancas_mimo x
   where x.salon_id = salao and x.tipo = 'inicial' and x.status in ('a_criar', 'aguardando') and x.metodo = 'pix'
   order by x.criado_em desc limit 1;
  if c.id is not null then
    m := public.mensalidade_inicial_do_salao(salao);
    cheio := coalesce((m ->> 'valor_cents')::int, 0);
    total := public.preco_do_plano(cheio, c.meses, public.desconto_do_plano(c.meses, true));
    if cheio > 0 and total <> c.total_cents then
      update public.cobrancas_mimo set status = 'cancelado', erro = 'a equipe mudou: gere outro Pix no valor novo',
             apagar_no_asaas = cobranca_id is not null, atualizado_em = now()
       where id = c.id;
      mudou := mudou + 1;
      if s.owner_id is not null then
        begin
          perform public.notificar(s.owner_id, 'cobranca_pix', 'O Pix de ativação mudou de valor',
            format('%s: a equipe mudou e o valor passou de %s para %s. O Pix anterior não vale mais; gere outro em Plano e mensalidade.', s.name, public.reais(c.total_cents), public.reais(total)),
            '/admin/assinatura', jsonb_build_object('salon_id', salao));
        exception when others then null;
        end;
      end if;
    end if;
  end if;

  if mudou > 0 then
    begin perform public.chutar_assinaturas(); exception when others then null; end;
  end if;
  return jsonb_build_object('mudou', mudou);
end;
$$;
revoke execute on function public.cobrancas_acompanhar_equipe(uuid) from public, anon, authenticated;

-- os gatilhos: mudou quem tem agenda no ar, ou quantas agendas estão liberadas
create or replace function public.tg_cobrancas_acompanhar_equipe()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare salao uuid := case when tg_op = 'DELETE' then old.salon_id else new.salon_id end;
begin
  begin
    perform public.cobrancas_acompanhar_equipe(salao);
  exception when others then
    raise notice 'mensalidade de % não acompanhou a equipe: %', salao, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.tg_cobrancas_acompanhar_equipe() from public, anon, authenticated;

drop trigger if exists professionals_zzz_mensalidade_ins on public.professionals;
create trigger professionals_zzz_mensalidade_ins after insert on public.professionals
  for each row when (new.active) execute function public.tg_cobrancas_acompanhar_equipe();
drop trigger if exists professionals_zzz_mensalidade_upd on public.professionals;
create trigger professionals_zzz_mensalidade_upd after update of active on public.professionals
  for each row when (old.active is distinct from new.active) execute function public.tg_cobrancas_acompanhar_equipe();
drop trigger if exists professionals_zzz_mensalidade_del on public.professionals;
create trigger professionals_zzz_mensalidade_del after delete on public.professionals
  for each row when (old.active) execute function public.tg_cobrancas_acompanhar_equipe();

create or replace function public.tg_cobrancas_acompanhar_liberadas()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  begin
    perform public.cobrancas_acompanhar_equipe(new.id);
  exception when others then
    raise notice 'ativação de % não acompanhou as agendas liberadas: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.tg_cobrancas_acompanhar_liberadas() from public, anon, authenticated;
drop trigger if exists salons_zzz_mensalidade on public.salons;
create trigger salons_zzz_mensalidade after update of equipe_prevista on public.salons
  for each row when (old.equipe_prevista is distinct from new.equipe_prevista) execute function public.tg_cobrancas_acompanhar_liberadas();

-- a função assinatura-cuidar também recebe as que saíram e ainda estão vivas no Asaas (status 'cancelado')
create or replace function public.cobrancas_mimo_para_cuidar(quantos integer default 20)
returns table (id uuid, salon_id uuid, tipo text, status text, metodo text, total_cents integer, vencimento date, cobranca_id text,
               periodo_inicio date, periodo_fim date, descricao text, customer_id text, cartao_token text, autorizacao_id text, autorizacao_status text,
               nome text, documento text, email text, telefone text, tentativas integer, meses integer, cancelar_em date)
language sql
stable
security definer set search_path = public
as $$
  select c.id, c.salon_id, c.tipo, c.status, c.metodo, c.total_cents, c.vencimento, c.cobranca_id, c.periodo_inicio, c.periodo_fim,
         format('MIMO %s · %s · %s', case c.meses when 12 then 'plano anual' when 6 then 'plano semestral' else 'mensalidade' end, s.name,
                case when c.inicio_no_pagamento then format('%s %s a partir do pagamento', c.meses, case when c.meses = 1 then 'mês' else 'meses' end)
                     else format('%s a %s', to_char(c.periodo_inicio, 'DD/MM/YYYY'), to_char(c.periodo_fim, 'DD/MM/YYYY')) end),
         a.customer_id, a.cartao_token, a.autorizacao_id, a.autorizacao_status,
         coalesce(s.razao_social, s.name),
         coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
         coalesce(s.email, (select u.email from auth.users u where u.id = s.owner_id)),
         coalesce(s.whatsapp, s.phone, p.phone),
         c.tentativas, c.meses, coalesce(c.cancelar_em, c.vencimento + 3)
  from public.cobrancas_mimo c
  join public.salons s on s.id = c.salon_id
  join public.assinaturas a on a.salon_id = c.salon_id
  left join public.profiles p on p.id = s.owner_id
  where (c.status = 'cancelado' and c.apagar_no_asaas and c.cobranca_id is not null and c.tentativas < 8)
     or (c.status = 'a_criar' and c.criado_em < now() - interval '2 minutes' and c.atualizado_em < now() - interval '3 minutes')
     or (c.status = 'aguardando' and (
           c.atualizado_em < now() - interval '1 hour'
        or coalesce(c.cancelar_em, c.vencimento + 3) < (now() at time zone 'America/Sao_Paulo')::date
        or c.metodo <> 'pix'))
  order by (c.status = 'cancelado') desc, c.criado_em
  limit quantos;
$$;
revoke execute on function public.cobrancas_mimo_para_cuidar(integer) from public, anon, authenticated;

-- a função avisa: a cobrança que saiu foi apagada no Asaas (ou foi paga antes de apagar)
create or replace function public.cobranca_mimo_apagada(cobranca uuid, paga boolean default false)
returns void
language plpgsql
security definer set search_path = public
as $$
declare c public.cobrancas_mimo%rowtype;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca;
  if c.id is null then return; end if;
  update public.cobrancas_mimo set apagar_no_asaas = false, atualizado_em = now() where id = cobranca;
  if paga then
    -- ela pagou o valor de antes: o pagamento vale, e a que nasceu no lugar sai (e é apagada no Asaas)
    update public.cobrancas_mimo x set status = 'cancelado', erro = 'a anterior foi paga antes de sair', apagar_no_asaas = x.cobranca_id is not null, atualizado_em = now()
     where x.salon_id = c.salon_id and x.id <> c.id and x.tipo = c.tipo and x.status in ('a_criar', 'aguardando');
  end if;
end;
$$;
revoke execute on function public.cobranca_mimo_apagada(uuid, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
