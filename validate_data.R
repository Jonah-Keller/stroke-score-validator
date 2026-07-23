# =============================================================================
# validate_data.R  --  One-file external data validator
# =============================================================================
# HOW A COLLABORATOR USES THIS (two lines):
#
#   source("validation/validate_data.R")
#   validate_data("my_data.xlsx", age = "AGE_YRS", nihss = "NIH_score", ...)
#
# You only list the columns whose names differ from ours. Anything you don't
# list is looked up by its default name. Outputs (an HTML report + CSV lists of
# every offending row) are written to ./validation_output/.
#
# Not sure what to map? Run:  validate_template()   to print a ready-to-edit call.
#
# The study's EXPECTATIONS live in section (A) below — edit them only if your
# site's codebook genuinely differs (e.g. a different TICI encoding).
# Base R only; reading .xlsx/.xls also needs install.packages("readxl").
# =============================================================================


# =============================================================================
# (A) STUDY EXPECTATIONS  --  what each variable should look like
# =============================================================================
# type: "continuous" | "integer" | "binary" | "ordinal" | "categorical"
.var <- function(name, label, type, min = NA_real_, max = NA_real_,
                 allowed = NULL, required = FALSE, allow_na = TRUE,
                 max_missing_frac = 1.0) {
  list(name = name, label = label, type = type, min = min, max = max,
       allowed = allowed, required = required, allow_na = allow_na,
       max_missing_frac = max_missing_frac)
}

# Variables needed for the TWO bedside scores. Peri-procedural inputs: age,
# nihss, tici, number_of_passes, hx_cancer. Pre-operative inputs: nihss,
# hx_cancer, hx_dm2, pre_stroke_ambulatory_status, mrs_pre_stroke, hx_smoking.
# mrs_90day is the shared outcome; mortality_hospital and mrs_6month feed
# outcome-cleaning and consistency checks. (Other cohort variables are not
# validated here — this tool validates the SCORES.)
VARIABLE_SPEC <- list(
  # ---- shared / peri inputs ----
  .var("nihss", "NIHSS at presentation", "integer", min = 0, max = 42, required = TRUE),
  .var("hx_cancer", "History: cancer", "binary", required = TRUE),
  .var("age", "Age (years)", "integer", min = 18, max = 120),
  .var("tici", "TICI (mTICI or 0-5)", "ordinal", allowed = 0:5),
  .var("number_of_passes", "Number of passes", "integer", min = 0, max = 10),
  # ---- pre-operative inputs ----
  .var("hx_dm2", "History: diabetes (T2)", "binary"),
  .var("pre_stroke_ambulatory_status", "Pre-stroke ambulatory status (0=indep,1=non)", "binary"),
  .var("mrs_pre_stroke", "Pre-stroke mRS", "ordinal", allowed = 0:5),
  .var("hx_smoking", "Smoking status", "ordinal", allowed = 0:2),
  # ---- outcome ----
  .var("mrs_90day", "mRS at 90 days", "ordinal", allowed = 0:6,
       required = TRUE, max_missing_frac = 0.30),
  # ---- supporting: outcome cleaning + consistency checks ----
  .var("mortality_hospital", "In-hospital mortality", "binary"),
  .var("mrs_6month", "mRS at 6 months", "ordinal", allowed = 0:6,
       max_missing_frac = 0.40)
)
names(VARIABLE_SPEC) <- vapply(VARIABLE_SPEC, function(v) v$name, character(1))

# ---- arithmetic / cross-field consistency rules -----------------------------
# fn(df) returns TRUE for each VIOLATING row. A rule runs only if all its
# `needs` columns are present. NA inputs -> not a violation.
.rule <- function(name, description, needs, fn) {
  list(name = name, description = description, needs = needs, fn = fn)
}
.truthy <- function(x) !is.na(x) & x == 1

LOGIC_RULES <- list(
  .rule("death_implies_mrs6_90day",
        "In-hospital death but 90-day mRS < 6 (should be 6 or blank).",
        c("mortality_hospital", "mrs_90day"),
        function(df) .truthy(df$mortality_hospital) &
          !is.na(df$mrs_90day) & df$mrs_90day < 6),
  .rule("death_implies_mrs6_6month",
        "In-hospital death but 6-month mRS < 6 (should be 6 or blank).",
        c("mortality_hospital", "mrs_6month"),
        function(df) .truthy(df$mortality_hospital) &
          !is.na(df$mrs_6month) & df$mrs_6month < 6),
  .rule("mrs_no_resurrection",
        "mRS = 6 (dead) at 90 days but < 6 (alive) at 6 months.",
        c("mrs_90day", "mrs_6month"),
        function(df) !is.na(df$mrs_90day) & !is.na(df$mrs_6month) &
          df$mrs_90day == 6 & df$mrs_6month < 6),
  .rule("passes_nonzero_if_treated",
        "Number of passes = 0 but a TICI grade > 0 was recorded.",
        c("number_of_passes", "tici"),
        function(df) !is.na(df$number_of_passes) & df$number_of_passes == 0 &
          !is.na(df$tici) & df$tici > 0),
  .rule("nihss_integer",
        "NIHSS recorded with a fractional (non-integer) value.",
        c("nihss"),
        function(df) !is.na(df$nihss) & (df$nihss %% 1 != 0))
)

# ---- the two published bedside arithmetic risk scores -----------------------
# Score = sum(points_k * variable_k). Higher score = higher risk of POOR outcome.
# Each score is derived from its own ordinal logistic model (coefficients x
# scale_factor, rounded). P(good, mRS<=2) = 1/(1+exp(-(intercept - score/scale))).
# Predicted POOR if score >= threshold_pts. Values are pulled verbatim from the
# stored study models (results/models + manuscript/pre_op/results/models).
SCALE_FACTOR <- 20
OUTCOME_VAR  <- "mrs_90day"   # good outcome = mrs_90day <= GOOD_CUTOFF
GOOD_CUTOFF  <- 2

RISK_SCORES <- list(
  peri = list(
    key = "peri", label = "Peri-procedural (post) score",
    points = c(nihss = 2, age = 1, hx_cancer = 22, number_of_passes = 2, tici = -7),
    intercept = 1.5552664, threshold_pts = 86, ref_auc = 0.837,
    equation = "(2 x nihss) + (1 x age) + (22 x hx_cancer) + (2 x passes) + (-7 x tici)"
  ),
  preop = list(
    key = "preop", label = "Pre-operative score",
    points = c(nihss = 2, hx_cancer = 22, hx_dm2 = 7,
               pre_stroke_ambulatory_status = 7, mrs_pre_stroke = 6, hx_smoking = 2),
    intercept = 2.9251469, threshold_pts = 42, ref_auc = 0.854,
    equation = "(2 x nihss) + (22 x hx_cancer) + (7 x hx_dm2) + (7 x ambulatory) + (6 x pre_stroke_mrs) + (2 x smoking)"
  )
)

.score_prob <- function(score, sc) {   # P(good outcome | score) for score-spec sc
  1 / (1 + exp(-(sc$intercept - score / SCALE_FACTOR)))
}

# mTICI as recorded (0,1,2a,2b,2c,3) -> the study's 0-5 encoding. Already-numeric
# 0-5 values pass through unchanged.
.recode_tici <- function(x) {
  m <- c("0" = 0, "1" = 1, "2a" = 2, "2b" = 3, "2c" = 4, "3" = 5)
  out <- suppressWarnings(as.numeric(as.character(x)))
  key <- trimws(tolower(as.character(x)))
  hit <- key %in% names(m)
  out[hit] <- m[key[hit]]
  out
}


# =============================================================================
# (B) HELPERS
# =============================================================================
CRAN_REPO <- "https://cloud.r-project.org"

# Ensure a package is available; optionally install it from CRAN if missing.
# Returns TRUE if usable, FALSE otherwise.
.ensure_pkg <- function(pkg, install = TRUE, reason = "") {
  if (requireNamespace(pkg, quietly = TRUE)) return(TRUE)
  if (!install) {
    message("Package '", pkg, "' is not installed",
            if (nzchar(reason)) paste0(" (needed to ", reason, ")") else "",
            ". Install it with:  install.packages('", pkg, "')")
    return(FALSE)
  }
  message("Installing missing package '", pkg, "'",
          if (nzchar(reason)) paste0(" (needed to ", reason, ")") else "", " ...")
  ok <- tryCatch({
    utils::install.packages(pkg, repos = CRAN_REPO, quiet = TRUE)
    requireNamespace(pkg, quietly = TRUE)
  }, error = function(e) FALSE, warning = function(w) requireNamespace(pkg, quietly = TRUE))
  if (!ok)
    message("  Could not install '", pkg, "' automatically. ",
            "Install it manually, or (for Excel files) save your data as CSV.")
  ok
}

# Verify the R environment and report / install what the validator needs.
# Base packages (utils, tools, stats) ship with R; only Excel input needs readxl.
check_requirements <- function(install = TRUE) {
  cat("R version:", as.character(getRversion()),
      if (getRversion() >= "3.5.0") " (ok)" else " (>= 3.5 recommended)", "\n")
  base_ok <- all(vapply(c("utils", "tools", "stats"),
                        function(p) requireNamespace(p, quietly = TRUE), logical(1)))
  cat("Base packages (utils/tools/stats):", if (base_ok) "ok" else "MISSING", "\n")
  xlsx_ok <- .ensure_pkg("readxl", install = install, reason = "read .xlsx/.xls files")
  cat("Excel support (readxl):",
      if (xlsx_ok) "ok" else "not available (CSV input still works)", "\n")
  invisible(list(base = base_ok, readxl = xlsx_ok))
}

.read_any <- function(path, sheet, install_missing = TRUE) {
  if (!file.exists(path)) stop("File not found: ", path, call. = FALSE)
  ext <- tolower(tools::file_ext(path))
  na  <- c("", "NA", "N/A", ".")
  df <- switch(ext,
    csv = read.csv(path, stringsAsFactors = FALSE, check.names = FALSE, na.strings = na),
    tsv = ,
    txt = read.delim(path, stringsAsFactors = FALSE, check.names = FALSE, na.strings = na),
    rds = readRDS(path),
    xlsx = ,
    xls = {
      if (!.ensure_pkg("readxl", install = install_missing, reason = "read .xlsx/.xls files"))
        stop("Reading .", ext, " needs the 'readxl' package. ",
             "Install it with install.packages('readxl'), or save your sheet as CSV.",
             call. = FALSE)
      readxl::read_excel(path, sheet = sheet)
    },
    stop("Unsupported file type: .", ext, " (use csv/tsv/xlsx/xls/rds)", call. = FALSE)
  )
  as.data.frame(df, check.names = FALSE, stringsAsFactors = FALSE)
}

.esc <- function(x) {
  x <- as.character(x)
  x <- gsub("&", "&amp;", x, fixed = TRUE)
  x <- gsub("<", "&lt;", x, fixed = TRUE)
  gsub(">", "&gt;", x, fixed = TRUE)
}

# ---- auto-detect a data file in ./data (or the working dir) ------------------
.find_data <- function(dirs = c("data", ".")) {
  exts <- c("csv", "tsv", "xlsx", "xls", "rds")
  for (d in dirs) {
    if (!dir.exists(d)) next
    hits <- list.files(d, pattern = paste0("\\.(", paste(exts, collapse = "|"), ")$"),
                       full.names = TRUE, ignore.case = TRUE)
    hits <- hits[!grepl("validation_output", hits)]
    if (length(hits) == 1) return(hits[1])
    if (length(hits) > 1)
      stop("Found multiple data files in '", d, "': ",
           paste(basename(hits), collapse = ", "),
           ".\n  Pass the one you want explicitly, e.g. validate_data(\"data/",
           basename(hits[1]), "\").", call. = FALSE)
  }
  stop("No data file found. Put your .csv/.xlsx/.rds in a 'data/' folder, ",
       "or pass the path: validate_data(\"path/to/file.csv\").", call. = FALSE)
}

# ---- AUC (Mann-Whitney, no packages); higher `score` predicts positive ------
.auc <- function(score, positive) {
  keep <- !is.na(score) & !is.na(positive)
  score <- score[keep]; positive <- as.logical(positive[keep])
  np <- sum(positive); nn <- sum(!positive)
  if (np == 0 || nn == 0) return(NA_real_)
  r <- rank(score)
  (sum(r[positive]) - np * (np + 1) / 2) / (np * nn)
}

# ---- tiny self-contained SVG charts (no plotting packages) ------------------
.svg_open <- function(w, h) sprintf(
  "<svg viewBox='0 0 %d %d' width='100%%' style='max-width:%dpx;height:auto;font-family:sans-serif;font-size:11px'>", w, h, w)

.svg_hist <- function(score, good, thr) {   # good: logical (or NA if no outcome)
  w <- 640; h <- 300; ml <- 44; mr <- 12; mt <- 16; mb <- 40
  pw <- w - ml - mr; ph <- h - mt - mb
  rng <- range(score, na.rm = TRUE); if (diff(rng) == 0) rng <- rng + c(-1, 1)
  nb <- 24; brks <- seq(rng[1], rng[2], length.out = nb + 1)
  bin <- cut(score, brks, include.lowest = TRUE)
  have_out <- any(!is.na(good))
  cg <- if (have_out) tapply(good, bin, function(z) sum(z, na.rm = TRUE)) else NULL
  cb <- if (have_out) tapply(good, bin, function(z) sum(!z, na.rm = TRUE)) else NULL
  ct <- as.integer(table(bin))
  cg[is.na(cg)] <- 0; cb[is.na(cb)] <- 0
  ymax <- max(ct, 1)
  x_of <- function(v) ml + (v - rng[1]) / diff(rng) * pw
  y_of <- function(v) mt + ph - v / ymax * ph
  bwid <- pw / nb * 0.92
  bars <- ""
  for (i in seq_len(nb)) {
    x <- ml + (i - 1) * pw / nb + pw / nb * 0.04
    if (have_out) {
      hb <- (cb[i]) / ymax * ph; hg <- (cg[i]) / ymax * ph
      bars <- paste0(bars,
        sprintf("<rect x='%.1f' y='%.1f' width='%.1f' height='%.1f' fill='#d64545'/>",
                x, mt + ph - hb, bwid, hb),
        sprintf("<rect x='%.1f' y='%.1f' width='%.1f' height='%.1f' fill='#2e8b57'/>",
                x, mt + ph - hb - hg, bwid, hg))
    } else {
      ht <- ct[i] / ymax * ph
      bars <- paste0(bars, sprintf(
        "<rect x='%.1f' y='%.1f' width='%.1f' height='%.1f' fill='#4a72b0'/>",
        x, mt + ph - ht, bwid, ht))
    }
  }
  thr_line <- if (thr >= rng[1] && thr <= rng[2]) sprintf(
    "<line x1='%.1f' y1='%d' x2='%.1f' y2='%d' stroke='#111' stroke-dasharray='4 3'/><text x='%.1f' y='%d' text-anchor='middle'>threshold %d</text>",
    x_of(thr), mt, x_of(thr), mt + ph, x_of(thr), mt - 4, thr) else ""
  axis <- sprintf(
    "<line x1='%d' y1='%d' x2='%d' y2='%d' stroke='#888'/><line x1='%d' y1='%d' x2='%d' y2='%d' stroke='#888'/>",
    ml, mt + ph, ml + pw, mt + ph, ml, mt, ml, mt + ph)
  labs <- ""
  for (v in pretty(rng, 6)) if (v >= rng[1] && v <= rng[2])
    labs <- paste0(labs, sprintf(
      "<text x='%.1f' y='%d' text-anchor='middle' fill='#555'>%s</text>",
      x_of(v), mt + ph + 16, format(round(v))))
  ylab <- sprintf("<text x='%d' y='%d' text-anchor='middle' fill='#555'>%d</text><text x='%d' y='%d' text-anchor='middle' fill='#555'>0</text>",
                  ml - 24, mt + 8, ymax, ml - 24, mt + ph)
  legend <- if (have_out) paste0(
    "<rect x='", ml + pw - 150, "' y='", mt, "' width='10' height='10' fill='#2e8b57'/>",
    "<text x='", ml + pw - 135, "' y='", mt + 9, "'>Good (mRS &#8804;2)</text>",
    "<rect x='", ml + pw - 150, "' y='", mt + 15, "' width='10' height='10' fill='#d64545'/>",
    "<text x='", ml + pw - 135, "' y='", mt + 24, "'>Poor (mRS &gt;2)</text>") else ""
  paste0(.svg_open(w, h), axis, bars, thr_line, labs, ylab, legend,
         sprintf("<text x='%d' y='%d' text-anchor='middle' fill='#333'>Risk score</text>",
                 ml + pw / 2, h - 6), "</svg>")
}

.svg_roc <- function(score, positive) {
  keep <- !is.na(score) & !is.na(positive)
  score <- score[keep]; positive <- as.logical(positive[keep])
  np <- sum(positive); nn <- sum(!positive)
  if (np == 0 || nn == 0) return("<p class='muted'>No outcome data to plot ROC.</p>")
  thr <- sort(unique(score), decreasing = TRUE)
  tpr <- c(0); fpr <- c(0)
  for (t in thr) {
    pred <- score >= t
    tpr <- c(tpr, sum(pred & positive) / np)
    fpr <- c(fpr, sum(pred & !positive) / nn)
  }
  tpr <- c(tpr, 1); fpr <- c(fpr, 1)
  w <- 300; h <- 300; m <- 40; pw <- w - 2 * m; ph <- h - 2 * m
  X <- function(v) m + v * pw; Y <- function(v) m + ph - v * ph
  pts <- paste(sprintf("%.1f,%.1f", X(fpr), Y(tpr)), collapse = " ")
  auc <- .auc(score, positive)
  paste0(.svg_open(w, h),
    sprintf("<rect x='%d' y='%d' width='%d' height='%d' fill='none' stroke='#ccc'/>", m, m, pw, ph),
    sprintf("<line x1='%d' y1='%d' x2='%d' y2='%d' stroke='#ddd' stroke-dasharray='3 3'/>",
            m, m + ph, m + pw, m),
    sprintf("<polyline points='%s' fill='none' stroke='#4a72b0' stroke-width='2'/>", pts),
    sprintf("<text x='%d' y='%d' text-anchor='middle'>AUC = %.3f</text>", m + pw / 2, m + ph - 10, auc),
    sprintf("<text x='%d' y='%d' text-anchor='middle' fill='#555'>1 - Specificity</text>", m + pw / 2, h - 8),
    sprintf("<text x='12' y='%d' transform='rotate(-90 12 %d)' text-anchor='middle' fill='#555'>Sensitivity</text>", m + ph / 2, m + ph / 2),
    "</svg>")
}

# ---- compute the arithmetic score + evaluate it -----------------------------
.score_and_eval <- function(canon_df, row_ids) {
  n <- nrow(canon_df)

  # shared outcome (good = mRS <= cutoff), with the study's death->mRS 6 cleaning
  good <- rep(NA, n)
  if (OUTCOME_VAR %in% names(canon_df)) {
    mrs <- canon_df[[OUTCOME_VAR]]
    if ("mortality_hospital" %in% names(canon_df))
      mrs[is.na(mrs) & canon_df$mortality_hospital == 1] <- 6
    good <- mrs <= GOOD_CUTOFF
  }
  poor <- !good

  # compute + evaluate each score independently
  scores <- list()
  for (sc in RISK_SCORES) {
    needed <- names(sc$points)
    missing_inputs <- setdiff(needed, names(canon_df))
    complete <- rep(!length(missing_inputs), n)
    score <- rep(NA_real_, n)
    if (!length(missing_inputs)) {
      for (v in needed) complete <- complete & !is.na(canon_df[[v]])
      s <- rep(0, n)
      for (v in needed) s <- s + sc$points[[v]] * canon_df[[v]]
      score[complete] <- s[complete]
    }
    pred_poor <- score >= sc$threshold_pts
    ev <- list(scorable = sum(!is.na(score)),
               excluded_missing = sum(is.na(score)),
               missing_inputs = missing_inputs)
    keep <- !is.na(score) & !is.na(good)
    ev$n_eval <- sum(keep)
    if (ev$n_eval > 0 && any(poor[keep]) && any(good[keep])) {
      ev$auc <- .auc(score[keep], poor[keep])
      tp <- sum(pred_poor & poor, na.rm = TRUE); fn <- sum(!pred_poor & poor, na.rm = TRUE)
      tn <- sum(!pred_poor & good, na.rm = TRUE); fp <- sum(pred_poor & good, na.rm = TRUE)
      ev$sensitivity <- tp / (tp + fn); ev$specificity <- tn / (tn + fp)
      ev$confusion <- c(tp = tp, fp = fp, fn = fn, tn = tn)
    }
    scores[[sc$key]] <- list(spec = sc, score = score, prob = .score_prob(score, sc),
                             pred_poor = pred_poor, eval = ev)
  }

  # combined per-row scored table (both scores side by side)
  scored <- data.frame(row_id = row_ids, stringsAsFactors = FALSE)
  for (k in names(scores)) {
    sr <- scores[[k]]
    scored[[paste0(k, "_score")]] <- round(sr$score, 1)
    scored[[paste0(k, "_pred")]]  <- ifelse(is.na(sr$pred_poor), NA,
                                     ifelse(sr$pred_poor, "poor", "good"))
  }
  scored$observed <- ifelse(is.na(good), NA, ifelse(good, "good", "poor"))

  list(scores = scores, scored = scored, good = good)
}


# =============================================================================
# (C) THE ONE FUNCTION
# =============================================================================
# file        : path to .csv/.tsv/.xlsx/.xls/.rds
# ...         : canonical = "your_column_name"  (only those that differ)
# map         : alternative to ..., a named character vector of the same thing
# sheet       : Excel sheet name/number
# id_col      : your row-identifier column (used to label exceptions)
# output_dir  : where to write results (default ./validation_output)
# open        : open the HTML report when done (default: TRUE if interactive)
# Returns (invisibly) a list: exceptions, variable_summary, rule_summary, paths.
validate_data <- function(file = NULL, ..., map = NULL, sheet = 1, id_col = NULL,
                          score = TRUE, output_dir = "validation_output",
                          open = interactive(), max_rows_html = 500,
                          install_missing = TRUE) {

  dots <- list(...)
  if (length(dots)) {
    if (is.null(names(dots)) || any(names(dots) == ""))
      stop("Column mappings must be named, e.g. validate_data(file, age = 'AGE').",
           call. = FALSE)
    map <- c(map, unlist(dots))
  }
  unknown <- setdiff(names(map), names(VARIABLE_SPEC))
  if (length(unknown))
    warning("Ignoring unrecognized variable(s): ", paste(unknown, collapse = ", "),
            "\n  Recognized names: ", paste(names(VARIABLE_SPEC), collapse = ", "),
            call. = FALSE)

  if (is.null(file)) {                       # auto-detect a file in ./data
    file <- .find_data()
    cat("Auto-detected data file:", file, "\n")
  }
  raw <- .read_any(file, sheet, install_missing = install_missing)
  dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)
  cat(sprintf("Loaded %d rows x %d columns from %s\n", nrow(raw), ncol(raw), file))

  resolve <- function(canon) if (canon %in% names(map)) unname(map[[canon]]) else canon
  row_ids <- if (!is.null(id_col) && id_col %in% names(raw))
    as.character(raw[[id_col]]) else as.character(seq_len(nrow(raw)))

  # normalize mTICI (0,1,2a,2b,2c,3) -> 0-5 in place, so checks and scoring agree
  tici_src <- resolve("tici")
  if (tici_src %in% names(raw)) raw[[tici_src]] <- .recode_tici(raw[[tici_src]])

  exceptions <- list()
  add_exc <- function(i, check, variable, value, expected) {
    exceptions[[length(exceptions) + 1]] <<- data.frame(
      row_id = row_ids[i], row_num = i, check = check, variable = variable,
      value = as.character(value), expected = expected, stringsAsFactors = FALSE)
  }
  var_summary <- list()
  missing_required <- character(0)
  present_map <- list()

  # ---- per-variable cell checks ---------------------------------------------
  for (canon in names(VARIABLE_SPEC)) {
    sp  <- VARIABLE_SPEC[[canon]]
    src <- resolve(canon)
    if (!(src %in% names(raw))) {
      if (sp$required) missing_required <- c(missing_required, canon)
      var_summary[[canon]] <- data.frame(
        variable = canon, mapped_to = src, present = FALSE, n = 0L,
        n_missing = NA_integer_, pct_missing = NA_real_, n_type_err = NA_integer_,
        n_range_err = NA_integer_,
        status = if (sp$required) "MISSING (required)" else "not provided",
        stringsAsFactors = FALSE)
      next
    }
    present_map[[canon]] <- src
    x <- raw[[src]]
    n <- length(x)
    is_na <- is.na(x)
    n_missing <- sum(is_na)
    n_type_err <- 0L
    n_range_err <- 0L
    num_types <- c("continuous", "integer", "binary", "ordinal")

    if (sp$type %in% num_types) {
      xc <- suppressWarnings(as.numeric(as.character(x)))
      for (i in which(is.na(xc) & !is_na)) {
        add_exc(i, "type", canon, x[i], "numeric value")
        n_type_err <- n_type_err + 1L
      }
      ok <- !is.na(xc)
      if (sp$type == "binary") {
        bad <- ok & !(xc %in% c(0, 1))
        for (i in which(bad)) add_exc(i, "allowed", canon, x[i], "0 or 1")
        n_range_err <- sum(bad)
      } else if (!is.null(sp$allowed)) {
        bad <- ok & !(xc %in% sp$allowed)
        for (i in which(bad))
          add_exc(i, "allowed", canon, x[i],
                  paste0("one of {", paste(sp$allowed, collapse = ","), "}"))
        n_range_err <- sum(bad)
      } else {
        lo <- if (!is.na(sp$min)) xc < sp$min else rep(FALSE, n)
        hi <- if (!is.na(sp$max)) xc > sp$max else rep(FALSE, n)
        bad <- ok & (lo | hi)
        exp_txt <- paste0("[", ifelse(is.na(sp$min), "-Inf", sp$min), ", ",
                          ifelse(is.na(sp$max), "Inf", sp$max), "]")
        for (i in which(bad)) add_exc(i, "range", canon, x[i], exp_txt)
        n_range_err <- sum(bad)
        if (sp$type == "integer") {
          frac <- ok & (xc %% 1 != 0)
          for (i in which(frac)) add_exc(i, "type", canon, x[i], "whole number")
          n_type_err <- n_type_err + sum(frac)
        }
      }
    } else if (sp$type == "categorical" && !is.null(sp$allowed)) {
      xs <- trimws(as.character(x))
      bad <- !is_na & !(xs %in% sp$allowed)
      for (i in which(bad))
        add_exc(i, "allowed", canon, x[i],
                paste0("one of {", paste(sp$allowed, collapse = ","), "}"))
      n_range_err <- sum(bad)
    }

    miss_status <- ""
    if (!sp$allow_na && n_missing > 0) {
      for (i in which(is_na)) add_exc(i, "missing", canon, NA, "non-missing value")
      miss_status <- "MISSING VALUES not allowed"
    } else if (n_missing / n > sp$max_missing_frac) {
      miss_status <- sprintf("missingness %.0f%% > %.0f%% threshold",
                             100 * n_missing / n, 100 * sp$max_missing_frac)
    }
    flags <- c(if (n_type_err > 0) sprintf("%d type", n_type_err),
               if (n_range_err > 0) sprintf("%d out-of-range", n_range_err),
               if (nzchar(miss_status)) miss_status)
    var_summary[[canon]] <- data.frame(
      variable = canon, mapped_to = src, present = TRUE, n = n,
      n_missing = n_missing, pct_missing = round(100 * n_missing / n, 1),
      n_type_err = n_type_err, n_range_err = n_range_err,
      status = if (length(flags)) paste(flags, collapse = "; ") else "ok",
      stringsAsFactors = FALSE)
  }

  # ---- arithmetic / logic rules ---------------------------------------------
  canon_df <- data.frame(row.names = seq_len(nrow(raw)))
  for (canon in names(present_map)) {
    sp <- VARIABLE_SPEC[[canon]]
    v  <- raw[[present_map[[canon]]]]
    canon_df[[canon]] <- if (sp$type == "categorical") as.character(v)
      else suppressWarnings(as.numeric(as.character(v)))
  }
  rule_summary <- list()
  for (rl in LOGIC_RULES) {
    if (!all(rl$needs %in% names(canon_df))) {
      rule_summary[[rl$name]] <- data.frame(
        rule = rl$name, description = rl$description,
        status = paste0("skipped (needs ",
                        paste(setdiff(rl$needs, names(canon_df)), collapse = ", "), ")"),
        n_violations = NA_integer_, stringsAsFactors = FALSE)
      next
    }
    viol <- tryCatch(rl$fn(canon_df), error = function(e) rep(FALSE, nrow(canon_df)))
    viol[is.na(viol)] <- FALSE
    for (i in which(viol)) add_exc(i, "logic", rl$name, "", rl$description)
    rule_summary[[rl$name]] <- data.frame(
      rule = rl$name, description = rl$description,
      status = if (sum(viol) == 0) "pass" else "VIOLATIONS",
      n_violations = sum(viol), stringsAsFactors = FALSE)
  }

  # ---- arithmetic risk score -------------------------------------------------
  score_res <- if (isTRUE(score)) .score_and_eval(canon_df, row_ids) else NULL

  # ---- assemble + write ------------------------------------------------------
  exc_df <- if (length(exceptions)) do.call(rbind, exceptions) else
    data.frame(row_id = character(0), row_num = integer(0), check = character(0),
               variable = character(0), value = character(0), expected = character(0))
  var_df  <- do.call(rbind, var_summary)
  rule_df <- do.call(rbind, rule_summary)

  p_exc  <- file.path(output_dir, "exceptions.csv")
  p_var  <- file.path(output_dir, "variable_summary.csv")
  p_html <- file.path(output_dir, "validation_report.html")
  p_scr  <- file.path(output_dir, "scored_data.csv")
  write.csv(exc_df, p_exc, row.names = FALSE)
  write.csv(var_df, p_var, row.names = FALSE)
  if (!is.null(score_res)) write.csv(score_res$scored, p_scr, row.names = FALSE)
  .write_html(p_html, file, raw, exc_df, var_df, rule_df, missing_required,
              max_rows_html, score_res)

  # ---- console summary -------------------------------------------------------
  cat(strrep("-", 60), "\n")
  if (length(missing_required))
    cat("!! Missing REQUIRED variables:",
        paste(missing_required, collapse = ", "), "\n")
  cat(sprintf("Variables present: %d/%d   Total exceptions: %d\n",
              sum(var_df$present), nrow(var_df), nrow(exc_df)))
  if (nrow(exc_df)) {
    tb <- table(exc_df$check)
    cat("  by check:", paste(sprintf("%s=%d", names(tb), as.integer(tb)),
                             collapse = "  "), "\n")
  }
  if (!is.null(score_res)) {
    for (sr in score_res$scores) {
      ev <- sr$eval; sc <- sr$spec
      cat(sprintf("%s:\n", sc$label))
      if (length(ev$missing_inputs))
        cat("  CANNOT compute - missing input(s):",
            paste(ev$missing_inputs, collapse = ", "), "\n")
      else {
        cat(sprintf("  %d scored, %d excluded for missing inputs\n",
                    ev$scorable, ev$excluded_missing))
        if (!is.null(ev$auc))
          cat(sprintf("  AUC = %.3f  (sens %.0f%%, spec %.0f%% at threshold %d)  [study ref %.3f]\n",
                      ev$auc, 100 * ev$sensitivity, 100 * ev$specificity,
                      sc$threshold_pts, sc$ref_auc))
        else cat("  (no usable outcome -> computed but not evaluated)\n")
      }
    }
  }
  cat("Report:", normalizePath(p_html), "\n")
  cat(strrep("-", 60), "\n")
  if (isTRUE(open)) try(utils::browseURL(p_html), silent = TRUE)

  invisible(list(exceptions = exc_df, variable_summary = var_df,
                 rule_summary = rule_df, missing_required = missing_required,
                 score = score_res,
                 paths = list(html = p_html, exceptions = p_exc,
                              variables = p_var, scored = p_scr)))
}


# ---- CSV column map (edit-a-spreadsheet flow, no R editing needed) -----------
# Write a template the collaborator fills in: study_variable, your_column.
write_map_template <- function(path = "column_map.csv") {
  nm <- names(VARIABLE_SPEC)
  df <- data.frame(
    study_variable = nm,
    your_column = nm,                       # identity default; edit the right side
    description = vapply(VARIABLE_SPEC, function(v) v$label, character(1)),
    stringsAsFactors = FALSE)
  write.csv(df, path, row.names = FALSE)
  cat("Wrote map template to", path,
      "\nEdit the 'your_column' values to match your spreadsheet headers,",
      "\nthen re-run. Delete rows for variables you don't have.\n")
  invisible(path)
}

# Read a filled-in column_map.csv into a named vector for validate_data(map=).
map_from_csv <- function(path = "column_map.csv") {
  m <- read.csv(path, stringsAsFactors = FALSE)
  need <- c("study_variable", "your_column")
  if (!all(need %in% names(m)))
    stop("column_map.csv must have columns: ", paste(need, collapse = ", "),
         call. = FALSE)
  m <- m[!is.na(m$your_column) & nzchar(trimws(m$your_column)), ]
  setNames(trimws(m$your_column), trimws(m$study_variable))
}


# ---- print a ready-to-paste call skeleton -----------------------------------
validate_template <- function() {
  cat("validate_data(\n  \"YOUR_FILE.xlsx\",   # or .csv / .rds\n")
  nm <- names(VARIABLE_SPEC)
  w  <- max(nchar(nm))
  for (i in seq_along(nm)) {
    lab <- VARIABLE_SPEC[[nm[i]]]$label
    comma <- if (i < length(nm)) "," else ""
    cat(sprintf("  %-*s = \"%s\"%s   # %s\n", w, nm[i], nm[i], comma, lab))
  }
  cat(")\n")
  invisible(NULL)
}


# =============================================================================
# (D) HTML REPORT WRITER
# =============================================================================
.write_html <- function(path, file, raw, exc_df, var_df, rule_df,
                        missing_required, max_rows_html, score_res = NULL) {
  tbl <- function(df, cap_rows = Inf) {
    if (nrow(df) == 0) return("<p class='ok'>None.</p>")
    note <- ""
    if (nrow(df) > cap_rows) {
      note <- sprintf("<p class='note'>Showing first %d of %d rows (full list in CSV).</p>",
                      cap_rows, nrow(df))
      df <- df[seq_len(cap_rows), , drop = FALSE]
    }
    th <- paste0("<th>", .esc(names(df)), "</th>", collapse = "")
    rows <- apply(df, 1, function(r)
      paste0("<tr><td>", paste(.esc(r), collapse = "</td><td>"), "</td></tr>"))
    paste0(note, "<div class='scroll'><table><thead><tr>", th,
           "</tr></thead><tbody>", paste(rows, collapse = ""),
           "</tbody></table></div>")
  }
  vs_rows <- apply(var_df, 1, function(r) {
    cls <- if (!as.logical(r[["present"]]))
      (if (grepl("required", r[["status"]])) "bad" else "muted")
    else if (r[["status"]] == "ok") "ok" else "bad"
    paste0("<tr class='", cls, "'><td>",
           paste(.esc(r), collapse = "</td><td>"), "</td></tr>")
  })
  vs_html <- paste0("<div class='scroll'><table><thead><tr><th>",
    paste(.esc(names(var_df)), collapse = "</th><th>"),
    "</th></tr></thead><tbody>", paste(vs_rows, collapse = ""),
    "</tbody></table></div>")

  rule_rows <- apply(rule_df, 1, function(r) {
    cls <- if (grepl("skipped", r[["status"]])) "muted"
      else if (r[["status"]] == "pass") "ok" else "bad"
    paste0("<tr class='", cls, "'><td>", .esc(r[["rule"]]), "</td><td>",
           .esc(r[["description"]]), "</td><td>", .esc(r[["status"]]), "</td><td>",
           .esc(ifelse(is.na(r[["n_violations"]]), "", r[["n_violations"]])),
           "</td></tr>")
  })
  rule_html <- paste0("<div class='scroll'><table><thead><tr><th>rule</th>",
    "<th>description</th><th>status</th><th>violations</th></tr></thead><tbody>",
    paste(rule_rows, collapse = ""), "</tbody></table></div>")

  titles <- c(missing = "Missing values (not permitted)",
              type = "Type / coercion errors", range = "Out-of-range values",
              allowed = "Disallowed category / code",
              logic = "Arithmetic / cross-field logic violations")
  sections <- ""
  for (ck in c("missing", "type", "range", "allowed", "logic")) {
    sub <- exc_df[exc_df$check == ck, , drop = FALSE]
    if (nrow(sub) == 0) next
    sub <- sub[order(sub$variable, sub$row_num),
               c("row_id", "row_num", "variable", "value", "expected")]
    sections <- paste0(sections, "<h2>", titles[[ck]], " <span class='badge'>",
                       nrow(sub), "</span></h2>", tbl(sub, max_rows_html))
  }
  if (!nzchar(sections)) sections <- "<p class='ok big'>No exceptions found. &#10003;</p>"

  banner <- if (length(missing_required))
    paste0("<div class='banner bad'>Missing REQUIRED variables: ",
           .esc(paste(missing_required, collapse = ", ")), "</div>") else ""

  # ---- risk-score sections (one per score) ----------------------------------
  score_html <- ""; score_card <- ""
  if (!is.null(score_res)) {
    for (sr in score_res$scores) {
      ev <- sr$eval; sc <- sr$spec
      if (length(ev$missing_inputs)) {
        score_html <- paste0(score_html, "<h2>", .esc(sc$label), "</h2>",
          "<div class='banner bad'>Cannot compute - missing input(s): ",
          .esc(paste(ev$missing_inputs, collapse = ", ")),
          ".<br>Needs: ", .esc(paste(names(sc$points), collapse = ", ")), ".</div>")
        next
      }
      hist_svg <- .svg_hist(sr$score, score_res$good, sc$threshold_pts)
      have_eval <- !is.null(ev$auc)
      perf <- if (have_eval) {
        cm <- ev$confusion
        paste0(
          "<div class='cards'>",
          "<div class='card'><div class='num'>", sprintf("%.3f", ev$auc),
          "</div><div class='lbl'>external AUC (study ref ", sprintf("%.3f", sc$ref_auc), ")</div></div>",
          "<div class='card'><div class='num'>", sprintf("%.0f%%", 100 * ev$sensitivity),
          "</div><div class='lbl'>sensitivity (poor)</div></div>",
          "<div class='card'><div class='num'>", sprintf("%.0f%%", 100 * ev$specificity),
          "</div><div class='lbl'>specificity</div></div></div>",
          "<div style='display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start'>",
          "<div style='flex:2;min-width:320px'>", hist_svg, "</div>",
          "<div style='flex:1;min-width:260px'>", .svg_roc(sr$score, !score_res$good),
          "<table style='margin-top:8px'><thead><tr><th></th><th>obs poor</th><th>obs good</th></tr></thead>",
          "<tbody><tr><td>pred poor</td><td>", cm["tp"], "</td><td>", cm["fp"], "</td></tr>",
          "<tr><td>pred good</td><td>", cm["fn"], "</td><td>", cm["tn"], "</td></tr></tbody></table>",
          "</div></div>")
      } else {
        paste0("<p class='note'>No usable outcome (", .esc(OUTCOME_VAR),
               ") - computed but not evaluated. Distribution below.</p>", hist_svg)
      }
      score_html <- paste0(score_html, "<h2>", .esc(sc$label), "</h2>",
        "<p class='muted'>Score = ", .esc(sc$equation),
        " &nbsp;|&nbsp; poor if score &#8805; ", sc$threshold_pts,
        " &nbsp;|&nbsp; ", ev$scorable, " scored, ", ev$excluded_missing,
        " excluded for missing inputs.</p>", perf)
      score_card <- paste0(score_card,
        "<div class='card'><div class='num'>",
        if (have_eval) sprintf("%.3f", ev$auc) else ev$scorable,
        "</div><div class='lbl'>", .esc(sc$key), if (have_eval) " AUC" else " scored", "</div></div>")
    }
  }

  html <- paste0(
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<title>Data Validation Report</title><style>",
    "body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:auto;",
    "max-width:1100px;padding:24px;color:#1a1a1a;background:#f7f8fa}",
    "h2{margin-top:30px;border-bottom:2px solid #e2e4e8;padding-bottom:6px}",
    ".sub{color:#666;margin-bottom:16px}",
    ".cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}",
    ".card{background:#fff;border:1px solid #e2e4e8;border-radius:10px;padding:14px 18px}",
    ".card .num{font-size:26px;font-weight:700}.card .lbl{color:#666;font-size:12px}",
    ".scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}",
    "th,td{border:1px solid #e6e8ec;padding:5px 9px;text-align:left}th{background:#f0f2f5}",
    "tr.ok td{background:#f2fbf4}tr.bad td{background:#fdf1f1}tr.muted td{color:#999;background:#fafafa}",
    ".badge{background:#d33;color:#fff;border-radius:10px;padding:1px 9px;font-size:13px}",
    ".banner.bad{background:#fdecea;color:#a1150c;border:1px solid #f3b7b1;",
    "padding:10px 14px;border-radius:8px;margin:10px 0;font-weight:600}",
    ".ok{color:#127a2b}.big{font-size:18px;font-weight:600}",
    ".note{color:#a15c00;font-size:12px}.muted{color:#888}",
    "</style></head><body>",
    "<h1>External Data Validation Report</h1>",
    "<div class='sub'>Source: ", .esc(file), " &middot; ", nrow(raw),
    " rows &middot; ", ncol(raw), " columns</div>", banner,
    "<div class='cards'>",
    "<div class='card'><div class='num'>", sum(var_df$present), "/", nrow(var_df),
    "</div><div class='lbl'>variables present</div></div>",
    "<div class='card'><div class='num'>", nrow(exc_df),
    "</div><div class='lbl'>total exceptions</div></div>",
    "<div class='card'><div class='num'>", sum(rule_df$n_violations, na.rm = TRUE),
    "</div><div class='lbl'>logic violations</div></div>", score_card, "</div>",
    score_html,
    "<h2>Variable summary</h2>", vs_html,
    "<h2>Arithmetic / logic rules</h2>", rule_html, sections,
    "<p class='muted' style='margin-top:28px'>Full lists: exceptions.csv, variable_summary.csv, scored_data.csv</p>",
    "</body></html>")
  writeLines(html, path)
}
