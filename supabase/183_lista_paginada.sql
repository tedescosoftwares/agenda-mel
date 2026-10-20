-- 183 (3.38): "Todas as cidades" por páginas no servidor. A Plataforma passa a pedir a lista de todas as cidades por
-- páginas de 500 (order ... range), com os filtros da aba (fase, cidade, bairro, categoria, Receita, Seleção, triagem,
-- busca) no próprio banco, em vez de trazer tudo. A view ganha pontos (a ordem do site) e fotos_n (ordenar pelas fotos)
-- para o banco ordenar, e busca (nome e bairro em minúsculas e sem acento: "salao" acha "Salão"); o índice (cidade_slug,
-- nome, id) serve à ordem por cidade e nome sem reordenar tudo.
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
         coalesce(array_length(l.servicos, 1), 0) as servicos_n,
         public.guia_pontos(l) as pontos,
         coalesce(array_length(l.fotos, 1), 0) as fotos_n,
         lower(translate(l.nome || ' ' || coalesce(l.bairro, ''), 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')) as busca
    from public.guia_lugares l;
comment on view public.guia_lista is 'Guia (183): guia_lugares sem conteudo e rascunho, com tem_conteudo, tem_rascunho, resumo, as _meta, tem_horario, servicos_n (181), pontos, fotos_n e busca (183). A Plataforma lista por aqui: por fatias com chave numa cidade, por páginas de 500 em todas. Ver 171.';
revoke all on public.guia_lista from public, anon;
grant select on public.guia_lista to authenticated;
-- a view corre como quem lê (security_invoker): quem usa a Plataforma precisa poder chamar guia_pontos (166 deixou só o dono)
grant execute on function public.guia_pontos(public.guia_lugares) to authenticated;

-- a ordem padrão de "todas as cidades" (cidade, nome) e as páginas (range) sem reordenar a tabela inteira
create index if not exists guia_lugares_cidade_nome_id on public.guia_lugares (cidade_slug, nome, id);

do $$
begin
  raise notice '183: guia_lista com pontos, fotos_n e busca; índice (cidade_slug, nome, id) para a lista por páginas';
end $$;
