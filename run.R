#!/usr/bin/env Rscript
# =============================================================================
# run.R  --  the whole thing, one step.
#
#   1. Put your data file (.csv / .xlsx / .rds) in the  data/  folder.
#   2. If your column names differ from the study's, edit  column_map.csv
#      (a template is written for you the first time you run this).
#   3. Run:   Rscript run.R      (or double-click run.command on a Mac)
#
# Results open in your browser and are saved in  validation_output/.
# =============================================================================

# work from this script's own folder, so data/ and column_map.csv are found
.self <- function() {
  a <- commandArgs(FALSE); m <- grep("^--file=", a, value = TRUE)
  if (length(m)) return(dirname(normalizePath(sub("^--file=", "", m[1]))))
  getwd()
}
setwd(.self())
source("validate_data.R")

check_requirements()                       # verify R + install readxl if needed

if (!file.exists("column_map.csv")) {
  write_map_template("column_map.csv")
  cat("\nA column_map.csv template was created. If your spreadsheet already\n",
      "uses the study's column names, you can ignore it. Otherwise edit the\n",
      "'your_column' values, then run again.\n\n", sep = "")
}
map <- if (file.exists("column_map.csv")) map_from_csv("column_map.csv") else NULL

# auto-detect the data file in ./data and run the full validation + scoring
validate_data(map = map, open = interactive())
