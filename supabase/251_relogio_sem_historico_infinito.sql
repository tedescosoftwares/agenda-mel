-- 251 · O histórico do relógio sem crescer para sempre
--
-- O relógio do banco (pg_cron, desde a 052) guarda uma linha por execução em cron.job_run_details: a fila, os
-- e-mails e o push rodam a cada minuto, a Mel e as rotinas a cada 5, uns 6 mil registros por dia, e nada apagava.
-- Chegou a 58 MB dos 500 do plano gratuito do Supabase (o guia de salões, com 20 mil, ocupa 158). As telas que mostram
-- o relógio (052, 054, 055, 057) só leem a última execução de cada job, então o histórico antigo não serve a ninguém.
--
--   1. Esvazia o histórico agora: o truncate devolve o espaço ao disco na hora. Sem permissão para isso, apaga o que
--      tem mais de 3 dias (o espaço passa a ser reaproveitado pelas execuções novas, mas o arquivo não encolhe).
--   2. Agenda a limpeza de todo dia (mimo-limpa-relogio, 03:41 de Brasília): fica só o histórico dos últimos 3 dias.
--
-- Depois de rodar, as telas do relógio mostram "ainda não rodou" até a próxima execução de cada job (um minuto para
-- os da fila; o mimo-gsc, só no dia seguinte). Pode rodar de novo: nada é duplicado.

do $$
begin
  begin
    execute 'truncate table cron.job_run_details';
    raise notice '251: histórico do relógio esvaziado (espaço devolvido ao disco)';
  exception when insufficient_privilege then
    delete from cron.job_run_details where end_time < now() - interval '3 days';
    raise notice '251: sem permissão de truncate; apaguei o histórico com mais de 3 dias';
  end;
end $$;

-- nome repetido substitui no pg_cron novo; o unschedule antes vale para o antigo e para o banco de teste
select cron.unschedule(jobid) from cron.job where jobname = 'mimo-limpa-relogio';
select cron.schedule('mimo-limpa-relogio', '41 6 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
