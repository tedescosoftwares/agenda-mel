-- =============================================================
-- Agenda Mel / MIMO — 048: a página pública passa a usar a conta boa
--
-- Existiam DUAS respostas para "que horários estão livres":
--
--   • horarios_livres()  no banco — usada pelo bot. Considera o
--     expediente, o que já está marcado, os BLOQUEIOS da profissional
--     (almoço, médico, folga) e o intervalo entre atendimentos.
--
--   • gerarSlots()  no navegador — usada pela página pública. Considera
--     o expediente e o que já está marcado. Só isso.
--
-- Ou seja: o site oferecia horário que o bot recusaria. Uma cliente
-- marcava em cima do almoço da profissional pelo link, e pelo WhatsApp
-- não conseguia. Duas verdades sobre o mesmo minuto.
--
-- Esta migração não muda regra nenhuma: ela só ABRE para o público a
-- função que já existia e já estava certa, para a página parar de fazer
-- a conta por conta própria. horarios_livres() já era pública desde a
-- 035; falta a irmã dela, que responde "em que dias ainda tem vaga".
--
-- Nada de novo é exposto: quem abre /p/ana-paula já vê os horários
-- livres de cada dia, um a um. Saber de antemão em quais dias procurar
-- é a mesma informação, com menos toques.
-- =============================================================

grant execute on function public.dias_com_vaga(uuid, integer, integer)
  to anon, authenticated;
