-- 241 · A assistente vê os horários livres do dia inteiro (3.96.1)
--
-- bot_horarios (069) devolvia só os 14 primeiros horários livres do dia. Como a agenda anda de 30 em 30 minutos, num
-- salão que abre às 8h a lista parava às 14h30: num dia que vai até as 18h, um serviço de 90 minutos pode começar até
-- 16h30, e a assistente dizia à cliente que o último horário era 14h30. Agora vêm todos os horários livres (no máximo
-- 48 num dia de 24 horas), mais o primeiro, o último e quantos são, para ela dizer até que horas tem vaga sem contar
-- a lista. O resto não muda: mesmas checagens, mesma duração pelo serviço, mesmas permissões.

create or replace function public.bot_horarios(salao uuid, profissional_id uuid, dia date, servico_id uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare dur integer := 60; horas text[]; nome text;
begin
  if not exists (select 1 from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active) then
    return jsonb_build_object('erro', 'profissional não é deste salão');
  end if;
  if dia < (now() at time zone 'America/Sao_Paulo')::date then return jsonb_build_object('erro', 'esse dia já passou', 'horarios', '[]'::jsonb); end if;
  if dia > (now() at time zone 'America/Sao_Paulo')::date + 60 then return jsonb_build_object('erro', 'só até 60 dias à frente', 'horarios', '[]'::jsonb); end if;
  if servico_id is not null then select s.duration_minutes into dur from public.services s where s.id = servico_id; end if;
  select coalesce(array_agg(to_char(h.hora, 'HH24:MI') order by h.hora), '{}'::text[]) into horas
    from public.horarios_livres(profissional_id, dia, coalesce(dur, 60)) h;
  select p.name into nome from public.professionals p where p.id = profissional_id;
  return jsonb_build_object(
    'profissional', nome,
    'dia', to_char(dia, 'YYYY-MM-DD'),
    'minutos', dur,
    'total', cardinality(horas),
    'primeiro', horas[1],
    'ultimo', horas[cardinality(horas)],
    'horarios', to_jsonb(horas));
end;
$$;
revoke execute on function public.bot_horarios(uuid, uuid, date, uuid) from public, anon, authenticated;
