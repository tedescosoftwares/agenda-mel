-- =============================================================
-- Agenda Mel — 047: 'pendente' sem pedido é promessa que ninguém cumpre
--
-- A bancada de testes achou isto no primeiro uso, e é defeito meu, da
-- migração 041.
--
-- O gatilho decide entre três mundos:
--
--   a cliente marcou   + aceite ligado  -> abre pedido para a profissional
--   quem marcou é ela  + aceite desligado -> confirma na hora
--   a DONA marcou pela agenda            -> ??? 
--
-- O terceiro caso caía no vazio. A condição do primeiro ramo exige
-- `not eh_dona`, e a do segundo exige `not manual`. Quando a dona marca
-- para uma cliente e a profissional tem aceite ligado, nenhuma das duas
-- vale: o agendamento fica 'pendente' e ali morre.
--
-- Pendente sem pedido é o pior estado possível. Não existe aceite para
-- ninguém responder, resolver_aceites_vencidos() não o enxerga (ele
-- procura na tabela de aceites), não aparece em meus_pedidos(), e a
-- cliente foi avisada de que "assim que confirmar, eu te aviso". Fica
-- esperando um aviso que nenhuma linha de código vai mandar.
--
-- A intenção do 041 estava escrita no comentário e não no código: a
-- casa marcando pela agenda está decidindo pela casa, então não pede
-- licença a si mesma — ou seja, confirma. Agora o código diz isso.
-- =============================================================

create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  eh_dona boolean;
  r jsonb;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual into conta, manual
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;                      -- profissional sem conta de login
  end if;

  if conta = new.client_id or conta = auth.uid() then
    return new;                      -- ela mesma, olhando a tela
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);

  if coalesce(manual, false) and not eh_dona and new.status = 'pendente' then
    -- a cliente marcou e a profissional quer decidir: abre o pedido
    r := public.pedir_aceite(new.id);
    if coalesce((r ->> 'ok')::boolean, false) then
      return new;
    end if;
    -- não deu para perguntar (sem telefone): confirma e avisa, porque
    -- deixar pendente para sempre é pior do que decidir
    update public.appointments set status = 'confirmado' where id = new.id;

  elsif new.status = 'pendente' then
    -- Todo o resto: ou ela desligou o "pedir minha confirmação", ou quem
    -- marcou foi a casa pela agenda. Nos dois casos não há a quem
    -- perguntar, e um só ramo cobre os dois — era a falta deste `else`
    -- que deixava o agendamento pendurado.
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- E resgatar quem já ficou pendurado: pendente, sem pedido nenhum,
-- ninguém para responder. Confirmar é a leitura honesta — a cliente foi
-- avisada de que o horário estava guardado, e a profissional recebeu o
-- 'novo_agendamento' na hora.
update public.appointments a
set status = 'confirmado'
where a.status = 'pendente'
  and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id);
