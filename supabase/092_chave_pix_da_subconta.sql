-- 092 · A chave Pix da subconta
--
-- O Asaas só gera QR para conta com chave Pix cadastrada. A Edge
-- Function cria uma chave aleatória (EVP) na subconta assim que ela
-- nasce, e a tela mostra se está pronta.

alter table public.contas_de_recebimento add column if not exists pix_pronto boolean not null default false;
