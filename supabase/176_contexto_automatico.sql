-- 176 (3.30): o "Sobre a cidade" nasce sozinho.
--
-- Ao gerar qualquer página de uma cidade cujo contexto está vazio ou ainda é a semente, a função
-- guia-gerar escreve o contexto antes (no Gemini, pesquisando no Google) e grava. Para saber o que
-- pode tocar, a linha da cidade ganha a origem do texto ("semente", "ia" ou "editado") e as fontes
-- que a IA usou. O que a equipe editou à mão ("editado") nunca é tocado.
alter table public.guia_paginas add column if not exists contexto_origem text;
alter table public.guia_paginas add column if not exists contexto_fontes jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'guia_paginas_contexto_origem_ok') then
    alter table public.guia_paginas add constraint guia_paginas_contexto_origem_ok check (contexto_origem is null or contexto_origem in ('semente', 'ia', 'editado'));
  end if;
end $$;
comment on column public.guia_paginas.contexto_origem is 'Guia (176): de onde veio o "Sobre a cidade": semente (170/175), ia (a função escreveu) ou editado (a equipe mexeu; a IA não toca).';
comment on column public.guia_paginas.contexto_fontes is 'Guia (176): o que a IA pediu para conferir e as fontes da pesquisa, quando ela escreveu o "Sobre a cidade".';
-- o que já existe é semente (quem editou à mão regrava na Plataforma e vira "editado")
update public.guia_paginas set contexto_origem = 'semente' where categoria = '' and contexto is not null and btrim(contexto) <> '' and contexto_origem is null;
do $$
begin
  raise notice '176: contexto_origem e contexto_fontes em guia_paginas; o "Sobre a cidade" passa a ser escrito pela IA quando é semente ou vazio';
end $$;
