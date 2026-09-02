-- =============================================================
-- Agenda Mel — limpeza de teste
--
-- NÃO é migração: é um utilitário para rodar à mão no SQL Editor
-- enquanto o sistema está em teste. Cada bloco é independente —
-- rode só o que você quer.
--
-- ATENÇÃO ao bloco 2: apagar o histórico de mensagens ENVIADAS quebra
-- a trava de contexto. É a última mensagem enviada que autoriza um "1"
-- a confirmar um horário; sem ela, toda resposta vira "fora de
-- contexto". Em teste isso costuma ser exatamente o que confunde
-- depois. Por isso o padrão aqui é limpar só o que está PARADO.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. O que está preso na fila (o caso comum)
-- ---------------------------------------------------------------
-- 'cancelado' em vez de delete: a linha continua contando no relatório
-- e você enxerga que ela existiu e não saiu.
update public.message_outbox
   set status = 'cancelado'
 where status = 'na_fila';

-- Quer que elas CHEGUEM em vez de sumir? Não rode o de cima:
-- rode ./disparar.sh na EC2 e elas saem em segundos.

-- ---------------------------------------------------------------
-- 2. Zerar a caixa de saída inteira (cuidado: some o contexto)
-- ---------------------------------------------------------------
-- delete from public.message_outbox;

-- ---------------------------------------------------------------
-- 3. Conversas do bot em andamento
-- ---------------------------------------------------------------
-- Uma conversa parada no meio faz a próxima mensagem cair no menu em
-- vez de começar do zero. Limpar aqui recomeça a conversa.
delete from public.conversas;

-- ---------------------------------------------------------------
-- 4. Mensagens recebidas e leituras da IA
-- ---------------------------------------------------------------
-- Some do "O que chegou" na tela do admin. O provider_id guardado aqui
-- é o que impede o mesmo evento de agir duas vezes — apagando, um
-- reenvio do WhatsApp voltaria a valer. Em teste, tudo bem.
delete from public.whatsapp_inbox;
delete from public.ia_chamadas;

-- ---------------------------------------------------------------
-- 5. Agendamentos criados no teste
-- ---------------------------------------------------------------
-- Só os de hoje em diante e só os que ainda não aconteceram, para não
-- levar junto os dois meses de histórico que alimentam as telas de
-- números e de "quem sumiu".
delete from public.appointments
 where date >= (public.agora_local())::date
   and status in ('pendente', 'confirmado');

-- ---------------------------------------------------------------
-- 6. Avisos dentro do app (o sininho)
-- ---------------------------------------------------------------
delete from public.notifications
 where kind in ('novo_agendamento', 'cancelou_comigo', 'pedido_pelo_whatsapp');

-- ---------------------------------------------------------------
-- Conferir como ficou
-- ---------------------------------------------------------------
select 'fila parada'      as o_que, count(*) as quantos from public.message_outbox where status = 'na_fila'
union all select 'fila enviada',   count(*) from public.message_outbox where status = 'enviado'
union all select 'conversas',      count(*) from public.conversas
union all select 'recebidas',      count(*) from public.whatsapp_inbox
union all select 'agendamentos futuros', count(*) from public.appointments
          where date >= (public.agora_local())::date and status in ('pendente','confirmado');
