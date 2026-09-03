@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title MIMO :: VPS (Evolution + site)

REM ============================================================================
REM  Conectar_MIMO_VPS.bat - acesso rapido a EC2 do MIMO a partir do Windows
REM
REM  MORA NO REPOSITORIO DE PROPOSITO: sobrevive a formatacao e quem entrar no
REM  time ja acha pronto.
REM
REM  COMO USAR
REM    1. deixe a chave .pem em  %USERPROFILE%\.ssh\mimo.pem
REM       (ou troque a linha CHAVE abaixo pelo caminho onde ela esta)
REM    2. de dois cliques neste arquivo
REM
REM  A sessao NAO cai por inatividade: o ssh manda um sinal de vida a cada
REM  60 s, o dia inteiro (ServerAlive*). Fecha quando VOCE fechar.
REM
REM  Se o IP mudar (parar/iniciar a EC2 sem IP elastico), troque HOST.
REM ============================================================================

set "HOST=18.231.186.85"
set "USUARIO=ubuntu"
set "CHAVE=%USERPROFILE%\.ssh\mimo.pem"
set "PROJETO=/home/ubuntu/agenda-mel"
set "BRANCH=claude/aesthetic-services-booking-app-b327z0"
set "SITE=https://mimoapp.duckdns.org"

REM  a chave pode estar em outro lugar: procura nos suspeitos de sempre
if not exist "%CHAVE%" (
  for %%f in ("%USERPROFILE%\.ssh\agnd-work.pem" "%USERPROFILE%\Downloads\agnd-work.pem" "%USERPROFILE%\Desktop\agnd-work.pem" "%USERPROFILE%\Downloads\mimo.pem" "%USERPROFILE%\Desktop\mimo.pem") do (
    if exist "%%~f" set "CHAVE=%%~f"
  )
)

REM  manter viva: sinal a cada 60 s, ate 1440 sem resposta = 24 h.
REM  TCPKeepAlive tambem, para o roteador/NAT nao derrubar o socket.
set "SSH=ssh -i "%CHAVE%" -o ServerAliveInterval=60 -o ServerAliveCountMax=1440 -o TCPKeepAlive=yes -o ConnectTimeout=15 -t %USUARIO%@%HOST%"

REM --- caractere de escape, para as cores ANSI do Windows 10+ ---
for /f %%a in ('echo prompt $E ^| cmd') do set "E=%%a"

REM  rosa e ameixa do MIMO, em 24 bits
set "P=%E%[38;2;255;45;122m"
set "L=%E%[38;2;184;167;247m"
set "A=%E%[93m"
set "R=%E%[91m"
set "D=%E%[90m"
set "B=%E%[1m"
set "X=%E%[0m"

color 07
cls
echo.
echo %P%   ███╗   ███╗██╗███╗   ███╗ ██████╗ %X%
echo %P%   ████╗ ████║██║████╗ ████║██╔═══██╗%X%
echo %P%   ██╔████╔██║██║██╔████╔██║██║   ██║%X%
echo %P%   ██║╚██╔╝██║██║██║╚██╔╝██║██║   ██║%X%
echo %P%   ██║ ╚═╝ ██║██║██║ ╚═╝ ██║╚██████╔╝%X%
echo %P%   ╚═╝     ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝ %X%
echo %L%   ════ beleza na palma da mao ════%X%
echo.
echo %D% ───────────────────────────────────────────────────────────%X%
echo %D%  alvo   %X%%L%%USUARIO%@%HOST%%X%   %D%(Evolution + site)%X%
echo %D%  chave  %X%%CHAVE%
echo %D%  site   %X%%SITE%
echo %D% ───────────────────────────────────────────────────────────%X%
echo.

where ssh >nul 2>&1
if errorlevel 1 (
  echo  %R%[X] ssh nao encontrado neste Windows.%X%
  echo      Configuracoes ^> Aplicativos ^> Recursos opcionais ^> "Cliente OpenSSH"
  echo.
  pause
  exit /b 1
)

if not exist "%CHAVE%" (
  echo  %R%[X] chave nao encontrada:%X% %CHAVE%
  echo.
  echo      Copie o .pem para  %L%%USERPROFILE%\.ssh\mimo.pem%X%
  echo      ou edite a linha CHAVE= neste arquivo.
  echo.
  pause
  exit /b 1
)

echo  %P%[ok]%X% ssh encontrado
echo  %P%[ok]%X% chave encontrada
ping -n 2 127.0.0.1 >nul

echo.
echo %D%  o que vamos fazer?%X%
echo.
echo    %B%%L%1%X%  abrir o terminal          %D%(cai em %PROJETO%/evolution)%X%
echo    %B%%L%2%X%  PUBLICAR O SITE           %D%(git pull + build + caddy)%X%
echo    %B%%L%3%X%  status dos containers     %D%(docker compose ps)%X%
echo    %B%%L%4%X%  logs do site (caddy)      %D%(ao vivo, Ctrl+C sai)%X%
echo    %B%%L%5%X%  logs da Evolution         %D%(ao vivo, Ctrl+C sai)%X%
echo    %B%%L%6%X%  empurrar a fila do Whats  %D%(disparar.sh)%X%
echo    %B%%L%7%X%  diagnostico da Evolution  %D%(diagnostico.sh)%X%
echo    %B%%L%8%X%  reconectar o WhatsApp     %D%(conectar.sh - QR code)%X%
echo    %B%%L%0%X%  sair
echo.
set /p "OP=%L% > %X%"

if "%OP%"=="1" goto shell
if "%OP%"=="2" goto publicar
if "%OP%"=="3" goto status
if "%OP%"=="4" goto logsite
if "%OP%"=="5" goto logsevo
if "%OP%"=="6" goto fila
if "%OP%"=="7" goto diag
if "%OP%"=="8" goto reconectar
if "%OP%"=="0" exit /b 0
echo  %A%opcao invalida%X%
timeout /t 2 >nul
exit /b 1

:shell
echo.
echo %D%  conectando... (a sessao fica viva ate voce fechar)%X%
%SSH% "cd %PROJETO%/evolution && exec bash -l"
goto fim

:publicar
echo.
echo  %A%[!] Isto vai atualizar o SITE no ar.%X%
echo      branch: %L%%BRANCH%%X%
echo.
set /p "OK=%A%  digite SIM para confirmar: %X%"
if /i not "%OK%"=="SIM" (
  echo  %D%cancelado%X%
  goto fim
)
echo.
%SSH% "cd %PROJETO%/evolution && git pull --ff-only origin %BRANCH% && ./publicar-site.sh"
if errorlevel 1 (
  echo.
  echo  %R%[X] a publicacao falhou. Leia o erro acima.%X%
  echo      Opcao %L%4%X% mostra os logs do caddy.
) else (
  echo.
  echo  %P%[ok]%X% no ar em %L%%SITE%%X%
)
goto fim

:status
echo.
%SSH% "cd %PROJETO%/evolution && docker compose ps"
goto fim

:logsite
echo.
echo %D%  Ctrl+C para sair%X%
%SSH% "cd %PROJETO%/evolution && docker compose logs caddy --tail 60 -f"
goto fim

:logsevo
echo.
echo %D%  Ctrl+C para sair%X%
%SSH% "cd %PROJETO%/evolution && docker compose logs evolution --tail 60 -f"
goto fim

:fila
echo.
%SSH% "cd %PROJETO%/evolution && ./disparar.sh"
goto fim

:diag
echo.
%SSH% "cd %PROJETO%/evolution && ./diagnostico.sh"
goto fim

:reconectar
echo.
echo %D%  vai pedir para escanear o QR code no WhatsApp do salao%X%
%SSH% "cd %PROJETO%/evolution && ./conectar.sh"
goto fim

:fim
echo.
echo %D%  sessao encerrada.%X%
echo.
pause
