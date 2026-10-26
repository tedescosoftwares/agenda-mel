-- 214: o cartão do guia leva os pontos (3.69)
-- O app ordena "perto de você" pela hierarquia do guia (MIMO, Seleção, foto + nota do Google = os pontos da 185).
-- O gerador já põe os pontos no cartão do JSON; aqui a função que responde quando o JSON não existe faz o mesmo.
create or replace function public.guia_cartao(l public.guia_lugares)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('slug', l.slug, 'nome', l.nome, 'bairro', l.bairro, 'categoria', l.categoria,
    'resumo', l.conteudo ->> 'resumo', 'servicos', to_jsonb((coalesce(l.servicos, '{}'))[1:4]),
    'selecao', l.selecao, 'na_mimo', l.salon_id is not null,
    'latitude', round(l.latitude::numeric, 5), 'longitude', round(l.longitude::numeric, 5),
    'foto', (public.guia_fotos(l))[1],
    'pontos', l.pontos)
$$;
revoke execute on function public.guia_cartao(public.guia_lugares) from public, anon;

insert into public.migracoes_aplicadas (arquivo) values ('214_cartao_com_pontos.sql') on conflict (arquivo) do nothing;
do $$ begin raise notice '214: guia_cartao com pontos'; end $$;
