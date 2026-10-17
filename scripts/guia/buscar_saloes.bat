@echo off
rem MIMO: busca os saloes de UMA cidade no Google Maps (Places API New) e grava os CSVs na pasta "saida", ao lado deste arquivo.
rem   buscar_saloes.bat "Praia Grande"    ou de dois cliques e digite a cidade
rem Uma cidade por vez gasta o minimo da cota gratis do mes: o que ja foi importado (Itanhaem, Mongagua) nao e buscado de novo.
rem A regiao inteira de uma vez so na mao: python buscar_saloes.py --regiao baixada-santista --saida saida
rem A chave da Places API e pedida na tela (nao aparece ao digitar) ou vem da variavel GOOGLE_PLACES_KEY.
rem Rode de novo no mes seguinte para o que ficou em mimo_pendentes.csv: o cache guarda o que ja foi feito.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Instale o Python 3 em https://www.python.org/downloads/ marcando "Add python.exe to PATH" e rode de novo.
  pause
  exit /b 1
)
python -c "import requests" >nul 2>nul
if errorlevel 1 python -m pip install requests
set "CIDADE=%~1"
if "%CIDADE%"=="" set /p CIDADE=Qual cidade? (ex.: Santos, Praia Grande, Peruibe): 
if "%CIDADE%"=="" (
  echo Sem cidade, sem busca.
  pause
  exit /b 1
)
python buscar_saloes.py --cidade "%CIDADE%" --saida saida
echo.
echo Os CSVs estao em %~dp0saida
pause
