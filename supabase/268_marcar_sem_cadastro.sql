-- 268 (4.13): marcar sem criar conta. A cliente dá nome, sobrenome e WhatsApp na página do salão e já escolhe o horário.
--
-- Por baixo ela ganha uma conta leve, sem senha e sem e-mail (a mesma do cadastro pelo WhatsApp, 3.98): o resto do
-- sistema (limite de horários abertos, lembretes, cancelar, remarcar, avaliar) continua igual. A diferença para a
-- conta feita pela assistente: aqui o número NÃO foi conferido (ela só digitou). Por isso:
--   • o telefone fica sem phone_verificado_em até ela abrir o link que vai pelo WhatsApp (isso prova que o número é dela);
--   • um número que já tem conta nunca entra só por digitar: recebe o link no WhatsApp ou usa a senha;
--   • quando a dona de verdade do número abre o link, as sessões antigas daquela conta caem (quem digitou o número
--     de outra pessoa não fica dentro da conta dela).
--
-- Liga e desliga em config_publica.agendar_sem_cadastro ('ligado' | 'desligado'), pela Plataforma › Configurações.
-- Quem cria a conta é a função acesso (ação visita), com a chave de serviço; nada aqui é chamado pelo navegador.

insert into public.config_publica (chave, valor) values ('agendar_sem_cadastro', 'ligado')
on conflict (chave) do nothing;

-- a conta recém-criada pelo site: aceita lembrete (é para isso o WhatsApp), sem e-mail, telefone ainda não conferido
create or replace function public.cliente_da_visita(conta uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles p set accepts_reminders = true, aceita_email = false where p.id = conta;
$$;
revoke execute on function public.cliente_da_visita(uuid) from public, anon, authenticated;

-- "Receber link no WhatsApp": a conta daquele número. Antes só valia telefone conferido (conta_para_entrar); a conta
-- feita pelo site ainda não foi conferida, e o link é justamente o que confere. Então: a conferida, se houver uma só;
-- senão a não conferida, se houver uma só. O link só chega no WhatsApp daquele número.
create or replace function public.conta_para_link(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  with c as (
    select p.id, p.phone_verificado_em is not null as conferido
      from public.profiles p
     where public.telefone_chave(p.phone) = public.telefone_chave(tel)
  )
  select case
    when (select count(*) from c where conferido) = 1 then (select id from c where conferido)
    when (select count(*) from c where conferido) = 0 and (select count(*) from c) = 1 then (select id from c)
  end;
$$;
revoke execute on function public.conta_para_link(text) from public, anon, authenticated;

-- ela abriu o link que foi para o WhatsApp dela: o número está conferido. Devolve true quando NÃO estava (a função
-- acesso então derruba as sessões antigas da conta).
create or replace function public.conta_conferida_pelo_link(conta uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare era_nova boolean;
begin
  select p.phone_verificado_em is null into era_nova from public.profiles p where p.id = conta;
  if coalesce(era_nova, false) then
    update public.profiles p set phone_verificado_em = now() where p.id = conta;
  end if;
  return coalesce(era_nova, false);
end;
$$;
revoke execute on function public.conta_conferida_pelo_link(uuid) from public, anon, authenticated;

-- derruba as sessões de uma conta (quem estava dentro precisa entrar de novo). O token que já está no navegador ainda
-- vale até vencer (no máximo 1 hora); depois disso não renova.
create or replace function public.conta_encerrar_sessoes(conta uuid)
returns integer
language plpgsql
security definer set search_path = public, auth
as $$
#variable_conflict use_variable
declare n integer := 0;
begin
  begin
    delete from auth.sessions s where s.user_id = conta;
    get diagnostics n = row_count;
  exception when others then
    n := -1;   -- sem permissão no esquema auth: a senha nova já foi gravada, a sessão antiga vence sozinha
  end;
  return n;
end;
$$;
revoke execute on function public.conta_encerrar_sessoes(uuid) from public, anon, authenticated;
