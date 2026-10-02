-- 142: a Mel como guia de cada tela da configuração (2.90)
--
-- Na tela do passo (serviços, equipe, horários, agenda, ajustes) a Mel
-- deixa de comentar e passa a instruir: um texto por tela, fixo, dizendo
-- o que fazer ali. Cada tela é um momento "guia_*" que o motor só aceita
-- quando o app diz em que tela a pessoa está e aquele passo ainda falta.
-- A frase padrão já vem semeada (editável na Plataforma → Mel); não
-- precisa de variações.

insert into public.mel_momentos (chave, categoria, rotulo, descricao, superficies, placeholders, exemplo, ordem) values
  ('guia_servicos', 'configuracao', 'Guia: tela de serviços', 'A pessoa está na tela de serviços e ainda não cadastrou nenhum. A Mel explica o que fazer ali.', '{mel_bubble}', '{nome,faltam,faltam_lista}', '{"nome":"Carla","faltam":"3","faltam_lista":"serviços, profissionais e horários"}', 370),
  ('guia_equipe', 'configuracao', 'Guia: tela da equipe', 'A pessoa está na tela de profissionais e a equipe ainda não está montada (ou alguém está sem acesso).', '{mel_bubble}', '{nome,n_pendentes,faltam,faltam_lista}', '{"nome":"Carla","n_pendentes":"1","faltam":"2","faltam_lista":"profissionais e horários"}', 371),
  ('guia_horarios', 'configuracao', 'Guia: tela de horários', 'A pessoa está na tela de horários e o salão ainda não tem horário de funcionamento.', '{mel_bubble}', '{nome,faltam,faltam_lista}', '{"nome":"Carla","faltam":"1","faltam_lista":"horários"}', 372),
  ('guia_agenda', 'configuracao', 'Guia: tela da agenda', 'A pessoa está na agenda, com serviços e equipe prontos, e ainda não fez o primeiro agendamento.', '{mel_bubble}', '{nome,faltam,faltam_lista}', '{"nome":"Carla","faltam":"1","faltam_lista":"agendamento de teste"}', 373),
  ('guia_ajustes', 'configuracao', 'Guia: tela de ajustes', 'A pessoa está nos ajustes e os avisos no celular estão desligados.', '{mel_bubble}', '{nome,faltam,faltam_lista}', '{"nome":"Carla","faltam":"1","faltam_lista":"avisos no celular"}', 374),
  ('guia_configurar', 'configuracao', 'Guia: tela de configuração', 'A pessoa está na tela "Continuar configuração", com passos pendentes.', '{mel_bubble}', '{nome,faltam,faltam_lista}', '{"nome":"Carla","faltam":"2","faltam_lista":"serviços e profissionais"}', 375)
on conflict (chave) do update set
  categoria = excluded.categoria, rotulo = excluded.rotulo, descricao = excluded.descricao,
  superficies = excluded.superficies, placeholders = excluded.placeholders, exemplo = excluded.exemplo, ordem = excluded.ordem;

-- a frase padrão de cada guia (uma por tela; a Plataforma pode trocar)
insert into public.mel_frases (chave, superficie, texto, tom, peso)
select v.chave, 'mel_bubble', v.texto, 'atenta', 1
from (values
  ('guia_servicos', 'Você está em Serviços: cadastra o que faz, com nome, duração e preço. Ainda falta: {faltam_lista}.'),
  ('guia_equipe', 'Você está na Equipe: cadastra quem atende e manda o acesso pra cada uma. Ainda falta: {faltam_lista}.'),
  ('guia_horarios', 'Você está em Horários: marca os dias e horas em que o salão abre. Ainda falta: {faltam_lista}.'),
  ('guia_agenda', 'Você está na Agenda: toca no + e marca um horário de teste pra ver tudo funcionando.'),
  ('guia_ajustes', 'Você está nos Ajustes: liga os avisos no celular pra não perder pedido nem cancelamento.'),
  ('guia_configurar', 'Faltam {faltam}: {faltam_lista}. Um de cada vez, eu vou junto.')
) v(chave, texto)
where not exists (select 1 from public.mel_frases f where f.chave = v.chave);

-- os momentos de configuração da 141 também dizem o que falta
update public.mel_momentos set placeholders = array_cat(placeholders, '{faltam,faltam_lista}'), exemplo = exemplo || '{"faltam":"2","faltam_lista":"serviços e profissionais"}'::jsonb
where chave in ('configurar_servicos', 'configurar_equipe', 'equipe_sem_acesso', 'agendamento_teste', 'ligar_avisos') and not ('faltam' = any (placeholders));
