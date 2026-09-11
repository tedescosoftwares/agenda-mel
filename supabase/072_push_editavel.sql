-- 072 · Os avisos no celular (push) viram modelos editáveis
--
-- Igual ao que a 068 fez com o WhatsApp: cada tipo de aviso que o
-- código dispara por notificar() ganha um modelo em Plataforma ›
-- Mensagens › Push, com título e texto editáveis, regra liga/desliga,
-- prévia e teste nos aparelhos de quem está logada.
--
-- O código continua montando o título e o texto de sempre; o modelo
-- recebe os dois como {titulo} e {texto} e pode reescrever por cima,
-- usando também {nome} (primeiro nome de quem recebe) e, quando o
-- aviso é de um horário, {servico}, {profissional} e {quando}.
-- Formato do modelo: primeira linha = título, o resto = texto.
--
--   push_regras                 liga/desliga o push por tipo (o aviso no app continua)
--   modelos 'push.<tipo>'       grupo 'push'; exemplo jsonb alimenta a prévia
--   push_variaveis()            monta as variáveis a partir da carga do aviso
--   montar_push()               aplica o modelo editado, se houver
--   notificar()                 passa pelos dois antes de gravar
--   plataforma_previa(texto, chave)   prévia com o exemplo do modelo
--   plataforma_regra_push / plataforma_testar_push / plataforma_celulares_push

alter table public.modelos_de_mensagem drop constraint if exists modelos_de_mensagem_grupo_check;
alter table public.modelos_de_mensagem add constraint modelos_de_mensagem_grupo_check
  check (grupo in ('cliente', 'profissional', 'resposta', 'bot', 'ia', 'push'));
alter table public.modelos_de_mensagem add column if not exists exemplo jsonb not null default '{}'::jsonb;

create table if not exists public.push_regras (
  kind  text primary key,
  envia boolean not null default true
);
alter table public.push_regras enable row level security;
revoke all on public.push_regras from anon, authenticated;

-- ordem: 700–799 para a cliente, 800–899 para a profissional, 900+ outros
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.agendamento_confirmado', 'push', 'Horário confirmado', 'Quando o horário da cliente é aceito ou marcado direto.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 700,
  '{"titulo":"Horário confirmado","texto":"Manicure com Ana Oliveira dia 12/09 às 14:00."}'),
('push.lembrete_agendamento', 'push', 'Lembrete de véspera', 'Um dia antes do horário.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 705,
  '{"titulo":"Amanhã tem horário marcado","texto":"Manicure com Ana Oliveira dia 12/09 às 14:00."}'),
('push.pedido_aceito', 'push', 'Pedido aceito', 'A profissional aceitou o pedido de horário.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 710,
  '{"titulo":"Horário confirmado","texto":""}'),
('push.pedido_recusado', 'push', 'Pedido recusado', 'A profissional recusou, ou o prazo venceu.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 715,
  '{"titulo":"Horário não confirmado","texto":""}'),
('push.remarcacao_aceita', 'push', 'Remarcação aceita', 'A profissional aceitou o novo horário.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 720,
  '{"titulo":"Remarcado!","texto":""}'),
('push.remarcacao_recusada', 'push', 'Remarcação recusada', 'A profissional não pôde remarcar.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 725,
  '{"titulo":"Não deu para remarcar","texto":""}'),
('push.profissional_cancelou', 'push', 'Profissional cancelou', 'A profissional cancelou o horário da cliente.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 730,
  '{"titulo":"Horário cancelado","texto":"Ana Oliveira precisou cancelar."}'),
('push.vaga_disponivel', 'push', 'Vaga da lista de espera', 'Abriu vaga para quem estava na fila. Fica guardada por alguns minutos.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 735,
  '{"titulo":"Abriu uma vaga! 🎉","texto":"Studio Mel tem Manicure livre dia 12/09 às 14:00. A vaga fica guardada para você por 30 minutos."}'),
('push.agenda_adiantada', 'push', 'Adiantar horário', 'Proposta de adiantar e as respostas (aceitou, recusou, voltou). O código muda o título conforme o caso: mantenha {titulo}.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 740,
  '{"titulo":"Dá para adiantar seu horário?","texto":"Ana Oliveira pode te atender às 13:00 em vez de 14:00 (12/09). Responda em até 30 minutos."}'),
('push.pos_atendimento', 'push', 'Depois do atendimento', 'Agradecimento e, quando o serviço tem retoque, a sugestão de data.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 745,
  '{"titulo":"Obrigada pela visita","texto":"Manicure costuma pedir retoque em 20 dias — por volta de 02/10."}'),
('push.convite_retorno', 'push', 'Convite de retorno', 'A profissional guardou um horário e chamou a cliente de volta.', '{titulo,texto,nome,profissional}', E'{titulo}\n{texto}', 750,
  '{"titulo":"A Ana Oliveira guardou um horário para você","texto":"Que tal dia 02/10 às 14:00?"}'),
('push.indicacao_creditada', 'push', 'Crédito de indicação', 'Bônus de boas-vindas, crédito da indicada e crédito usado.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 755,
  '{"titulo":"Seu crédito chegou! 🎁","texto":"Carla fez o primeiro atendimento e você ganhou R$ 10,00 de crédito."}'),
('push.novo_agendamento', 'push', 'Horário novo', 'Entrou horário na agenda (marcado direto ou pela lista de espera).', '{titulo,texto,nome,servico,quando}', E'{titulo}\n{texto}', 800,
  '{"titulo":"Horário novo na sua agenda","texto":""}'),
('push.pedido_de_aceite', 'push', 'Pedido de horário', 'A cliente pediu e a profissional precisa responder.', '{titulo,texto,nome,servico,quando}', E'{titulo}\n{texto}', 805,
  '{"titulo":"Pedido de horário","texto":"Juliana quer Manicure sábado, 12/09 às 14:00"}'),
('push.pedido_pelo_whatsapp', 'push', 'Pedido pelo WhatsApp', 'O bot recebeu um pedido que precisa de uma pessoa.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 810,
  '{"titulo":"Pedido de horário no WhatsApp","texto":"Juliana: queria marcar unha pra sábado à tarde"}'),
('push.agendamento_cancelado', 'push', 'Cliente cancelou', 'A cliente cancelou pelo WhatsApp.', '{titulo,texto,nome,servico,quando}', E'{titulo}\n{texto}', 815,
  '{"titulo":"Cancelou pelo WhatsApp","texto":"Juliana cancelou 12/09 às 14:00."}'),
('push.cancelou_comigo', 'push', 'Cancelaram um horário', 'A cliente cancelou ou desistiu do pedido pelo app.', '{titulo,texto,nome,servico,quando}', E'{titulo}\n{texto}', 820,
  '{"titulo":"Cancelaram um horário","texto":""}'),
('push.atendimento_humano', 'push', 'Cliente quer falar com você', 'A cliente pediu uma pessoa no WhatsApp; o bot se cala por 2h.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 825,
  '{"titulo":"Juliana quer falar com você","texto":"Pediu para falar com uma pessoa."}'),
('push.afiliado_novo', 'push', 'Trouxe uma profissional', 'Quem indicou uma profissional que entrou no app.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 900,
  '{"titulo":"Você trouxe uma profissional! 💼","texto":"A partir de agora você recebe uma parte da taxa do app sempre que ela atender pelo aplicativo."}'),
('push.afiliado_cashback', 'push', 'Cashback de indicação', 'A indicada atendeu e quem indicou recebeu.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 905,
  '{"titulo":"Cashback na conta 💰","texto":"Ana Oliveira atendeu pelo app e você recebeu R$ 1,50."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, padrao = excluded.padrao, ordem = excluded.ordem, exemplo = excluded.exemplo;

insert into public.push_regras (kind, envia)
select substr(m.chave, 6), true from public.modelos_de_mensagem m where m.grupo = 'push'
on conflict (kind) do nothing;

-- as variáveis de um aviso: o que o código escreveu + quem recebe + o horário, se houver
create or replace function public.push_variaveis(destinatario uuid, titulo text, texto text, carga jsonb)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare vars jsonb; appt uuid; a record;
begin
  vars := jsonb_build_object(
    'titulo', coalesce(titulo, ''),
    'texto', coalesce(texto, ''),
    'nome', coalesce((select nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') from public.profiles p where p.id = destinatario), ''),
    'link_app', public.app_base() || '/');
  begin
    appt := nullif(coalesce(carga, '{}'::jsonb) ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;
  if appt is not null then
    select coalesce(ap.service_name, s.name) as servico, pr.name as profissional,
           to_char(ap.date, 'DD/MM') || ' às ' || to_char(ap.start_time, 'HH24:MI') as quando
      into a
      from public.appointments ap
      left join public.services s on s.id = ap.service_id
      left join public.professionals pr on pr.id = coalesce(nullif(carga ->> 'professional_id', '')::uuid, ap.professional_id)
     where ap.id = appt;
    if found then
      vars := vars || jsonb_build_object('servico', coalesce(a.servico, ''), 'profissional', coalesce(a.profissional, ''), 'quando', coalesce(a.quando, ''));
    end if;
  end if;
  return vars;
end;
$$;
revoke execute on function public.push_variaveis(uuid, text, text, jsonb) from public, anon, authenticated;

-- aplica o modelo editado do tipo (se houver): primeira linha vira o
-- título, o resto o texto. Sem modelo editado, devolve o que veio.
create or replace function public.montar_push(tipo text, destinatario uuid, titulo text, texto text, carga jsonb)
returns table (titulo_ text, texto_ text)
language plpgsql
stable
security definer set search_path = public
as $$
declare modelo text; saida text; linhas text[];
begin
  modelo := public.modelo_editado('push.' || tipo);
  if modelo is null then
    titulo_ := titulo; texto_ := texto; return next; return;
  end if;
  saida := public.renderizar_modelo(modelo, public.push_variaveis(destinatario, titulo, texto, carga));
  linhas := regexp_split_to_array(coalesce(saida, ''), E'\n');
  titulo_ := nullif(btrim(coalesce(linhas[1], '')), '');
  texto_ := nullif(btrim(array_to_string(linhas[2:], E'\n')), '');
  if titulo_ is null then titulo_ := titulo; end if;   -- modelo que não sobrou título: fica o de sempre
  return next;
end;
$$;
revoke execute on function public.montar_push(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- notificar(): mesma assinatura da 063, passando pelo modelo e pela regra de push
create or replace function public.notificar(
  destinatario uuid,
  tipo text,
  titulo text,
  texto text default null,
  url text default null,
  carga jsonb default '{}',
  vence_em timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
  carga_ok jsonb := coalesce(carga, '{}'::jsonb);
  prof uuid;
  appt uuid;
  corpo text;
  regra record;
  pessoa record;
  e record;
  link text;
  m record;
  titulo_app text := titulo;
  texto_app text := texto;
  push_ligado boolean := true;
begin
  -- o aviso no app e o push podem ter sido reescritos na plataforma
  begin
    select * into m from public.montar_push(tipo, destinatario, titulo, texto, carga_ok);
    if found then titulo_app := m.titulo_; texto_app := m.texto_; end if;
  exception when others then null;
  end;
  begin
    select r.envia into push_ligado from public.push_regras r where r.kind = tipo;
    if not found then push_ligado := true; end if;
  exception when others then push_ligado := true;
  end;

  insert into public.notifications (user_id, kind, title, body, action_url, data, expires_at, push_em, push_resultado)
  values (destinatario, tipo, titulo_app, texto_app, url, carga_ok, vence_em,
          case when push_ligado then null else now() end,
          case when push_ligado then null else 'desligado na plataforma' end)
  returning id into novo_id;

  corpo := coalesce(nullif(btrim(coalesce(texto, '')), ''), titulo);

  begin
    prof := nullif(carga_ok ->> 'professional_id', '')::uuid;
  exception when others then prof := null;
  end;

  begin
    appt := nullif(carga_ok ->> 'appointment_id', '')::uuid;
  exception when others then appt := null;
  end;

  begin
    perform public.enfileirar_whatsapp(novo_id, destinatario, tipo, corpo, prof, appt, titulo);
  exception when others then
    null;
  end;

  -- e-mail: só os tipos marcados, só quem tem e-mail e não desligou
  begin
    select * into regra from public.email_regras r where r.kind = tipo and r.envia;
    if found then
      select u.email, p.full_name, p.aceita_email
        into pessoa
        from auth.users u
        join public.profiles p on p.id = u.id
       where u.id = destinatario;
      if found and pessoa.email is not null and pessoa.aceita_email then
        link := public.app_base() || case when url is null or url = '' then '/' when left(url, 1) = '/' then url else '/' || url end;
        select * into e from public.email_aviso(pessoa.full_name, titulo, texto, regra.chamada, link);
        perform public.enfileirar_email(pessoa.email, e.assunto, e.html, tipo, e.texto, pessoa.full_name, destinatario);
      end if;
    end if;
  exception when others then
    null;
  end;

  -- push e e-mail saem agora, uma chamada por transação
  perform public.chutar_agora();

  return novo_id;
end;
$$;
revoke execute on function
  public.notificar(uuid, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- ---- a plataforma ---------------------------------------------------------

drop function if exists public.plataforma_modelos();
create function public.plataforma_modelos()
returns table (chave text, grupo text, titulo text, descricao text, variaveis text[], padrao text, texto text, ordem integer,
               atualizado_em timestamptz, envia boolean, natureza text, sufixo text, exemplo jsonb)
language sql
stable
security definer set search_path = public
as $$
  select m.chave, m.grupo, m.titulo, m.descricao, m.variaveis, m.padrao, m.texto, m.ordem, m.atualizado_em,
         case when m.grupo = 'push' then p.envia else r.envia end, r.natureza, r.sufixo, m.exemplo
  from public.modelos_de_mensagem m
  left join public.whatsapp_regras r on m.grupo <> 'push' and r.kind = m.chave
  left join public.push_regras p on m.grupo = 'push' and p.kind = substr(m.chave, 6)
  where public.eh_plataforma()
  order by m.ordem, m.chave;
$$;
revoke execute on function public.plataforma_modelos() from public, anon;
grant execute on function public.plataforma_modelos() to authenticated;

-- prévia: os dados de exemplo de sempre, e por cima o exemplo do modelo (título/texto do tipo)
drop function if exists public.plataforma_previa(text);
drop function if exists public.plataforma_previa(text, text);
create function public.plataforma_previa(texto_ text, chave_ text default null)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case when public.eh_plataforma() then public.renderizar_modelo(texto_, jsonb_build_object(
    'nome', 'Juliana', 'nome_agenda', 'Juliana Silva', 'telefone_cliente', '(13) 99999-0000',
    'servico', 'Manicure', 'profissional', 'Ana Oliveira', 'quando', '12/09 às 14:00', 'quando_longo', 'sábado, 12/09 às 14:00',
    'quando_antes', 'sexta, 11/09 às 10:00', 'prazo', '120', 'link', public.app_base() || '/p/ana-oliveira', 'link_app', public.app_base() || '/',
    'titulo', 'Título do aviso', 'corpo', 'Corpo do aviso', 'texto', 'Texto do aviso')
    || coalesce((select m.exemplo from public.modelos_de_mensagem m where m.chave = chave_), '{}'::jsonb)) end;
$$;
revoke execute on function public.plataforma_previa(text, text) from public, anon;
grant execute on function public.plataforma_previa(text, text) to authenticated;

create or replace function public.plataforma_regra_push(kind_ text, envia_ boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if not exists (select 1 from public.modelos_de_mensagem where chave = 'push.' || kind_) then raise exception 'Tipo % não existe.', kind_; end if;
  insert into public.push_regras (kind, envia) values (kind_, coalesce(envia_, true))
  on conflict (kind) do update set envia = excluded.envia;
end;
$$;
revoke execute on function public.plataforma_regra_push(text, boolean) from public, anon;
grant execute on function public.plataforma_regra_push(text, boolean) to authenticated;

-- quantos aparelhos com avisos ligados tem quem está logada (ou alguém, pelo e-mail)
create or replace function public.plataforma_celulares_push(email_ text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare alvo uuid; n integer; nome text;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if nullif(btrim(coalesce(email_, '')), '') is null then
    alvo := auth.uid();
  else
    select u.id into alvo from auth.users u where lower(u.email) = lower(btrim(email_));
    if alvo is null then return jsonb_build_object('ok', false, 'motivo', 'Ninguém com esse e-mail.'); end if;
  end if;
  select count(*) into n from public.push_subscriptions s where s.user_id = alvo;
  select p.full_name into nome from public.profiles p where p.id = alvo;
  return jsonb_build_object('ok', true, 'celulares', n, 'nome', nome);
end;
$$;
revoke execute on function public.plataforma_celulares_push(text) from public, anon;
grant execute on function public.plataforma_celulares_push(text) to authenticated;

-- manda o modelo (com os dados de exemplo) para os aparelhos de quem está logada, ou de alguém pelo e-mail
create or replace function public.plataforma_testar_push(chave_ text, texto_ text, email_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare alvo uuid; n integer; saida text; linhas text[]; tit text; corpo text; nome text;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  if nullif(btrim(coalesce(email_, '')), '') is null then
    alvo := auth.uid();
  else
    select u.id into alvo from auth.users u where lower(u.email) = lower(btrim(email_));
    if alvo is null then raise exception 'Ninguém com o e-mail %.', btrim(email_); end if;
  end if;
  select count(*) into n from public.push_subscriptions s where s.user_id = alvo;
  if n = 0 then
    raise exception 'Nenhum aparelho com avisos ligados. Instale o app, entre com essa conta e permita os avisos.';
  end if;
  saida := public.plataforma_previa(texto_, chave_);
  linhas := regexp_split_to_array(coalesce(saida, ''), E'\n');
  tit := coalesce(nullif(btrim(coalesce(linhas[1], '')), ''), 'Teste do MIMO');
  corpo := nullif(btrim(array_to_string(linhas[2:], E'\n')), '');
  perform public.notificar(alvo, 'teste_push', tit, corpo, '/plataforma/mensagens', jsonb_build_object('teste', true));
  select p.full_name into nome from public.profiles p where p.id = alvo;
  return jsonb_build_object('ok', true, 'celulares', n, 'nome', nome, 'titulo', tit, 'texto', corpo);
end;
$$;
revoke execute on function public.plataforma_testar_push(text, text, text) from public, anon;
grant execute on function public.plataforma_testar_push(text, text, text) to authenticated;
