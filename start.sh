#!/bin/bash
# One command to run the validator locally. HIPAA-safe: binds to 127.0.0.1,
# nothing is uploaded. Auto-uses Python's built-in server, or falls back to R.
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT/validator.html"
open_browser(){ sleep 1; command -v open >/dev/null 2>&1 && open "$URL" && return
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" && return; echo "Open this in your browser: $URL"; }
echo "Starting local validator at $URL"
echo "(127.0.0.1 only — your data never leaves this machine. Ctrl+C to stop.)"
if command -v python3 >/dev/null 2>&1; then
  open_browser & exec python3 -m http.server "$PORT" --bind 127.0.0.1
elif command -v python >/dev/null 2>&1; then
  open_browser & exec python -m http.server "$PORT" --bind 127.0.0.1
elif command -v Rscript >/dev/null 2>&1; then
  exec Rscript serve.R "$PORT"
else
  echo "Need Python 3 or R installed. (Or just double-click validator.html — it works offline.)"; exit 1
fi
