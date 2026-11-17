-- 229 · A Plataforma dá baixa à mão numa mensalidade da MIMO (3.85)
--
-- Com o Asaas em produção, para testar (e para o Pix que caiu fora do fluxo), a Plataforma marca como paga uma
-- cobrança da MIMO que está aberta: Salões › o salão › aba Mensalidades › "Dar baixa". Faz exatamente o que a
-- confirmação do Asaas faz (cobranca_mimo_confirmar: libera os 30 dias, ativa o salão, avisa a dona), e guarda
-- quem deu a baixa, quando e por quê. A tela da ativação, que confere a cada 5 s, vê o pago e segue sozinha.
-- A cobrança no Asaas continua aberta até vencer (o Pix vale pelo dia); se ela pagar mesmo assim, a confirmação
-- do Asaas chega como repetida e nada muda. Só cobrança aberta recebe baixa (cancelada não: ela escolheu outra coisa).

alter table public.cobrancas_mimo
  add column if not exists baixa_manual_por uuid,
  add column if not exists baixa_manual_em timestamptz,
  add column if not exists baixa_manual_nota text;

-- as cobranças da MIMO, de um salão ou de todos (as mais novas primeiro)
create or replace function public.plataforma_cobrancas(salao uuid default null, quantas integer default 100)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'salon_id', c.salon_id, 'salao', s.name, 'tipo', c.tipo, 'metodo', c.metodo, 'status', c.status,
             'valor_cents', c.valor_cents, 'desconto_cents', c.desconto_cents, 'total_cents', c.total_cents,
             'periodo_inicio', c.periodo_inicio, 'periodo_fim', c.periodo_fim, 'vencimento', c.vencimento,
             'criado_em', c.criado_em, 'pago_em', c.pago_em, 'cobranca_id', c.cobranca_id, 'erro', c.erro,
             'baixa_manual_em', c.baixa_manual_em, 'baixa_manual_nota', c.baixa_manual_nota,
             'baixa_manual_quem', (select p.full_name from public.profiles p where p.id = c.baixa_manual_por)
           ) order by c.criado_em desc), '[]'::jsonb)
    from (select * from public.cobrancas_mimo x
          where salao is null or x.salon_id = salao
          order by x.criado_em desc
          limit greatest(1, least(coalesce(quantas, 100), 500))) c
    join public.salons s on s.id = c.salon_id
  );
end;
$$;
revoke execute on function public.plataforma_cobrancas(uuid, integer) from public, anon;
grant execute on function public.plataforma_cobrancas(uuid, integer) to authenticated;

create or replace function public.plataforma_dar_baixa(cobranca uuid, nota text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  st text;
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select c.status into st from public.cobrancas_mimo c where c.id = cobranca;
  if st is null then raise exception 'Cobrança não encontrada.'; end if;
  if st = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;
  if st not in ('a_criar', 'aguardando', 'falhou', 'expirado') then
    raise exception 'Essa cobrança foi cancelada (o salão escolheu outra opção). Só dá baixa em cobrança aberta.';
  end if;
  r := public.cobranca_mimo_confirmar(cobranca, null, now());
  update public.cobrancas_mimo
     set baixa_manual_por = auth.uid(), baixa_manual_em = now(), baixa_manual_nota = nullif(btrim(coalesce(nota, '')), '')
   where id = cobranca;
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('ok', true, 'manual', true);
end;
$$;
revoke execute on function public.plataforma_dar_baixa(uuid, text) from public, anon;
grant execute on function public.plataforma_dar_baixa(uuid, text) to authenticated;

do $$ begin raise notice '229: a Plataforma dá baixa à mão numa mensalidade aberta (plataforma_cobrancas, plataforma_dar_baixa)'; end $$;
