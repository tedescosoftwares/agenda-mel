-- 184 (3.38.1): o carimbo de atualização (guia_tocar) com caminho rápido em guia_lugares.
-- O lote da Plataforma (guia_lote, 167/169) atualiza milhares de linhas num comando e, a cada linha, o gatilho
-- serializava a linha inteira duas vezes (to_jsonb de conteudo, rascunho, horarios, fotos...) só para saber se algo
-- visível mudou. Quando status, conteudo ou fotos mudaram, a resposta já é sim: a data anda sem comparar o resto.
-- As outras tabelas com o mesmo gatilho (guia_paginas, guia_categorias, guia_regioes, guia_cidades_regiao) seguem
-- como antes. A Plataforma, do seu lado, passa a mandar o lote em partes de 200 (3.38.1): com 4 mil salões num
-- comando só, o banco passava do tempo limite ("canceling statement due to statement timeout").
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em', 'contexto'];
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'guia_lugares' then
      -- o caminho rápido (184): o que aprovar, tirar do ar, descartar e as fotos mudam
      if new.status is distinct from old.status or new.conteudo is distinct from old.conteudo or new.fotos is distinct from old.fotos then
        new.atualizado_em := now();
        return new;
      end if;
    end if;
    if (to_jsonb(new) - internos) = (to_jsonb(old) - internos) then
      return new; -- nada visível mudou: fica a data que estava (ou a que o update mandou de propósito)
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
comment on function public.guia_tocar() is 'Guia (164, 170, 184): atualizado_em só anda quando muda algo que a página mostra; em guia_lugares, status, conteudo ou fotos mudados já bastam, sem serializar a linha.';

do $$
begin
  raise notice '184: guia_tocar com caminho rápido em guia_lugares (o lote em partes é na Plataforma)';
end $$;
