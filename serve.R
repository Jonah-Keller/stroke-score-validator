#!/usr/bin/env Rscript
# =============================================================================
# serve.R  --  Serve the validator locally (HIPAA-safe fallback if no Python).
# Binds to 127.0.0.1 only; serves static files; nothing is uploaded anywhere.
# Auto-installs the tiny 'httpuv' web-server package if it is missing.
# =============================================================================
args <- commandArgs(trailingOnly = TRUE)
port <- if (length(args) && !is.na(as.integer(args[1]))) as.integer(args[1]) else 8765

# run from this script's own folder so it serves the right files
.self <- function() {
  a <- commandArgs(FALSE); m <- grep("^--file=", a, value = TRUE)
  if (length(m)) return(dirname(normalizePath(sub("^--file=", "", m[1]))))
  getwd()
}
setwd(.self())

if (!requireNamespace("httpuv", quietly = TRUE)) {
  message("Installing 'httpuv' (one-time) ...")
  install.packages("httpuv", repos = "https://cloud.r-project.org")
}
if (!requireNamespace("httpuv", quietly = TRUE) ||
    !"runStaticServer" %in% getNamespaceExports("httpuv"))
  stop("Could not start the R web server. Please install Python 3 and use start.sh, ",
       "or just double-click validator.html (it works offline with no server).")

url <- sprintf("http://localhost:%d/validator.html", port)
cat("\n  Local validator running at:  ", url, "\n",
    "  HIPAA-safe: 127.0.0.1 only, static files, no data leaves this machine.\n",
    "  Press Ctrl+C to stop.\n\n", sep = "")
try(utils::browseURL(url), silent = TRUE)
httpuv::runStaticServer(dir = ".", port = port, host = "127.0.0.1")
