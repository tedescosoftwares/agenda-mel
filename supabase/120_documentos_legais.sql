-- 120: os documentos legais, versionados pela plataforma. Quatro tipos
-- (termos para clientes, para profissionais, para salões, e a política de
-- privacidade), cada um com versões: rascunho até publicar, e o publicado
-- mais recente é o que vale. O aceite grava documento + versão por pessoa
-- (aceites_de_termos), além do resumo que profiles já guardava
-- (aceitou_termos_em / termos_versao = a maior versão aceita). Quando a
-- plataforma publica uma versão nova, quem aceitou a antiga aceita de novo
-- na próxima entrada.

-- 1. Os documentos ------------------------------------------------------------
create table if not exists public.documentos_legais (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('cliente', 'profissional', 'salao', 'privacidade')),
  versao text not null check (versao ~ '^\d{4}-\d{2}-\d{2}$'),
  titulo text not null,
  conteudo text not null default '',
  resumo text,                       -- o que mudou nesta versão, em uma frase
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  publicado_em timestamptz,
  criado_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tipo, versao)
);
create index if not exists documentos_legais_vigente_idx on public.documentos_legais (tipo, publicado_em desc) where status = 'publicado';

alter table public.documentos_legais enable row level security;
drop policy if exists "legal: publicados sao publicos" on public.documentos_legais;
create policy "legal: publicados sao publicos" on public.documentos_legais for select to anon, authenticated
  using (status = 'publicado' or public.eh_plataforma());
drop policy if exists "legal: plataforma escreve" on public.documentos_legais;
create policy "legal: plataforma escreve" on public.documentos_legais for all to authenticated
  using (public.eh_plataforma()) with check (public.eh_plataforma());

create or replace function public.documentos_legais_atualizado()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  if new.status = 'publicado' and (old.status is distinct from 'publicado' or new.publicado_em is null) then new.publicado_em := coalesce(new.publicado_em, now()); end if;
  -- uma versão publicada não muda de texto: publica outra
  if tg_op = 'UPDATE' and old.status = 'publicado' and new.conteudo is distinct from old.conteudo then
    raise exception 'Uma versão publicada não pode ser editada. Crie uma versão nova.';
  end if;
  return new;
end;
$$;
drop trigger if exists documentos_legais_atualizado_tg on public.documentos_legais;
create trigger documentos_legais_atualizado_tg before insert or update on public.documentos_legais
  for each row execute function public.documentos_legais_atualizado();

-- o que vale agora, por tipo
create or replace function public.documentos_vigentes()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(d.tipo, jsonb_build_object('versao', d.versao, 'titulo', d.titulo, 'conteudo', d.conteudo, 'publicado_em', d.publicado_em, 'resumo', d.resumo)), '{}'::jsonb)
  from (select distinct on (tipo) * from public.documentos_legais where status = 'publicado' order by tipo, publicado_em desc, versao desc) d;
$$;
grant execute on function public.documentos_vigentes() to anon, authenticated;

-- 2. Os aceites -----------------------------------------------------------------
create table if not exists public.aceites_de_termos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('cliente', 'profissional', 'salao', 'privacidade')),
  versao text not null,
  contexto text,                     -- cadastro, primeiro_acesso, nova_versao…
  aceito_em timestamptz not null default now()
);
create index if not exists aceites_de_termos_user_idx on public.aceites_de_termos (user_id, tipo, aceito_em desc);
alter table public.aceites_de_termos enable row level security;
drop policy if exists "aceites: cada uma ve os seus" on public.aceites_de_termos;
create policy "aceites: cada uma ve os seus" on public.aceites_de_termos for select to authenticated
  using (user_id = auth.uid() or public.eh_plataforma());
revoke insert, update, delete on public.aceites_de_termos from anon, authenticated;

create or replace function public.aceitar_documentos_interno(conta uuid, aceites jsonb, contexto text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare k text; v text; maior text;
begin
  if aceites is null or jsonb_typeof(aceites) <> 'object' then return; end if;
  for k, v in select * from jsonb_each_text(aceites) loop
    if k in ('cliente', 'profissional', 'salao', 'privacidade') and v ~ '^\d{4}-\d{2}-\d{2}$' then
      insert into public.aceites_de_termos (user_id, tipo, versao, contexto) values (conta, k, v, contexto);
      if maior is null or v > maior then maior := v; end if;
    end if;
  end loop;
  if maior is not null then
    update public.profiles set aceitou_termos_em = now(), termos_versao = greatest(coalesce(termos_versao, ''), maior) where id = conta;
  end if;
end;
$$;
revoke execute on function public.aceitar_documentos_interno(uuid, jsonb, text) from public, anon, authenticated;

-- { "cliente": "2026-09-24", "privacidade": "2026-09-24" }
create or replace function public.aceitar_documentos(aceites jsonb, contexto text default 'app')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  perform public.aceitar_documentos_interno(auth.uid(), aceites, contexto);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.aceitar_documentos(jsonb, text) from public, anon;
grant execute on function public.aceitar_documentos(jsonb, text) to authenticated;

create or replace function public.meus_aceites()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(a.tipo, jsonb_build_object('versao', a.versao, 'aceito_em', a.aceito_em)), '{}'::jsonb)
  from (select distinct on (tipo) * from public.aceites_de_termos where user_id = auth.uid() order by tipo, aceito_em desc, versao desc) a;
$$;
revoke execute on function public.meus_aceites() from public, anon;
grant execute on function public.meus_aceites() to authenticated;

-- o cadastro traz os aceites por documento (meta.aceites), além do resumo (meta.termos)
create or replace function public.termos_do_cadastro()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v text := nullif(btrim(coalesce(meta ->> 'termos', '')), '');
  nasc date;
begin
  begin
    nasc := nullif(meta ->> 'nascimento', '')::date;
  exception when others then nasc := null;
  end;
  update public.profiles
     set aceitou_termos_em = case when v is not null then now() else aceitou_termos_em end,
         termos_versao = coalesce(v, termos_versao),
         nascimento = coalesce(nasc, nascimento)
   where id = new.id;
  if jsonb_typeof(meta -> 'aceites') = 'object' then
    begin
      perform public.aceitar_documentos_interno(new.id, meta -> 'aceites', 'cadastro');
    exception when others then
      raise notice 'aceites de % não gravados: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- a plataforma vê quantas pessoas já aceitaram cada versão
create or replace function public.aceites_por_versao()
returns table (tipo text, versao text, pessoas bigint, ultimo timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select a.tipo, a.versao, count(distinct a.user_id), max(a.aceito_em)
  from public.aceites_de_termos a
  where public.eh_plataforma()
  group by a.tipo, a.versao;
$$;
revoke execute on function public.aceites_por_versao() from public, anon;
grant execute on function public.aceites_por_versao() to authenticated;

-- 3. A primeira versão: os documentos de 24/09/2026 ----------------------------
insert into public.documentos_legais (tipo, versao, titulo, conteudo, status, publicado_em, resumo) values ('cliente', '2026-09-24', $legal$Termos de Uso para Clientes$legal$, $legal$## 1. Sobre a MIMO

A MIMO é uma plataforma digital que ajuda clientes a se relacionarem com salões de beleza e profissionais, permitindo consultar serviços e horários disponíveis, solicitar ou realizar agendamentos, remarcar ou cancelar horários, receber avisos e acompanhar o histórico de atendimento.

A plataforma é operada pela MIMO Desenvolvimento de Software Não Customizável Ltda. (“MIMO”). Ao criar uma conta ou utilizar os recursos da plataforma destinados a clientes, você concorda com estes Termos de Uso.

## 2. Sua conta

Para utilizar determinadas funcionalidades, você deverá criar uma conta e fornecer os dados solicitados pela MIMO.

Você se compromete a fornecer informações verdadeiras e atualizadas, não utilizar dados de outra pessoa sem autorização, manter suas credenciais protegidas e comunicar a MIMO caso perceba uso não autorizado da conta.

A conta é pessoal e não deve ser compartilhada. Contas de menores de idade somente poderão ser utilizadas nas condições permitidas pela legislação e com participação do responsável legal quando aplicável.

## 3. Relação com salões e profissionais

A MIMO fornece a tecnologia utilizada para organização, relacionamento e agendamento. Os serviços de beleza são prestados diretamente pelo salão ou profissional escolhido.

Informações relacionadas à execução do serviço, qualidade técnica, produtos utilizados, condições específicas do atendimento, políticas comerciais próprias, atrasos e disponibilidade são de responsabilidade do estabelecimento ou profissional responsável pelo atendimento.

A MIMO não executa serviços de beleza.

## 4. Acesso aos salões e profissionais

A MIMO não funciona necessariamente como um catálogo público de todos os profissionais cadastrados.

Seu acesso a determinado salão ou profissional poderá ocorrer por QR Code, link, código, convite, relacionamento previamente existente ou outro mecanismo disponibilizado pela MIMO.

Quando você acessa a MIMO por um desses meios, o sistema poderá registrar a origem desse relacionamento para organizar sua experiência dentro da plataforma.

## 5. Agendamentos

Ao solicitar ou confirmar um horário, confira o serviço escolhido, profissional, data, horário, duração estimada, preço informado e regras apresentadas pelo estabelecimento.

Nem toda solicitação representa automaticamente um agendamento confirmado. Quando o estabelecimento trabalhar com aprovação manual, o horário somente estará confirmado depois dessa aprovação.

A MIMO exibirá o status do agendamento sempre que possível.

## 6. Cancelamentos, atrasos e faltas

Cada salão ou profissional poderá definir regras próprias sobre antecedência mínima, cancelamento, reagendamento, atraso, falta e sinal ou reserva, quando esses recursos estiverem disponíveis.

Essas condições devem ser apresentadas de forma clara quando aplicáveis. Nenhuma regra criada pelo salão ou profissional afasta direitos garantidos pela legislação.

## 7. Preços

Os preços dos serviços são cadastrados pelos salões ou profissionais.

Alguns serviços poderão aparecer como “a partir de” quando o valor final depender, por exemplo, de comprimento, volume, quantidade de produto, técnica utilizada ou avaliação profissional. Nesses casos, o valor final deverá ser esclarecido pelo estabelecimento ou profissional.

## 8. Pagamentos

Quando o pagamento ocorrer fora da MIMO, a negociação e o pagamento são realizados diretamente entre cliente e estabelecimento ou profissional.

Se a MIMO passar a disponibilizar pagamentos, sinal ou outros recursos financeiros dentro da plataforma, as condições, tarifas e prestadores envolvidos serão informados antes do uso. Recursos financeiros poderão depender de termos adicionais.

## 9. Comunicações

A MIMO poderá enviar comunicações relacionadas ao funcionamento da plataforma e aos seus agendamentos, incluindo confirmação, lembrete, cancelamento, alteração de horário, solicitação de confirmação, mensagens operacionais e segurança da conta.

Essas comunicações poderão ocorrer pelo aplicativo, notificações, e-mail ou WhatsApp, conforme a funcionalidade utilizada. Comunicações promocionais não essenciais poderão ser controladas de acordo com as preferências disponibilizadas pela MIMO.

## 10. Avaliações e conteúdo

Quando a MIMO permitir avaliações, comentários, fotos ou outros conteúdos, você será responsável pelo conteúdo publicado.

Não é permitido publicar conteúdo ilegal, discriminatório, ofensivo, fraudulento, que exponha dados pessoais de terceiros indevidamente, viole direitos de terceiros ou tenha finalidade de spam. A MIMO poderá moderar ou remover conteúdo que viole estes Termos ou a legislação.

## 11. Privacidade

O tratamento de dados pessoais é explicado na Política de Privacidade da MIMO, documento separado destes Termos.

## 12. Disponibilidade

A MIMO trabalha para manter a plataforma funcionando adequadamente, mas poderão ocorrer indisponibilidades por manutenção, falhas de internet, infraestrutura, fornecedores externos, serviços de mensagens ou eventos fora do controle razoável da MIMO.

Sempre que possível, a MIMO trabalhará para restabelecer o serviço.

## 13. Suspensão e encerramento

A MIMO poderá restringir ou suspender contas em situações de fraude, tentativa de invasão, assédio, uso ilegal, spam, violação destes Termos ou risco à segurança de usuários e da plataforma.

O usuário poderá solicitar o encerramento da conta pelos meios disponibilizados pela MIMO. O tratamento dos dados após o encerramento seguirá a Política de Privacidade e as obrigações legais aplicáveis.

## 14. Alterações destes Termos

Estes Termos poderão ser atualizados. Quando houver alteração relevante, a MIMO poderá solicitar novo aceite antes da continuidade do uso da plataforma.

A versão e a data do documento permanecerão disponíveis para consulta.

## 15. Lei aplicável

Estes Termos são regidos pela legislação brasileira. Quando existir relação de consumo, permanecem preservados os direitos assegurados pela legislação aplicável, inclusive o Código de Defesa do Consumidor.

## 16. Contato

Dúvidas ou solicitações: contato@mimo.com.vc$legal$, 'publicado', now(), 'Primeira versão publicada pela plataforma.') on conflict (tipo, versao) do nothing;
insert into public.documentos_legais (tipo, versao, titulo, conteudo, status, publicado_em, resumo) values ('profissional', '2026-09-24', $legal$Termos de Uso para Profissionais$legal$, $legal$## 1. Sobre estes Termos

Estes Termos regulam o uso da MIMO por profissionais que prestam serviços de beleza de forma autônoma ou que participam da operação de um salão cadastrado na plataforma.

Ao criar ou ativar uma conta profissional, você concorda com estas condições.

## 2. Profissional autônoma e profissional vinculada

Na MIMO, uma profissional poderá utilizar a plataforma como profissional autônoma, organizando sua própria agenda, serviços, clientes e horários, ou como profissional vinculada a um salão, utilizando uma agenda associada a um estabelecimento.

Quando vinculada a um salão, determinadas configurações poderão ser controladas pelo estabelecimento, incluindo serviços, preços, duração, horários, agenda, regras de atendimento, repasses, permissões e acesso a informações.

## 3. Convites de salões

Um salão poderá cadastrar previamente uma profissional e enviar um convite para ativação.

Nesse caso, ao aceitar o convite, a profissional poderá encontrar sua operação previamente configurada pelo salão, incluindo serviços atribuídos, agenda, horários, permissões, regras operacionais e informações de repasse.

A profissional deverá conferir essas informações e procurar o salão caso identifique divergências.

## 4. Tipo de vínculo na MIMO

Categorias exibidas pela MIMO, como profissional parceira, funcionária, autônoma vinculada, locatária de espaço ou temporária, servem para organização operacional da plataforma.

A seleção realizada dentro da MIMO, isoladamente, não cria, altera nem comprova a natureza jurídica da relação entre salão e profissional.

Quando salão e profissional pretenderem adotar regime jurídico específico, inclusive o de salão-parceiro e profissional-parceiro, deverão observar separadamente os requisitos legais e contratuais aplicáveis. A MIMO não substitui contrato trabalhista, societário, de parceria, locação ou prestação de serviços.

## 5. Sua conta

A profissional é responsável por manter seus dados atualizados, proteger suas credenciais, não compartilhar sua conta, utilizar somente os acessos e permissões concedidos e comunicar acesso indevido.

## 6. Agenda

Dependendo das permissões recebidas, a profissional poderá visualizar sua agenda, confirmar atendimentos, recusar solicitações, reagendar, cancelar, bloquear horários e visualizar informações relacionadas às próprias clientes.

O salão poderá restringir determinadas ações quando a agenda estiver sendo administrada pelo estabelecimento.

## 7. Serviços e preços

Quando a profissional estiver vinculada a um salão, os serviços, preços e duração poderão ser definidos pelo estabelecimento.

A MIMO poderá permitir configurações específicas por profissional. A profissional não deverá alterar ou divulgar valores diferentes dos registrados no sistema quando não possuir autorização para isso.

## 8. Clientes e informações

O acesso a clientes dependerá das permissões e do relacionamento existente dentro da MIMO.

Dados obtidos por meio da MIMO não poderão ser vendidos, utilizados para spam, compartilhados indevidamente, exportados para finalidade incompatível ou utilizados para prejudicar clientes, profissionais ou salões.

## 9. Origem dos relacionamentos

A MIMO poderá registrar se o relacionamento com uma cliente teve origem no salão, na profissional, em QR Code, link, convite ou em funcionalidade futura de descoberta ou aquisição.

Esse registro faz parte da organização da relação dentro da plataforma e poderá ser utilizado para aplicar funcionalidades ou regras comerciais previamente informadas.

## 10. Repasse e comissão

A MIMO poderá oferecer ferramentas para registrar percentuais ou critérios de repasse.

O simples cadastro de um percentual na plataforma não significa, por si só, realização automática de pagamento, reconhecimento de dívida pela MIMO, criação de vínculo jurídico ou validação fiscal ou trabalhista.

Salão e profissional são responsáveis por conferir os valores e cumprir suas respectivas obrigações legais e tributárias. Se a MIMO disponibilizar liquidação ou divisão automática de pagamentos, serão apresentadas condições específicas.

## 11. Responsabilidade pelo atendimento

A profissional é responsável pelos serviços que executar, incluindo qualidade, técnica, materiais utilizados, segurança, higiene, informações fornecidas à cliente e cumprimento de regras profissionais aplicáveis.

A MIMO fornece tecnologia e não executa o procedimento de beleza.

## 12. Comunicações

A MIMO poderá enviar notificações relacionadas a novos agendamentos, cancelamentos, alterações, mensagens, ativação, segurança e funcionamento da conta.

Preferências poderão ser configuradas quando disponíveis.

## 13. Encerramento do vínculo com um salão

O encerramento do acesso de uma profissional a determinado salão não significa necessariamente exclusão da identidade da profissional na MIMO.

A conta da profissional poderá continuar existindo quando houver base para isso e conforme as funcionalidades utilizadas. O histórico necessário à integridade de atendimentos, registros e obrigações poderá ser preservado conforme a Política de Privacidade e a legislação.

## 14. Suspensão

A MIMO poderá suspender ou restringir acessos em casos de fraude, violação de segurança, utilização ilegal, abuso, spam, uso indevido de dados ou violação destes Termos.

## 15. Privacidade

O tratamento de dados pessoais é disciplinado pela Política de Privacidade da MIMO.

## 16. Alterações

Alterações relevantes destes Termos poderão exigir novo aceite. A versão aceita deverá ser registrada pela MIMO.

## 17. Contato

Dúvidas ou solicitações: contato@mimo.com.vc$legal$, 'publicado', now(), 'Primeira versão publicada pela plataforma.') on conflict (tipo, versao) do nothing;
insert into public.documentos_legais (tipo, versao, titulo, conteudo, status, publicado_em, resumo) values ('salao', '2026-09-24', $legal$Termos de Uso para Salões e Estabelecimentos$legal$, $legal$## 1. Sobre estes Termos

Estes Termos de Uso regulam a utilização da plataforma MIMO por salões de beleza, estúdios, espaços de atendimento e outros estabelecimentos que utilizem funcionalidades destinadas à organização de agenda, equipe, clientes e operação.

A plataforma é operada por MIMO Desenvolvimento de Software Não Customizável Ltda., doravante denominada MIMO.

Ao cadastrar um estabelecimento, criar uma conta administrativa, contratar um plano ou utilizar as funcionalidades destinadas a salões, a pessoa responsável declara que possui autorização para representar o estabelecimento e concorda com estes Termos.

## 2. O que é a MIMO

A MIMO é uma plataforma tecnológica destinada à organização da rotina de negócios do setor de beleza.

- organização de agenda
- cadastro de serviços
- cadastro e gestão de profissionais
- configuração de horários
- relacionamento com clientes
- confirmações e lembretes
- comunicação com clientes
- lista de espera
- acompanhamento de retorno
- permissões de equipe
- registro de comissões e repasses
- relatórios operacionais

QR Codes, links e convites

recursos de pagamento, quando disponíveis

## 3. Responsabilidade pelas informações do estabelecimento

O salão é responsável por manter corretas e atualizadas as informações cadastradas na MIMO.

A MIMO poderá fornecer ferramentas para edição dessas informações, mas não é responsável pela veracidade de dados inseridos pelo estabelecimento.

- nome do estabelecimento
- endereço
- telefone e WhatsApp

CNPJ

- horários de funcionamento
- profissionais
- serviços
- preços
- duração dos serviços
- fotos
- políticas de atendimento
- regras de cancelamento e reagendamento
- demais informações exibidas aos clientes

## 4. Cadastro e gestão da equipe

O salão poderá cadastrar profissionais que façam parte de sua operação.

O estabelecimento declara possuir fundamento legítimo para fornecer à MIMO os dados necessários para cadastrar, convidar e administrar essas profissionais dentro de sua operação.

- nome
- telefone
- e-mail
- função ou especialidade
- serviços executados
- horários
- agenda
- regras de atendimento
- informações de comissão ou repasse
- permissões de acesso

## 5. Ativação da profissional

O salão poderá configurar a profissional antes da criação ou ativação da conta pessoal dela.

Nesse caso, a profissional poderá receber convite por link, WhatsApp, QR Code ou outro mecanismo disponibilizado pela MIMO.

A profissional poderá encontrar sua operação previamente configurada pelo salão, incluindo serviços, horários, agenda e permissões.

A ativação da conta pela profissional não significa que ela passa automaticamente a possuir poderes administrativos sobre o salão. As permissões continuarão sendo determinadas de acordo com a configuração do estabelecimento.

## 6. Relação entre salão e profissional

A MIMO permite que o estabelecimento organize diferentes formas de participação das profissionais na operação.

Essas classificações possuem finalidade operacional dentro da MIMO.

A escolha de uma categoria na plataforma, por si só, não constitui, transforma ou comprova a natureza jurídica da relação entre salão e profissional.

A MIMO não determina se determinada relação é trabalhista, societária, comercial, de parceria, de locação, de prestação de serviços ou de outra natureza.

O estabelecimento e a profissional são responsáveis pela formalização adequada da relação existente entre eles.

Quando adotado o regime de salão-parceiro e profissional-parceiro, as partes deverão observar os requisitos previstos na legislação aplicável.

A MIMO não substitui contratos, registros, obrigações fiscais, previdenciárias, trabalhistas ou contábeis.

- profissional parceira
- funcionária
- autônoma vinculada
- locatária de espaço
- profissional temporária
- outras categorias disponibilizadas no sistema

## 7. Serviços atribuídos às profissionais

O salão poderá determinar quais serviços cada profissional está autorizada a executar dentro do estabelecimento.

A plataforma poderá permitir que o salão defina, inclusive, preço, duração, disponibilidade, comissão, repasse e regras específicas por profissional.

Quando houver configurações específicas por profissional, essas configurações poderão prevalecer sobre os valores gerais do serviço, conforme funcionamento apresentado pela plataforma.

## 8. Horários e disponibilidade

O salão poderá definir um horário padrão de funcionamento e horários específicos para cada profissional.

A MIMO poderá utilizar essas informações para calcular disponibilidade de agenda.

O estabelecimento é responsável por manter os horários corretos e por registrar bloqueios, folgas, ausências ou outras situações que afetem a disponibilidade.

A MIMO não se responsabiliza por conflitos provocados por informações incorretas ou desatualizadas inseridas pelo salão ou por integrantes autorizados da equipe.

## 9. Permissões da equipe

O estabelecimento poderá controlar o que cada integrante da equipe pode visualizar ou alterar na MIMO.

O responsável pelo salão deve conceder somente os acessos necessários a cada pessoa.

Sempre que disponível, recomenda-se utilizar contas individuais em vez de compartilhar uma única senha administrativa.

- própria agenda
- agenda do salão
- clientes relacionados aos próprios atendimentos
- clientes do estabelecimento
- serviços
- preços
- horários
- comissões
- informações financeiras
- configurações administrativas

## 10. Identidade dos clientes

Na MIMO, o cliente possui uma identidade própria na plataforma.

Isso significa que o mesmo cliente poderá se relacionar com mais de um salão ou profissional sem que seja necessário criar várias contas diferentes.

A existência de uma identidade global não elimina os relacionamentos específicos existentes entre cliente e salão e entre cliente e profissional.

A MIMO poderá armazenar esses relacionamentos separadamente para manter histórico, permissões, origem e contexto.

## 11. Origem dos relacionamentos

A plataforma poderá registrar a origem do relacionamento entre cliente, salão e profissional.

A origem poderá incluir QR Code do salão, QR Code da profissional, link, código, convite, cadastro realizado pelo salão, relacionamento anterior ou recurso futuro de descoberta ou marketplace.

Essas informações poderão ser utilizadas para organizar acesso, manter histórico, identificar quem originou o relacionamento e aplicar funcionalidades ou regras comerciais previamente apresentadas.

## 12. Relação do salão com suas clientes

A MIMO reconhece a importância da relação construída entre estabelecimentos, profissionais e clientes.

A MIMO não pretende utilizar informações privadas obtidas da operação de um salão para desviar deliberadamente suas clientes para estabelecimentos concorrentes.

Isso não significa que o salão seja proprietário da identidade ou dos dados pessoais da cliente.

Dados pessoais permanecem sujeitos aos direitos da própria titular e à legislação aplicável.

A MIMO poderá registrar e preservar o histórico do relacionamento existente entre as partes.

## 13. Uso dos dados de clientes

O salão deverá utilizar informações acessadas por meio da MIMO apenas para finalidades legítimas relacionadas ao atendimento e relacionamento com seus clientes.

Salão e MIMO poderão possuir responsabilidades próprias no tratamento de dados pessoais, conforme a finalidade e o papel desempenhado em cada operação.

- vender bases de contatos
- realizar coleta abusiva de dados
- compartilhar informações sem fundamento adequado
- realizar spam
- utilizar dados para finalidade incompatível com o relacionamento existente
- acessar dados sem necessidade operacional
- prejudicar clientes, profissionais ou outros estabelecimentos

## 14. Agendamentos

O salão é responsável por manter sua disponibilidade correta.

A plataforma poderá registrar diferentes estados de um agendamento, incluindo solicitado, aguardando confirmação, confirmado, reagendado, cancelado, concluído, ausência e expirado.

Uma solicitação de horário não deverá ser considerada automaticamente confirmada quando o estabelecimento utilizar aprovação manual.

A MIMO poderá enviar avisos relacionados às alterações realizadas na agenda.

## 15. Regras de atendimento

O estabelecimento poderá configurar regras relacionadas a antecedência mínima, cancelamento, reagendamento, atrasos, faltas, confirmação, sinal e reserva.

Quando essas regras afetarem o cliente, deverão ser apresentadas de maneira clara antes ou durante o processo de agendamento, conforme aplicável.

O estabelecimento é responsável por garantir que suas políticas respeitem a legislação aplicável.

## 16. Comunicação com clientes

A MIMO poderá oferecer ferramentas para comunicação com clientes por notificações no aplicativo, push, e-mail, WhatsApp e outros canais integrados.

O salão é responsável pelo conteúdo de mensagens que criar ou enviar diretamente.

A MIMO poderá limitar o uso de recursos de comunicação em situações de spam, abuso, assédio, fraude ou uso incompatível com a finalidade da plataforma.

## 17. Planos da MIMO

Algumas funcionalidades poderão estar disponíveis gratuitamente e outras poderão depender de plano pago.

Antes da contratação, a MIMO deverá apresentar informações sobre preço, periodicidade, quantidade de agendas incluídas, eventuais cobranças adicionais, funcionalidades incluídas e condições aplicáveis.

O número de profissionais cadastrados poderá ser diferente do número de agendas profissionais ativas utilizadas para fins de cobrança, conforme o plano.

Usuários exclusivamente administrativos, de recepção ou gestão poderão possuir tratamento comercial diferente de profissionais que possuem agenda própria, de acordo com as condições vigentes.

## 18. Alterações de preço e plano

A MIMO poderá alterar seus planos e preços.

Alterações relevantes deverão ser comunicadas de forma adequada antes de produzirem efeitos sobre períodos futuros.

Valores já pagos não serão alterados retroativamente.

Condições promocionais poderão possuir prazo ou regras próprias.

## 19. Comissões e repasses

A MIMO poderá permitir que o salão registre regras de comissão, percentual, repasse, valor fixo ou configuração específica por serviço.

Essas funcionalidades possuem inicialmente caráter operacional e de cálculo.

O simples registro de uma comissão ou repasse dentro da plataforma não significa que a MIMO reconhece dívida entre as partes, garante o pagamento, executará automaticamente a transferência, valida a relação jurídica existente ou valida o tratamento fiscal adotado.

O salão e as profissionais são responsáveis pela conferência dos valores.

## 20. Pagamentos dentro da MIMO

A MIMO poderá futuramente oferecer recursos como pagamento por Pix, pagamento por cartão, sinal de reserva, cobrança, divisão de pagamento, repasse, conta de pagamento e outros serviços financeiros.

Essas operações poderão ser processadas por instituições financeiras ou instituições de pagamento terceiras.

Quando esses recursos forem disponibilizados, serão apresentadas previamente tarifas, condições, responsabilidades, regras de estorno, políticas de repasse e requisitos de cadastro e verificação.

A utilização desses recursos poderá exigir aceite de termos adicionais.

## 21. Prestação dos serviços de beleza

A MIMO fornece a infraestrutura tecnológica.

A MIMO não executa os procedimentos de beleza oferecidos pelos estabelecimentos.

O salão e seus profissionais são responsáveis por execução, técnica, qualidade, segurança, higiene, produtos utilizados, cumprimento de normas profissionais e atendimento ao cliente.

Reclamações diretamente relacionadas ao procedimento realizado deverão ser tratadas pelo estabelecimento responsável, sem prejuízo dos direitos previstos na legislação.

## 22. Conteúdo publicado

O salão é responsável por conteúdo inserido na plataforma, incluindo fotos, logotipos, marcas, nomes, textos, descrições, preços, mensagens e materiais promocionais.

O estabelecimento declara possuir direito ou autorização para utilizar os conteúdos publicados.

Não é permitido inserir material ilegal ou que viole direitos de terceiros.

## 23. Propriedade da plataforma

A tecnologia, software, design, identidade visual, código, estrutura, documentação e demais elementos próprios da MIMO pertencem à MIMO ou são utilizados mediante autorização.

A contratação ou utilização da plataforma não transfere propriedade intelectual ao estabelecimento.

O salão recebe apenas o direito de utilizar a plataforma dentro das condições previstas nestes Termos.

## 24. Segurança da conta

O estabelecimento deve proteger suas credenciais de acesso.

O responsável deverá utilizar senhas seguras, evitar compartilhamento de credenciais, remover acessos de ex-integrantes da equipe, revisar permissões e comunicar situações suspeitas.

A MIMO poderá bloquear temporariamente acessos quando detectar atividade que represente risco de segurança.

## 25. Disponibilidade da plataforma

A MIMO trabalha para manter seus serviços disponíveis, mas poderá ocorrer interrupção por manutenção, atualização, correção, falha de infraestrutura, falha de fornecedor, internet, serviços de mensagens, incidente de segurança ou evento fora do controle razoável da MIMO.

A existência de indisponibilidade temporária não representa automaticamente descumprimento contratual.

## 26. Integrações de terceiros

Algumas funcionalidades da MIMO poderão depender de serviços externos, como provedores de nuvem, e-mail, WhatsApp, notificações, pagamentos, mapas e autenticação.

Esses serviços poderão possuir regras próprias.

Falhas originadas exclusivamente em infraestrutura de terceiros poderão afetar temporariamente funcionalidades relacionadas.

## 27. Uso proibido

É proibido utilizar a MIMO para fraude, invasão, tentativa de comprometer a segurança, distribuição de malware, coleta não autorizada de dados, spam, assédio, discriminação, atividades ilegais, violação de direitos de terceiros ou manipulação indevida da plataforma.

A MIMO poderá tomar medidas para proteger usuários e sua infraestrutura.

## 28. Suspensão da conta

A MIMO poderá restringir ou suspender uma conta quando houver indícios relevantes de fraude, violação de segurança, utilização ilegal, abuso, uso indevido de dados ou violação destes Termos.

Quando razoavelmente possível e não houver risco à investigação ou segurança, o estabelecimento será informado.

## 29. Cancelamento do plano

O salão poderá solicitar cancelamento conforme as condições apresentadas no plano contratado.

O encerramento do plano não implica automaticamente exclusão imediata de todos os dados.

Determinados registros poderão ser mantidos quando necessários para obrigações legais, segurança, prevenção de fraude, exercício de direitos, auditoria, integridade do histórico ou demais hipóteses previstas em lei.

## 30. Encerramento de um salão

Caso um estabelecimento encerre suas atividades na MIMO, o acesso dos integrantes da equipe ao contexto desse salão poderá ser removido ou limitado.

Isso não significa necessariamente exclusão das contas pessoais das profissionais ou clientes.

Uma profissional poderá possuir identidade independente na MIMO e posteriormente utilizar a plataforma em outro contexto.

Os registros históricos serão tratados conforme a Política de Privacidade.

## 31. Proteção de dados

O tratamento de dados pessoais realizado pela MIMO é explicado em sua Política de Privacidade.

O salão deverá igualmente cumprir suas obrigações legais relacionadas aos dados pessoais que tratar.

## 32. Alterações destes Termos

Estes Termos poderão ser atualizados para refletir mudanças no produto, na legislação, nos planos, em funcionalidades ou na operação da MIMO.

Quando uma alteração for relevante, a MIMO poderá exigir novo aceite.

A versão e a data ficarão registradas.

## 33. Registros eletrônicos

A MIMO poderá registrar eletronicamente informações relacionadas ao aceite destes Termos, incluindo conta responsável, versão aceita, data e hora, endereço IP, dispositivo ou navegador, origem do aceite e identificadores técnicos.

Esses registros poderão ser utilizados para segurança, auditoria e comprovação do aceite.

## 34. Lei aplicável

Estes Termos são regidos pela legislação brasileira.

Eventuais conflitos serão tratados de acordo com as regras legais de competência aplicáveis ao caso.

## 35. Contato

Dúvidas sobre estes Termos ou sobre a utilização da MIMO poderão ser enviadas para:

MIMO Desenvolvimento de Software Não Customizável Ltda.

E-mail: contato@mimo.com.vc

CNPJ: 69.089.327/0001-88

Endereço: Rua Pais Leme, 215, conj. 1713, Pinheiros, São Paulo/SP, CEP 05424-150

Site: mimo.com.vc$legal$, 'publicado', now(), 'Primeira versão publicada pela plataforma.') on conflict (tipo, versao) do nothing;
insert into public.documentos_legais (tipo, versao, titulo, conteudo, status, publicado_em, resumo) values ('privacidade', '2026-09-24', $legal$Política de Privacidade$legal$, $legal$## 1. Sobre esta Política

Esta Política de Privacidade explica como a MIMO coleta, utiliza, armazena, compartilha, protege e elimina dados pessoais no funcionamento de seus sites, aplicativos e demais serviços.

Ela se aplica a clientes, profissionais, responsáveis por salões, integrantes de equipes e demais pessoas que utilizem ou interajam com a MIMO.

A MIMO busca tratar dados pessoais de forma compatível com a Lei Geral de Proteção de Dados Pessoais - LGPD (Lei nº 13.709/2018) e demais normas aplicáveis.

## 2. Quem é responsável pelos dados

Para os tratamentos realizados pela própria plataforma, o controlador será, conforme o caso, MIMO Desenvolvimento de Software Não Customizável Ltda., CNPJ 69.089.327/0001-88.

Canal geral: contato@mimo.com.vc.

Canal para privacidade e exercício de direitos: lgpd@mimo.com.vc.

Dependendo da operação, salões e profissionais também poderão atuar como controladores independentes dos dados utilizados em suas próprias relações com clientes e equipes. A função de cada participante dependerá da finalidade e da decisão sobre o tratamento realizado.

## 3. Quais dados podemos tratar

Os dados tratados variam conforme o perfil e as funcionalidades utilizadas.

### 3.1 Dados de cadastro e identificação

Nome, telefone/WhatsApp, e-mail, credenciais de acesso, foto de perfil, data de criação da conta e demais informações necessárias para identificação e autenticação.

### 3.2 Dados de salões e profissionais

Nome do estabelecimento, nome profissional, especialidade, endereço, contatos, CNPJ quando informado, serviços, preços, duração, horários, vínculo operacional, permissões, configurações de agenda e demais informações cadastradas na operação.

### 3.3 Dados de relacionamento e agendamento

Salão ou profissional relacionado à cliente, origem do relacionamento (por exemplo QR Code, link, código ou convite), serviços consultados ou agendados, datas, horários, status, cancelamentos, reagendamentos, faltas, histórico de atendimentos e observações necessárias à operação.

### 3.4 Comunicações

Mensagens enviadas por meio dos recursos da plataforma, registros de notificações, preferências de comunicação, contatos de suporte e informações necessárias para envio de lembretes por canais como push, e-mail ou WhatsApp.

### 3.5 Dados técnicos e de segurança

Endereço IP, data e hora de acesso, identificadores de sessão, navegador, sistema operacional, dispositivo, registros técnicos, eventos de autenticação, logs de erro, ações administrativas e outros dados necessários para segurança, prevenção de fraude e funcionamento do serviço.

### 3.6 Dados financeiros

Se recursos de pagamento forem ativados, a MIMO poderá tratar informações relacionadas a cobranças, sinal, transações, repasses, status de pagamento e identificadores fornecidos por prestadores de pagamento.

A MIMO deve evitar armazenar dados completos de cartão quando o processamento puder ser realizado diretamente por provedor especializado.

### 3.7 Conteúdo enviado pelo usuário

Fotos, logos, avaliações, textos, observações, mensagens e outros conteúdos que a pessoa optar por inserir nas funcionalidades da MIMO.

## 4. Como obtemos os dados

Podemos obter dados diretamente de você ao criar ou utilizar uma conta; de um salão quando ele cadastra ou convida integrante da equipe; de profissional ou salão quando registram informações necessárias a um atendimento; automaticamente durante o uso da plataforma; e de fornecedores necessários à execução de funcionalidades, como autenticação, mensageria, hospedagem e pagamentos.

Quando um salão cadastra previamente uma profissional, deverá possuir fundamento legítimo para compartilhar os dados necessários para convite e configuração.

## 5. Para que usamos os dados e quais bases legais podem ser utilizadas

A base legal depende da finalidade concreta. A MIMO não utiliza consentimento como fundamento genérico para todo tratamento.

### Principais finalidades

- **Prestar a plataforma.** Criar conta, autenticar, manter agenda, serviços, equipe e relacionamentos. *Base legal:* Execução de contrato ou procedimentos preliminares.

- **Comunicações operacionais.** Confirmações, lembretes, alterações de agenda e segurança. *Base legal:* Execução de contrato; legítimo interesse, conforme o caso.

- **Segurança e prevenção de fraude.** Logs, autenticação, controle de acesso, investigação de abuso. *Base legal:* Legítimo interesse; cumprimento de obrigação legal; exercício regular de direitos.

- **Suporte.** Responder dúvidas, corrigir problemas e manter histórico de atendimento. *Base legal:* Execução de contrato; legítimo interesse.

- **Cumprimento legal e defesa.** Atender obrigações legais, ordens válidas e preservar evidências. *Base legal:* Cumprimento de obrigação legal/regulatória; exercício regular de direitos.

- **Melhoria do produto.** Métricas de uso, estabilidade, desempenho e evolução das funcionalidades. *Base legal:* Legítimo interesse, com minimização e avaliação de impacto quando necessária.

- **Marketing não essencial.** Novidades, campanhas e comunicações promocionais. *Base legal:* Consentimento ou outra base legal adequada, conforme a situação e o canal.

- **Pagamentos, quando ativos.** Cobrança, sinal, conciliação, repasse e prevenção de fraude financeira. *Base legal:* Execução de contrato; obrigação legal; exercício regular de direitos.

## 6. Relações entre cliente, salão e profissional

A identidade da cliente é tratada de forma global dentro da MIMO, enquanto os relacionamentos com salões e profissionais podem ser registrados separadamente.

Isso permite, por exemplo, que a mesma cliente se relacione com diferentes estabelecimentos sem que seja necessário criar contas duplicadas.

A MIMO poderá preservar informações de origem do relacionamento para manter histórico, regras de acesso e funcionalidades comerciais transparentes.

## 7. Com quem podemos compartilhar dados

A MIMO poderá compartilhar dados pessoais somente quando necessário e de forma compatível com a finalidade do tratamento.

### 7.1 Salões e profissionais

Dados necessários ao agendamento e atendimento poderão ser disponibilizados ao salão ou profissional com quem a pessoa possui relacionamento ou agendamento, respeitando permissões e contexto.

### 7.2 Prestadores de tecnologia

Podemos utilizar fornecedores de infraestrutura em nuvem, banco de dados, hospedagem, autenticação, e-mail, notificações, WhatsApp, suporte, monitoramento técnico e segurança.

Esses fornecedores devem receber somente os dados necessários para a prestação dos serviços contratados e poderão atuar como operadores ou suboperadores conforme o caso.

### 7.3 Prestadores de pagamento

Quando recursos financeiros forem ativados, dados necessários poderão ser compartilhados com instituições financeiras, instituições de pagamento, adquirentes, bancos ou provedores antifraude.

### 7.4 Autoridades e obrigações legais

Dados poderão ser fornecidos a autoridades quando houver obrigação legal, regulatória, ordem judicial ou requisição válida nos termos da legislação.

### 7.5 Operações societárias

Em eventual reorganização societária, fusão, aquisição ou transferência de ativos, dados poderão integrar a operação, observados os deveres de privacidade e a legislação.

## 8. Transferências internacionais

Alguns fornecedores de tecnologia poderão utilizar infraestrutura localizada ou operada fora do Brasil. Nesses casos, a MIMO deverá adotar mecanismos e salvaguardas compatíveis com a LGPD e a regulamentação aplicável.

A localização efetiva dos fornecedores e os mecanismos utilizados devem ser revistos periodicamente pela MIMO.

## 9. Cookies, armazenamento local e tecnologias semelhantes

Os sites e aplicativos da MIMO poderão utilizar cookies, armazenamento local e tecnologias semelhantes para autenticação, segurança, preferências, funcionamento e análise de desempenho.

Cookies estritamente necessários podem ser utilizados para viabilizar funções essenciais.

Quando forem utilizados cookies não necessários, como analytics ou publicidade, a MIMO deverá fornecer informação adequada e, quando exigido, opções de escolha e gerenciamento.

Uma Política de Cookies específica poderá complementar esta Política.

## 10. Por quanto tempo guardamos os dados

A MIMO manterá dados pessoais pelo tempo necessário para cumprir as finalidades informadas, prestar o serviço, cumprir obrigações legais, prevenir fraude, resolver disputas e exercer direitos.

Registros de acesso à aplicação sujeitos ao Marco Civil da Internet serão mantidos pelo prazo legal aplicável.

Após o encerramento da conta, determinados dados poderão ser eliminados, anonimizados ou mantidos quando existir base legal para retenção.

Backups poderão conservar cópias temporárias até o ciclo normal de sobrescrita e eliminação.

## 11. Segurança

A MIMO adota medidas técnicas e administrativas compatíveis com o porte, natureza do serviço e riscos envolvidos, buscando reduzir acessos não autorizados, perda, alteração, destruição ou divulgação indevida de dados.

Entre as medidas que podem ser utilizadas estão autenticação, controles de permissão, segregação de ambientes, criptografia em trânsito, registros de auditoria, backups, atualização de sistemas e limitação de acesso interno.

Nenhum sistema é completamente imune a incidentes. Caso ocorra incidente relevante envolvendo dados pessoais, a MIMO adotará as providências cabíveis e realizará as comunicações exigidas pela legislação e regulamentação aplicáveis.

## 12. Seus direitos

Nos termos da LGPD, o titular poderá solicitar, conforme aplicável: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade; portabilidade quando regulamentada e aplicável; informação sobre compartilhamentos; informação sobre a possibilidade de não fornecer consentimento e suas consequências; revogação do consentimento; e revisão de determinadas decisões automatizadas, quando aplicável.

O atendimento poderá exigir confirmação de identidade para proteger o próprio titular.

## 13. Consentimento e preferências

Quando determinado tratamento depender de consentimento, a MIMO deverá informar a finalidade de forma específica e permitir que o consentimento seja revogado nos termos da legislação.

O aceite dos Termos de Uso ou a ciência desta Política de Privacidade não deve ser utilizado como consentimento genérico para finalidades que exigem autorização específica.

Preferências de marketing e comunicações não essenciais deverão ser administradas separadamente das comunicações necessárias ao funcionamento da conta e da agenda.

## 14. Menores de idade

A MIMO não foi concebida para que crianças criem e administrem contas de forma independente.

Quando houver atendimento de menor de idade, o tratamento deverá observar as regras aplicáveis e, quando necessário, ocorrer com participação do responsável legal e com coleta limitada ao necessário.

## 15. Decisões automatizadas

Na versão atual, a MIMO não pretende utilizar decisões exclusivamente automatizadas para produzir efeitos jurídicos ou significativamente relevantes sobre usuários sem mecanismos adequados de transparência e revisão.

Se essa prática for adotada no futuro, esta Política deverá ser atualizada.

## 16. Exclusão de conta

O usuário poderá solicitar o encerramento da conta pelos meios disponibilizados pela MIMO.

A exclusão da conta não significa necessariamente eliminação imediata de todos os registros, pois alguns dados poderão ser mantidos quando houver obrigação legal, necessidade de exercício de direitos, prevenção de fraude, segurança ou outra base legal aplicável.

Quando possível e adequado, registros históricos poderão ser anonimizados.

## 17. Solicitações de privacidade

Para exercer direitos ou tirar dúvidas sobre dados pessoais, utilize: lgpd@mimo.com.vc.

A MIMO poderá solicitar informações adicionais para confirmar a identidade e evitar que dados sejam entregues ou alterados por pessoa não autorizada.

## 18. Reclamações à ANPD

Sem prejuízo de outros meios administrativos ou judiciais cabíveis, o titular poderá apresentar petição relacionada à proteção de dados à Autoridade Nacional de Proteção de Dados - ANPD, observados os procedimentos aplicáveis.

## 19. Alterações desta Política

Esta Política poderá ser atualizada para refletir mudanças no produto, na operação ou na legislação.

Quando a alteração for relevante, a MIMO adotará meios razoáveis para informar os usuários. A data da versão vigente ficará indicada no início do documento.

## 20. Contato

Responsável pelo tratamento: MIMO Desenvolvimento de Software Não Customizável Ltda.

CNPJ: 69.089.327/0001-88

E-mail geral: contato@mimo.com.vc

Canal de privacidade (LGPD): lgpd@mimo.com.vc

Endereço: Rua Pais Leme, 215, conj. 1713, Pinheiros, São Paulo/SP, CEP 05424-150$legal$, 'publicado', now(), 'Primeira versão publicada pela plataforma.') on conflict (tipo, versao) do nothing;

insert into public.migracoes_aplicadas (arquivo) values ('120_documentos_legais.sql') on conflict (arquivo) do nothing;
