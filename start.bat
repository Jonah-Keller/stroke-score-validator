@echo off
cd /d "%~dp0"
set PORT=8765
start "" http://localhost:%PORT%/validator.html
python -m http.server --bind 127.0.0.1 %PORT% 2>nul || py -m http.server --bind 127.0.0.1 %PORT% 2>nul || Rscript serve.R %PORT%
