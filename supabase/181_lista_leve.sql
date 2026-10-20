-- 181 (3.36): a lista do guia mais leve para a Plataforma, e um índice para ler por fatias com chave.
--
-- Com 20 mil salões (Santos sozinha passa de 2 mil), a Plataforma lia a lista por OFFSET (cada página reordenava
-- tudo de novo) e com as colunas pesadas (horarios, servicos, atributos, origem). Agora ela lê por fatias com
-- chave (where id > último order by id limit 1000: cada fatia custa o mesmo) e pede só o que a lista mostra:
-- em vez de horarios e servicos, as flags tem_horario e servicos_n; atributos e origem só quando abre o salão.
-- A view ganha as duas colunas no fim (create or replace view só acrescenta); as de antes continuam para quem lê.
create or replace view public.guia_lista with (security_invoker = true) as
  select l.id, l.cidade, l.cidade_slug, l.uf, l.slug, l.categoria, l.nome, l.bairro, l.endereco, l.cep, l.telefone, l.whatsapp, l.instagram, l.site,
         l.horarios, l.servicos, l.atributos, l.place_id, l.cnpj, l.validado_receita, l.selecao, l.nota, l.avaliacoes, l.fontes, l.origem, l.fotos,
         l.status, l.motivo, l.salon_id, l.gerado_em, l.publicado_em, l.criado_em, l.atualizado_em,
         (l.conteudo is not null) as tem_conteudo,
         (l.rascunho is not null) as tem_rascunho,
         coalesce(l.rascunho ->> 'resumo', l.conteudo ->> 'resumo') as resumo,
         l.conteudo -> '_meta' as meta,
         l.rascunho -> '_meta' as meta_rascunho,
         (l.horarios is not null and jsonb_typeof(l.horarios) = 'array' and jsonb_array_length(l.horarios) > 0) as tem_horario,
         coalesce(array_length(l.servicos, 1), 0) as servicos_n
    from public.guia_lugares l;
comment on view public.guia_lista is 'Guia (181): guia_lugares sem conteudo e rascunho, com tem_conteudo, tem_rascunho, resumo, as _meta e, desde a 181, tem_horario e servicos_n (a Plataforma lista por aqui, por fatias com chave, e lê a linha inteira ao abrir o salão). Ver 171.';
revoke all on public.guia_lista from public, anon;
grant select on public.guia_lista to authenticated;

-- a fatia com chave dentro de uma cidade: where cidade_slug = ? and id > ? order by id limit 1000
create index if not exists guia_lugares_cidade_id on public.guia_lugares (cidade_slug, id);

do $$
begin
  raise notice '181: guia_lista com tem_horario e servicos_n; índice (cidade_slug, id) para a leitura por fatias';
end $$;
