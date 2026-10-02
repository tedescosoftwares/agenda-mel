-- 141: a Mel na configuração inicial (2.89)
--
-- Sete momentos novos, categoria "configuracao": o salão ainda montando
-- (sem serviços, sem equipe, equipe sem acesso, sem agendamento de teste,
-- avisos desligados), o tour guiado pendente e a comemoração quando tudo
-- fica pronto. Os fatos vêm de primeiros_passos(), que o motor já lê.
-- O texto, como sempre, é da biblioteca (Plataforma → Mel).

alter table public.mel_momentos drop constraint if exists mel_momentos_categoria_check;
alter table public.mel_momentos add constraint mel_momentos_categoria_check
  check (categoria in ('agenda', 'oportunidade', 'marco', 'clima', 'calendario', 'operacional', 'geral', 'configuracao'));

insert into public.mel_momentos (chave, categoria, rotulo, descricao, superficies, placeholders, exemplo, ordem) values
  ('configurar_servicos', 'configuracao', 'Configurar serviços', 'O salão ainda não tem nenhum serviço cadastrado. Enquanto isso a agenda não abre.', '{mel_bubble}', '{nome}', '{"nome":"Carla"}', 300),
  ('configurar_equipe', 'configuracao', 'Configurar equipe', 'Salão com serviços, mas sem nenhuma profissional. Só para tipo salão.', '{mel_bubble}', '{nome,n_servicos}', '{"nome":"Carla","n_servicos":"6"}', 310),
  ('equipe_sem_acesso', 'configuracao', 'Equipe sem acesso', 'Profissional cadastrada que ainda não ativou o acesso dela.', '{mel_bubble}', '{n,profissional}', '{"n":"1","profissional":"Ana"}', 320),
  ('agendamento_teste', 'configuracao', 'Agendamento de teste', 'Serviços e equipe prontos, mas nenhum agendamento ainda. Hora de fazer um de teste.', '{mel_bubble}', '{nome}', '{"nome":"Carla"}', 330),
  ('ligar_avisos', 'configuracao', 'Ligar avisos', 'Já tem agendamento e os avisos no celular estão desligados.', '{mel_bubble}', '{nome}', '{"nome":"Carla"}', 340),
  ('tour_pendente', 'configuracao', 'Tour pendente', 'A pessoa ainda não fez o tour guiado do painel.', '{mel_bubble}', '{nome}', '{"nome":"Carla"}', 350),
  ('configuracao_concluida', 'configuracao', 'Configuração concluída', 'Serviços, equipe e primeiro agendamento prontos: o salão está montado. Aparece uma vez.', '{mel_bubble,weather_card}', '{nome,n_servicos,n_equipe}', '{"nome":"Carla","n_servicos":"6","n_equipe":"3"}', 360)
on conflict (chave) do update set
  categoria = excluded.categoria, rotulo = excluded.rotulo, descricao = excluded.descricao,
  superficies = excluded.superficies, placeholders = excluded.placeholders, exemplo = excluded.exemplo, ordem = excluded.ordem;
