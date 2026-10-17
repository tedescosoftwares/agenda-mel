@echo off
rem MIMO: busca os saloes no Google Maps (Places API New) e grava os CSVs na pasta "saida", ao lado deste arquivo.
rem   buscar_saloes.bat                   a Baixada Santista inteira (um CSV por cidade)
rem   buscar_saloes.bat "Praia Grande"    uma cidade so
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
if "%~1"=="" (
  python buscar_saloes.py --regiao baixada-santista --saida saida
) else (
  python buscar_saloes.py --cidade "%~1" --saida saida
)
echo.
echo Os CSVs estao em %~dp0saida
pause
