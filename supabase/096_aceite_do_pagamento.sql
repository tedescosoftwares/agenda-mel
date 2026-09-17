-- 096 · O aceite da cliente fica registrado no pagamento
--
-- Antes de gerar o PIX, a cliente vê o resumo (serviços, sinal, resto no
-- atendimento) e as condições: a taxa do PIX não volta, o prazo da
-- política, o crédito de 30 dias. O "li e aceito" fica gravado aqui,
-- com a versão do texto que ela leu.
alter table public.pagamentos add column if not exists termos_aceitos_em timestamptz;
alter table public.pagamentos add column if not exists termos_versao text;
