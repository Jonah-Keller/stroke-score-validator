# Stroke Bedside Risk-Score — External Validator

A self-contained toolkit for a collaborator to **externally validate the
published bedside arithmetic risk score** on their own cohort. It:

1. **Checks the data** — type, range, allowed values, missingness, and
   cross-field arithmetic consistency — and lists the exact rows that fail.
2. **Recomputes the arithmetic risk score** for each patient and, if outcomes
   are present, **evaluates it** (AUC, sensitivity/specificity, ROC).
3. **Writes one clean HTML report** (with charts) plus machine-readable CSVs.

The **two** scores being validated (each from its own study model):

```
PERI-PROCEDURAL (post):  2·NIHSS + 1·Age + 22·hx_cancer + 2·passes − 7·TICI
                         POOR if Score ≥ 86   (intercept 1.5553)

PRE-OPERATIVE:           2·NIHSS + 22·hx_cancer + 7·diabetes + 7·ambulatory
                         + 6·pre_stroke_mRS + 2·smoking
                         POOR if Score ≥ 42   (intercept 2.9251)
```

Both use `mrs_90day` (good = mRS ≤ 2) as the outcome. The report computes and
evaluates each score separately (AUC, sensitivity/specificity, ROC), and each
patient's row shows both scores.

**mTICI:** TICI may be entered as recorded (`0, 1, 2a, 2b, 2c, 3`) or as the
study's 0–5 encoding. The web app decides which **for the whole column**, not
value by value (see *Coding checks* below), and recodes mTICI grades
`2a→2, 2b→3, 2c→4, 3→5`. In a column using the 0–5 encoding, a `3` stays 3 (= 2b).

**Scope:** the tool validates only the variables these two scores need — it is
deliberately not a general data-quality check on your whole cohort.

---

## Recommended for PHI: run it locally (HIPAA-safe)

Because the app processes patient data, run it **entirely on your own machine** —
no data ever leaves it, nothing is uploaded, and the local server is bound to
`127.0.0.1` (localhost) so it is not reachable from your network.

```bash
git clone https://github.com/Jonah-Keller/stroke-score-validator
cd stroke-score-validator
./start.sh          # macOS/Linux  (or double-click start.command / start.bat on Windows)
```

That one command auto-starts a local web server (using Python's built-in server,
or R's `httpuv` which it auto-installs if Python is absent) and opens the app at
`http://localhost:8765/validator.html`. Then:

1. **Drop your file** (CSV or Excel) onto the page.
2. It **auto-matches your columns** to the study variables (fuzzy matching) and
   shows **sample values** next to each dropdown so you confirm/correct the pick
   — no typing headers, no config file.
3. Click **Validate & Score** → the report appears inline (score AUC, ROC,
   score-distribution chart, per-variable pass/fail, every exception row), with
   buttons to download `exceptions.csv` and `scored_data.csv`.

**Why it's safe:** `validator.html` makes **zero network requests** — no CDNs,
no fetch, no uploads. All parsing, checking, and scoring happen in your browser's
memory. The local server only hands your browser the static HTML file; it never
sees your data. (You can even skip the server entirely and just double-click
`validator.html` — it works fully offline via `file://`.)

Excel is read in-browser with no plugins; on a very old browser, save as CSV.
The app's checks and score are **identical** to the R version below (verified
cell-for-cell on the same data).

> A public demo is hosted at
> <https://jonah-keller.github.io/stroke-score-validator/> — it is also
> client-side only, but **use the local `./start.sh` for real PHI** so the file
> is served from your own machine and your compliance story is airtight.

---

## Coding checks (web app)

Under every yes/no or category column, the column matcher lists each distinct
value in your file and the code it will get. Common values (Yes/No, Y/N,
True/False, 1/0, "current / former / never", "mRS 3") are filled in
automatically; change any dropdown if one is wrong. **A value with no code is
treated as missing and counted, never silently as 0.** It is also listed in the
report under "Values with no assigned code". Some columns need an explicit answer
before you can score:

- **TICI:** the app reads the whole column. Any `2a/2b/2c`, or numbers no
  higher than 3, means mTICI grades. Any 4 or 5 (with no letters) means the
  study's 0–5 encoding. If the column mixes both, you choose. Under mTICI grades a
  bare `2` is ambiguous (2a, 2b or 2c?), so it is treated as missing and flagged.
- **Pre-stroke ambulatory status:** the study codes **1 = needs assistance /
  non-ambulatory**. Text such as "independent" or "wheelchair" is coded by meaning.
  If your column is just 0/1 or yes/no, you must say whether 1 / Yes means
  independent or dependent.
- **Smoking:** the study codes 0 = never, 1 = current, 2 = former. If your column
  has only two values (yes/no or 0/1), former smokers can't be told apart. The app
  warns that they will be under-scored (by 2 points if "yes" means ever-smoker,
  by 4 if it means current smoker) and asks which one "yes" means.

The final value → code table, the TICI coding (and whether it was auto-detected
or chosen) and these answers are written into **both** exports, with no counts,
so we can audit the coding.

---

## Cohort summary for the comparison table (aggregate only)

To compare cohort characteristics across sites, the app can also produce a
**cohort summary**, which contains summary statistics only. In the column matcher, below the score variables,
an optional section **"Cohort characteristics"** asks for these columns. Map
whichever you have and leave the rest as *(not present)*:

| Variable | What to map | Notes |
|---|---|---|
| `sex` | sex / gender | F/M and female/male are recognised. For numeric codes (e.g. 1/2), pick which value means Female/Male in the small dropdowns that appear |
| `race` | race | Grouped into the standard OMB categories; unrecognised text goes to *Other* (the summary says how many) |
| `ethnicity` | Hispanic / Latino ethnicity | If you have no ethnicity column, or it is blank, and the race column says "Hispanic"/"Latino", that patient is counted as Hispanic or Latino (race = Unknown/declined unless another race is named). The page tells you when it does this |
| `iv_thrombolysis` | IV alteplase / tenecteplase given | Y/N, yes/no, 1/0, true/false, or the drug name |
| `prior_stroke` | prior stroke | yes/no |
| `occlusion_site` | occlusion / clot location | Grouped into ICA, M1, M2, distal/MeVO, posterior, other |
| `lkn_datetime` + `puncture_datetime` | last-known-normal and groin-puncture date/times | Used only to compute LKN-to-puncture minutes. Excel dates, ISO and `M/D/YYYY HH:MM` all work. Values < 0 or > 7 days are dropped and counted |
| `lkn_to_puncture_min` | *or* a column already in minutes | Used instead of the two date/times if mapped |
| `procedure_date` | thrombectomy date | Used **only** for the first and last month of enrollment |

The summary also includes the score variables you already mapped: age, NIHSS,
pre-stroke mRS, ambulatory status, cancer, diabetes, smoking, % mTICI ≥ 2b,
passes, 90-day mRS 0–2 and mRS 6, and the pre-operative score (median/IQR,
mean/SD, % ≥ 42).

**What leaves your site:** only counts, percentages, medians/IQR, means/SD and
the first/last month of enrollment (`YYYY-MM`). It contains no patient rows and no individual
dates. **Any count of 1–10 patients is exported as `<11`**, with its percentage
withheld. If that leaves only one hidden level, the next-smallest level is also
withheld so it can't be worked out from the total. Continuous summaries are
exported only when at least 11 patients have a value. The **Cohort
characteristics** table in the report shows exactly what is exported.

After **Validate & Score**, the **Researcher export** now carries the cohort
summary inside it (`validation_export/v3`), so you only need to send that one file.
The **Cohort summary (aggregate only)** button downloads the same summary on
its own as `cohort_summary.json`.

---

## Scripted path: clone → drop file → run (no coding)

```bash
git clone <REPO_URL>
cd <repo>
```

1. Put your dataset (`.csv`, `.tsv`, `.xlsx`, `.xls`, or `.rds`) in the
   **`data/`** folder.
2. Run it:
   - **Mac:** double-click **`run.command`**
   - **Any system:** `Rscript run.R`
3. The first run writes a **`column_map.csv`**. If your spreadsheet already uses
   the study's column names, ignore it. Otherwise open it and edit the
   `your_column` values to match your headers (delete rows for variables you
   don't have), then run again.
4. Open **`validation_output/validation_report.html`**.

`run.R` verifies your R setup, installs the one optional package (`readxl`, only
if you use Excel), auto-detects the file in `data/`, applies your `column_map.csv`,
and produces the report.

## Alternative: call it in R or an Rmd

```r
source("validate_data.R")

res <- validate_data(
  "data/my_cohort.xlsx",
  nihss = "NIH_score",     # only list columns whose names differ
  tici  = "TICI_grade",
  id_col = "mrn"
)
res$score$eval$auc         # external AUC
res$exceptions             # flagged rows, ready to render inline
```

Print a ready-to-edit call with every variable: `validate_template()`.

---

## Outputs (in `validation_output/`)

| File | What it is |
|------|-----------|
| `validation_report.html` | one-page report: summary cards, **score AUC + ROC + score-distribution chart**, per-variable pass/fail, and every exception row — opens in any browser |
| `scored_data.csv` | per-patient `risk_score`, `prob_good_mrs2`, predicted vs observed |
| `exceptions.csv` | one row per offending cell/rule: `row_id, row_num, check, variable, value, expected` |
| `variable_summary.csv` | per-variable missingness and pass/fail |

The charts are hand-drawn inline SVG (histogram of scores split by outcome with
the threshold marked, plus an ROC curve) — **no plotting packages required**, so
the report renders anywhere.

## How missingness is handled

Two distinct places, both explicit — nothing is silently imputed:

- **Data quality:** every variable's missing count and % is reported in the
  variable summary. Variables exceeding the study's missingness thresholds
  (e.g. >30% for 90-day mRS) are flagged. If a *required* variable
  (age, NIHSS, TICI) is entirely absent, that's called out in a red banner.
- **Score computation — complete-case:** the score is computed only for
  patients who have all five inputs (NIHSS, age, hx_cancer, passes, TICI). Any
  patient missing an input is **excluded from scoring**, and the report states
  how many were excluded. This mirrors the study's own complete-case analysis
  and avoids inventing values. Evaluation (AUC etc.) further requires a usable
  outcome (`mrs_90day`); the study's rule of imputing mRS = 6 for in-hospital
  deaths with missing mRS is applied first.

If you *want* imputation (e.g. median-fill) instead of complete-case, that's a
deliberate analytic choice — tell us and we'll add it as an option rather than
defaulting to it.

## Requirements — handled for you

Base R only, except reading `.xlsx/.xls` needs `readxl`, which is auto-installed
on first Excel use (`install_missing = FALSE` to disable). Check up front with
`check_requirements()`. CSV / TSV / RDS need nothing extra.

## Changing the expectations or the score

Everything lives in **section (A)** at the top of `validate_data.R`: the
per-variable type/range/allowed values, the arithmetic consistency rules, and
the `RISK_SCORE` definition (points, intercept, threshold). Edit only if your
site's codebook genuinely differs (e.g. a different TICI encoding).

## Full argument list

```r
validate_data(file = NULL,         # path; omit to auto-detect ./data
              ...,                 # canonical = "your_column" pairs
              map = NULL,          # or a named vector / map_from_csv("column_map.csv")
              sheet = 1,           # Excel sheet
              id_col = NULL,       # your row-ID column
              score = TRUE,        # compute + evaluate the risk score
              output_dir = "validation_output",
              open = interactive(),
              max_rows_html = 500,
              install_missing = TRUE)
```

## Sanity-checked

Run against the study's own ground-truth data the tool reproduces the score
(AUC ≈ 0.78 on the full cohort vs 0.837 on the study holdout) and catches three
real coding errors: `number_of_passes = 12`, `mrs_6month = 12`, and one patient
coded mRS 6 at 90 days but < 6 at 6 months.
