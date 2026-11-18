-- 249 · O Instagram da MIMO no guia (3.99.1)
--
-- O site ganhou o convite para seguir a MIMO no Instagram antes de falar com um salão do guia (WhatsApp ou Ligar) e
-- os cartões fixos (página do salão, lista da cidade, "Pedido anotado!", fim do artigo e o @ no rodapé). O @ e os
-- textos do convite moram na config_publica, que já existe ('instagram' e 'guia_instagram', este em JSON; a
-- Plataforma › Guia › Instagram grava pela definir_config_publica). Aqui só entram os três toques novos, para o
-- Desempenho mostrar sozinho (156: tipo novo = linha nova; sem a linha, o site manda e o banco ignora):
--   insta_convite  o convite apareceu
--   insta_seguir   tocou em Seguir (no convite, num cartão ou no rodapé; a área diz onde)
--   insta_direto   tocou em "Agora não" e foi direto ao salão
-- Ficam no grupo 'outro': não somam como contato com o salão (o toque no WhatsApp ou no Ligar já contou).

insert into public.site_eventos_tipos (tipo, rotulo, grupo, ordem) values
  ('insta_convite', 'Convite do Instagram', 'outro', 96),
  ('insta_seguir', 'Seguir a MIMO no Instagram', 'outro', 97),
  ('insta_direto', 'Foi direto ao salão (sem seguir)', 'outro', 98)
on conflict (tipo) do update set rotulo = excluded.rotulo, grupo = excluded.grupo, ordem = excluded.ordem, ativo = true;

do $$ begin
  raise notice '249: os toques do Instagram da MIMO no guia (insta_convite, insta_seguir, insta_direto).';
end $$;
