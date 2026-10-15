// Unit tests for the cohort-summary engine in validator.html. SYNTHETIC DATA ONLY.
// Run:  node tests/test_cohort_summary.js
// Loads the DOM-free engine (text between ===ENGINE START=== and ===ENGINE END===)
// into a vm context, so the browser UI code is never executed.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "validator.html"), "utf8");
const a = html.indexOf("===ENGINE START==="), b = html.indexOf("/* ===ENGINE END=== */");
if (a < 0 || b < 0) throw new Error("engine markers not found");
const src = html.slice(html.indexOf("*/", a) + 2, b);
const ctx = vm.createContext({});
vm.runInContext(src + "\n;this.E={VARIABLE_SPEC,RISK_SCORES,COHORT_SPEC,runValidation,suggestMap,suggestCohortMap," +
  "cohortSummary,cohortSummaryExport,parseDateTime,sexAuto,sexCode,raceCode,ethCode,occCode,yesNo,suppressLevels,recodeTici," +
  "detectTiciScheme,resolveCoding,codeOf,codingRecord,MISSING_CODE,parseDelimited,tableFromGrid,detectDateOrder,pnum};", ctx);
const E = ctx.E;

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); } }
// engine objects come from another vm realm -> compare via JSON for objects
const U8 = v => v === undefined ? "<undefined>" : v;
const plain = x => x && typeof x === "object" ? JSON.parse(JSON.stringify(x, (k, v) => U8(v))) : x;
const eq = (x, y, m) => assert.deepStrictEqual(plain(x), plain(y), m);
const U = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

// ---- deterministic PRNG --------------------------------------------------------
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ---- date/time parsing -----------------------------------------------------------
console.log("parseDateTime");
t("Excel serial (string and number)", () => {
  eq(E.parseDateTime("45000.5"), U(2023, 3, 15, 12, 0));
  eq(E.parseDateTime(45000), U(2023, 3, 15));
  assert(Number.isNaN(E.parseDateTime("45")), "tiny serial must be rejected");
});
t("ISO variants and offsets", () => {
  eq(E.parseDateTime("2023-03-15T12:00:00"), U(2023, 3, 15, 12));
  eq(E.parseDateTime("2023-03-15 12:00"), U(2023, 3, 15, 12));
  eq(E.parseDateTime("2023-03-15T12:00:00.000Z"), U(2023, 3, 15, 12));
  eq(E.parseDateTime("2023-03-15T12:00:00-05:00"), U(2023, 3, 15, 17));
  eq(E.parseDateTime("2023/03/15 08:05"), U(2023, 3, 15, 8, 5));
  eq(E.parseDateTime("20230315"), U(2023, 3, 15));
});
t("US M/D/YYYY HH:MM, AM/PM, 2-digit year, D/M fallback, month names", () => {
  eq(E.parseDateTime("3/15/2023 14:30"), U(2023, 3, 15, 14, 30));
  eq(E.parseDateTime("3/15/2023 2:30 PM"), U(2023, 3, 15, 14, 30));
  eq(E.parseDateTime("3/15/2023 12:10 AM"), U(2023, 3, 15, 0, 10));
  eq(E.parseDateTime("3/15/23 14:30"), U(2023, 3, 15, 14, 30));
  eq(E.parseDateTime("25/03/2023"), U(2023, 3, 25));
  eq(E.parseDateTime("15-Mar-2023 14:30"), U(2023, 3, 15, 14, 30));
  eq(E.parseDateTime("Mar 15, 2023 14:30"), U(2023, 3, 15, 14, 30));
});
t("blank -> null, garbage / impossible -> NaN", () => {
  eq(E.parseDateTime(""), null); eq(E.parseDateTime(null), null); eq(E.parseDateTime("NA"), null);
  assert(Number.isNaN(E.parseDateTime("yesterday")));
  assert(Number.isNaN(E.parseDateTime("2/30/2023 10:00")));
  assert(Number.isNaN(E.parseDateTime("3/15/2023 25:00")));
});

// ---- category mappers ------------------------------------------------------------
console.log("category mapping");
t("race", () => {
  const r = s => E.raceCode(s).slice(0, 2);
  eq(r("White"), ["White", false]); eq(r("Caucasian"), ["White", false]); eq(r("W"), ["White", false]);
  eq(r("Black or African American"), ["Black or African American", false]); eq(r("AA") , ["Other", true]);
  eq(r("Asian Indian"), ["Asian", false]); eq(r("Chinese"), ["Asian", false]);
  eq(r("American Indian/Alaska Native"), ["American Indian or Alaska Native", false]);
  eq(r("Native Hawaiian or Other Pacific Islander"), ["Native Hawaiian or Other Pacific Islander", false]);
  eq(r("Two or more races"), ["More than one race", false]); eq(r("Multiracial"), ["More than one race", false]);
  eq(r("Patient declined"), ["Unknown/declined", false]); eq(r("Unknown"), ["Unknown/declined", false]);
  eq(r("Other"), ["Other", false]); eq(r("Martian"), ["Other", true]); eq(r(""), [null, false]);
});
t("race values that carry Hispanic/Latino ethnicity", () => {
  eq(E.raceCode("Hispanic"), ["Unknown/declined", false, "Hispanic or Latino"]);
  eq(E.raceCode("Hispanic or Latino"), ["Unknown/declined", false, "Hispanic or Latino"]);
  eq(E.raceCode("Latinx"), ["Unknown/declined", false, "Hispanic or Latino"]);
  eq(E.raceCode("Other Hispanic"), ["Unknown/declined", false, "Hispanic or Latino"]);
  eq(E.raceCode("White Hispanic"), ["White", false, "Hispanic or Latino"]);
  eq(E.raceCode("Hispanic - Black"), ["Black or African American", false, "Hispanic or Latino"]);
  eq(E.raceCode("Non-Hispanic White"), ["White", false, "Not Hispanic or Latino"]);
  eq(E.raceCode("White"), ["White", false, null]);
});
t("ethnicity", () => {
  eq(E.ethCode("Hispanic or Latino"), ["Hispanic or Latino", false]);
  eq(E.ethCode("Not Hispanic or Latino"), ["Not Hispanic or Latino", false]);
  eq(E.ethCode("Non-Hispanic"), ["Not Hispanic or Latino", false]);
  eq(E.ethCode("N"), ["Not Hispanic or Latino", false]); eq(E.ethCode("Y"), ["Hispanic or Latino", false]);
  eq(E.ethCode("Declined"), ["Unknown", false]); eq(E.ethCode("7"), ["Unknown", true]); eq(E.ethCode(""), [null, false]);
});
t("occlusion site", () => {
  const o = s => E.occCode(s)[0];
  eq(o("L ICA"), "ICA"); eq(o("T-ICA"), "ICA"); eq(o("ICA-T"), "ICA"); eq(o("tICA"), "ICA"); eq(o("Carotid terminus"), "ICA");
  eq(o("R M1"), "M1"); eq(o("LM1"), "M1"); eq(o("MCA M1/M2"), "M1"); eq(o("M2"), "M2"); eq(o("left M2 superior"), "M2");
  eq(o("M3"), "Distal/MeVO (M3/M4/ACA/PCA)"); eq(o("ACA"), "Distal/MeVO (M3/M4/ACA/PCA)"); eq(o("P2"), "Distal/MeVO (M3/M4/ACA/PCA)");
  eq(o("Basilar"), "Posterior (basilar/vertebral)"); eq(o("VA"), "Posterior (basilar/vertebral)"); eq(o("PICA"), "Posterior (basilar/vertebral)");
  eq(E.occCode("critical stenosis"), ["Other", true]); eq(E.occCode("Other"), ["Other", false]); eq(o("unknown"), null);
});
t("yes/no and IV thrombolysis words", () => {
  eq(E.yesNo("Y"), 1); eq(E.yesNo("yes"), 1); eq(E.yesNo("1"), 1); eq(E.yesNo("TRUE"), 1);
  eq(E.yesNo("Alteplase"), 1); eq(E.yesNo("tenecteplase (TNK)"), 1); eq(E.yesNo("IV tPA"), 1);
  eq(E.yesNo("N"), 0); eq(E.yesNo("0"), 0); eq(E.yesNo("false"), 0); eq(E.yesNo("none"), 0); eq(E.yesNo("no tPA"), 0);
  eq(E.yesNo(""), null); assert(Number.isNaN(E.yesNo("maybe")));
});
t("sex auto-map and value map", () => {
  eq(E.sexAuto("F"), "Female"); eq(E.sexAuto("male"), "Male"); eq(E.sexAuto("1"), undefined);
  eq(E.sexCode("2", { "2": "Female", "1": "Male" }), "Female"); eq(E.sexCode("1", { "2": "Female", "1": "Male" }), "Male");
});
t("suppressLevels: primary <11 plus complementary", () => {
  const s = E.suppressLevels({ A: 50, B: 5, C: 0 }, 55);
  eq(s.B.count, "<11"); eq(s.B.pct, null); eq(s.A.count, "suppressed"); eq(s.C.count, 0);
  const s2 = E.suppressLevels({ A: 40, B: 5, C: 3, D: 20 }, 68);          // two primaries: no complement needed
  eq(s2.B.count, "<11"); eq(s2.C.count, "<11"); eq(s2.A.count, 40); eq(s2.D.count, 20); eq(s2.D.pct, 29.4);
  const s3 = E.suppressLevels({ A: 11, B: 49 }, 60); eq(s3.A.count, 11); eq(s3.A.pct, 18.3);
});

// ---- synthetic 60-patient cohort -----------------------------------------------
const N = 60;
const fmtUS = t => { const d = new Date(t); return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + "/" + d.getUTCFullYear() +
  " " + d.getUTCHours() + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
const fmtISO = t => new Date(t).toISOString().slice(0, 19);
const fmtXL = t => String(t / 86400000 + 25569);
const fmts = [fmtUS, fmtISO, fmtXL];
const raceVals = [], expectLkn = [];
const rows = [];
for (let i = 0; i < N; i++) {
  const procT = U(2021, 2, 3) + Math.floor(i / (N - 1) * (U(2023, 11, 20) - U(2021, 2, 3)) / 60000) * 60000; // spans 2021-02 .. 2023-11
  let lknMin = ri(60, 900);
  if (i === 7 || i === 8) lknMin = -30;             // implausible (negative)
  if (i === 9) lknMin = 1440 * 8;                   // implausible (> 7 days)
  const lknT = procT - lknMin * 60000;
  const f = fmts[i % 3];
  let race = i < 30 ? "White" : i < 50 ? "Black" : i < 53 ? "Asian" : i < 57 ? "Martian" : "";
  const r = {
    MRN: "SYN" + i,
    "Age (yrs)": i < 5 ? "" : String(ri(30, 90)),
    Gender: i < 55 ? "F" : "M",
    Race: race,
    Ethnicity: i < 12 ? "Hispanic" : i < 50 ? "Not Hispanic" : "",
    "IV tPA": i % 2 ? "Alteplase" : "No",
    "Prior stroke": i % 4 === 0 ? "Y" : "N",
    "Occlusion site": ["L ICA", "R M1", "M2", "Basilar", "M3", "PCA"][i % 6],
    NIHSS: String(ri(2, 30)),
    "pre mRS": String(i % 3),
    Ambulatory: String(i % 5 === 0 ? 1 : 0),
    Cancer: i < 4 ? "1" : "0",                     // 4 -> "<11"
    Diabetes: i % 3 === 0 ? "1" : "0",
    Smoking: String(i % 3),
    TICI: ["2b", "3", "2a", "2c", "0"][i % 5],
    passes: i < 8 ? String(ri(1, 4)) : "",           // only 8 non-missing -> continuous suppressed
    mrs90: i === 59 ? "" : String(i % 7),
    died: i === 59 ? "1" : "0",
    "LKN": i === 10 ? "not a date" : f(lknT),
    "Groin puncture": f(procT),
    "Procedure date": i === 11 ? "" : fmtISO(procT).slice(0, 10)
  };
  rows.push(r);
  if (i !== 10) expectLkn.push(lknMin);
}
const map = {
  age: "Age (yrs)", nihss: "NIHSS", tici: "TICI", number_of_passes: "passes", hx_cancer: "Cancer", hx_dm2: "Diabetes",
  pre_stroke_ambulatory_status: "Ambulatory", mrs_pre_stroke: "pre mRS", hx_smoking: "Smoking", mrs_90day: "mrs90",
  mortality_hospital: "died", mrs_6month: null,
  sex: "Gender", race: "Race", ethnicity: "Ethnicity", iv_thrombolysis: "IV tPA", prior_stroke: "Prior stroke",
  occlusion_site: "Occlusion site", lkn_datetime: "LKN", puncture_datetime: "Groin puncture", lkn_to_puncture_min: null,
  procedure_date: "Procedure date",
  coding_choices: { ambulatory_yes_means: "dependent" }   // synthetic column uses 0/1 with 1 = dependent
};
const before = JSON.stringify(rows);
const C = E.cohortSummary(rows, map);
const V = C.variables;

console.log("cohortSummary (synthetic n=60)");
t("input rows are not mutated (TICI recode happens on a copy)", () => eq(JSON.stringify(rows), before));
t("n_patients and missing counts", () => {
  eq(C.n_patients, 60);
  eq(V.age.n, 55); eq(V.age.n_missing, 5);
  eq(V.race.n, 57); eq(V.race.n_missing, 3);
  eq(V.ethnicity.n, 50); eq(V.ethnicity.n_missing, 10);
});
t("small-cell suppression (<11) with complementary suppression", () => {
  eq(V.sex.levels.Male.count, "<11"); eq(V.sex.levels.Male.pct, null);
  eq(V.sex.levels.Female.count, "suppressed");                  // else 55 - Female = Male
  eq(V.sex.levels.Unknown.count, 0);
  eq(V.hx_cancer.levels.Yes.count, "<11"); eq(V.hx_cancer.levels.No.count, "suppressed");
  eq(V.race.levels.Asian.count, "<11"); eq(V.race.levels.Other.count, "<11");
  eq(V.race.levels.White.count, 30); eq(V.race.levels.White.pct, 52.6);
  eq(V.race.folded_into_other.patients, "<11"); eq(V.race.folded_into_other.distinct_values, 1);
});
t("continuous stats only when n >= 11", () => {
  eq(V.number_of_passes.n, 8); eq(V.number_of_passes.median, null); assert(V.number_of_passes.suppressed);
  eq(V.age.suppressed, false); assert(typeof V.age.median === "number" && typeof V.age.sd === "number");
  assert(V.age.q1 <= V.age.median && V.age.median <= V.age.q3);
});
t("LKN-to-puncture from mixed formats (US / ISO / Excel serial), implausible dropped", () => {
  const L = V.lkn_to_puncture_min;
  eq(L.source, "computed from LKN and puncture date/times");
  eq(L.n_unparseable, 1); eq(L.n_implausible_dropped, 3);
  const good = expectLkn.filter(m => m >= 0 && m <= 1440 * 7).sort((x, y) => x - y);
  eq(L.n, good.length); eq(L.n_missing, 60 - good.length);
  const mean = good.reduce((s, x) => s + x, 0) / good.length;
  assert(Math.abs(L.mean - Math.round(mean * 100) / 100) < 1e-9, "mean " + L.mean + " vs " + mean);
  const h = (good.length - 1) * 0.5, med = good[Math.floor(h)] + (h - Math.floor(h)) * (good[Math.ceil(h)] - good[Math.floor(h)]);
  eq(L.median, Math.round(med * 100) / 100);
});
t("precomputed lkn_to_puncture_min column takes precedence", () => {
  const rr = rows.map((r, i) => Object.assign({}, r, { L2P: i < 3 ? "-5" : String(100 + i) }));
  const c = E.cohortSummary(rr, Object.assign({}, map, { lkn_to_puncture_min: "L2P" }));
  eq(c.variables.lkn_to_puncture_min.source, "precomputed column");
  eq(c.variables.lkn_to_puncture_min.n_implausible_dropped, 3); eq(c.variables.lkn_to_puncture_min.n, 57);
});
t("enrollment window is month resolution only", () => {
  eq(C.enrollment_window, { first_month: "2021-02", last_month: "2023-11", source: "procedure_date" });
  const j = JSON.stringify(C);
  assert(!/\d{4}-\d{2}-\d{2}/.test(j), "a full date leaked into the summary");
  assert(!/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(j), "a US date leaked into the summary");
});
t("no patient-level content in the output", () => {
  const j = JSON.stringify(Object.assign({}, C, { coding: undefined }));   // coding = raw->code audit table, checked below
  assert(!/SYN\d/.test(j), "row ids leaked"); assert(!/Martian/.test(j), "raw race text leaked");
  (function walk(o) { if (Array.isArray(o)) assert(o.length < 11, "array of length " + o.length);
    if (o && typeof o === "object") Object.values(o).forEach(walk); })(Object.assign({}, C, { coding: undefined }));
  // the coding audit table lists distinct raw values and codes but never counts
  const cj = JSON.stringify(C.coding); assert(!/"(count|n|n_missing)":/.test(cj), "counts in coding record");
  assert(!/SYN\d/.test(cj), "id column leaked into coding record");
});
t("occlusion, IVT, prior stroke, smoking, TICI, outcome blocks", () => {
  eq(V.occlusion_site.levels.ICA.count, "<11"); eq(V.occlusion_site.levels.M1.count, "<11");   // 10 each -> suppressed
  eq(V.occlusion_site.levels["Distal/MeVO (M3/M4/ACA/PCA)"].count, 20);           // M3 + PCA
  eq(V.occlusion_site.levels.Other.count, 0);
  eq(V.iv_thrombolysis.levels.Yes.count, 30); eq(V.prior_stroke.levels.Yes.count, 15);
  eq(V.hx_smoking.levels.Never.count, 20); eq(V.hx_smoking.levels.Former.count, 20);
  eq(V.tici_ge_2b.levels.Yes.count, 36);                         // 2b, 3, 2c out of every 5
  eq(V.mrs_90day_0_2.n, 60);                                     // row 59 death-imputed as 6
  eq(V.mrs_90day_6.levels.Yes.count, "<11");                     // 9 deaths (8 coded + 1 imputed) -> suppressed
  eq(V.mrs_90day_6.levels.No.count, "suppressed");               // complement, else 60 - 51 = 9
  eq(V.mrs_90day_0_2.levels.Yes.count, 27);                      // i%7 in {0,1,2} over i=0..58: 9 each
});
t("pre-op score reuses RISK_SCORES (median/IQR/mean/SD and >= threshold)", () => {
  const sc = E.RISK_SCORES.find(s => s.key === "preop");
  const vals = rows.map(r => 2 * +r.NIHSS + 22 * +r.Cancer + 7 * +r.Diabetes + 7 * +r.Ambulatory + 6 * +r["pre mRS"] + 2 * +r.Smoking);
  eq(V.preop_score.n, 60);
  eq(V.preop_score.mean, Math.round(vals.reduce((s, x) => s + x, 0) / 60 * 100) / 100);
  const k = vals.filter(x => x >= sc.threshold_pts).length;
  const lv = V.preop_score_ge_threshold.levels.Yes;
  if (k >= 1 && k <= 10) eq(lv.count, "<11"); else if (60 - k >= 1 && 60 - k <= 10) eq(lv.count, "suppressed"); else eq(lv.count, k);
});
t("sex: numeric codes need a value map; unresolved counted as missing", () => {
  const rr = rows.map((r, i) => Object.assign({}, r, { Gender: i < 30 ? "2" : "1" }));
  const c0 = E.cohortSummary(rr, map);
  eq(c0.variables.sex.n, 0); eq(c0.variables.sex.n_unrecognized, 60);
  const c1 = E.cohortSummary(rr, Object.assign({}, map, { value_maps: { sex: { "2": "Female", "1": "Male" } } }));
  eq(c1.variables.sex.levels.Female.count, 30); eq(c1.variables.sex.levels.Male.pct, 50);
});
t("unmapped variables are reported as mapped:false", () => {
  const c = E.cohortSummary(rows, { age: "Age (yrs)" });
  eq(c.variables.race.mapped, false); eq(c.variables.preop_score.mapped, false); eq(c.enrollment_window.first_month, null);
});

console.log("Hispanic ethnicity always captured");
const hisRows = rows.map((r, i) => Object.assign({}, r, {
  Race: i < 12 ? "Hispanic" : i === 12 ? "White Hispanic" : i < 30 ? "White" : i < 45 ? "Black" : "Non-Hispanic White" }));
t("no ethnicity column: derived from race; race = Unknown/declined for Hispanic-only values", () => {
  const c = E.cohortSummary(hisRows, Object.assign({}, map, { ethnicity: null }));
  const eth = c.variables.ethnicity;
  assert(eth.mapped !== false, "ethnicity block missing");
  eq(eth.derived_from, "race column (no ethnicity column mapped)");
  eq(eth.n, 60); eq(eth.levels["Hispanic or Latino"].count, 13);
  eq(eth.levels["Not Hispanic or Latino"].count, 15);            // explicit "Non-Hispanic White"
  eq(eth.levels.Unknown.count, 32);                              // race given, ethnicity not stated
  eq(c.variables.race.levels["Unknown/declined"].count, 12);
  eq(c.variables.race.levels.White.count, 33);                   // 17 + 1 White Hispanic + 15 Non-Hispanic White
  eq(c.variables.race.levels.Other.count, 0);                    // Hispanic is NOT folded into Other
  eq(c.variables.race.hispanic_in_race_column, 13);
  assert(c.notes.some(n => /derived from the race column/.test(n)), "UI note missing");
  assert(c.notes.some(n => /Hispanic\/Latino/.test(n)), "race note missing");
});
t("ethnicity column present: race-column Hispanic fills blank/unknown ethnicity", () => {
  const rr = hisRows.map((r, i) => Object.assign({}, r, { Ethnicity: i < 13 ? "" : i < 25 ? "Unknown" : "Not Hispanic or Latino" }));
  const c = E.cohortSummary(rr, map);
  const eth = c.variables.ethnicity;
  eq(eth.derived_from, null); eq(eth.filled_from_race_column, 13);
  eq(eth.levels["Hispanic or Latino"].count, 13); eq(eth.levels.Unknown.count, 12);
  eq(eth.n, 60);
  assert(c.notes.some(n => /set to Hispanic or Latino because the race column/.test(n)));
});

console.log("export wrapper + mapping");
t("cohortSummaryExport shape", () => {
  const x = E.cohortSummaryExport(C, "Site\nB, test", "2026-10-15T00:00:00.000Z");
  eq(x.schema, "cohort_summary/v1"); eq(x.tool, "stroke-score-validator"); eq(x.site_label, "Site B  test");
  eq(x.n_patients, 60); assert(x.suppression_rule.includes("<11")); assert(x.variables.age);
});
t("suggestCohortMap: fuzzy-matches headers, one column per variable, skips score columns", () => {
  const hdr = Object.keys(rows[0]).concat(["LKN to puncture (min)"]);
  const sm = E.suggestMap(hdr);
  const cm = E.suggestCohortMap(hdr, Object.values(sm));
  eq(cm.sex, "Gender"); eq(cm.race, "Race"); eq(cm.ethnicity, "Ethnicity"); eq(cm.iv_thrombolysis, "IV tPA");
  eq(cm.prior_stroke, "Prior stroke"); eq(cm.occlusion_site, "Occlusion site"); eq(cm.procedure_date, "Procedure date");
  eq(cm.puncture_datetime, "Groin puncture"); eq(cm.lkn_datetime, "LKN"); eq(cm.lkn_to_puncture_min, "LKN to puncture (min)");
  const used = Object.values(cm).filter(Boolean); eq(new Set(used).size, used.length);
});


// ---- TICI coding per column ------------------------------------------------------
console.log("TICI coding (per column)");
const mkRows = (col, vals, extra) => vals.map((v, i) => Object.assign({ [col]: v }, extra ? extra(i) : {}));
const ticiCoded = (vals, scheme) => { const rr = mkRows("T", vals);
  const cd = E.resolveCoding(rr, { tici: "T", tici_scheme: scheme }); return { cd, codes: rr.map(r => E.codeOf(cd.vars.tici, r.T)) }; };
t("recodeTici requires a scheme (no per-value guessing)", () => {
  assert.throws(() => E.recodeTici("3"));
  eq(E.recodeTici("3", "mtici"), 5); eq(E.recodeTici("3", "study05"), 3);
  eq(E.recodeTici("2b", "study05"), undefined); eq(E.recodeTici("", "mtici"), null);
});
t("pure letter-grade column -> mTICI grades", () => {
  const { cd, codes } = ticiCoded(["0", "1", "2a", "2b", "2c", "3", "TICI 2b", "mTICI 2C"]);
  eq(cd.tici.scheme, "mtici"); eq(cd.tici.source, "auto-detected");
  eq(codes, [0, 1, 2, 3, 4, 5, 3, 4]);
});
t("numeric 0-3 column -> mTICI grades (3 -> 5)", () => {
  const { cd, codes } = ticiCoded(["0", "1", "3", "3", "1"]);
  eq(cd.tici.scheme, "mtici"); eq(codes, [0, 1, 5, 5, 1]);
});
t("numeric 0-5 column -> study 0-5 encoding (a 3 stays 3 = 2b)", () => {
  const { cd, codes } = ticiCoded(["0", "3", "4", "5", "2", "3.0"]);
  eq(cd.tici.scheme, "study05"); eq(codes, [0, 3, 4, 5, 2, 3]);
});
t("mixed column (letters + 4/5) is not guessed: needs a choice; override recorded", () => {
  const { cd, codes } = ticiCoded(["2b", "5", "3"]);
  eq(cd.tici.scheme, null); eq(cd.tici.source, "unresolved"); assert(cd.vars.tici.required.length === 1);
  eq(codes, [undefined, undefined, undefined]);
  const o = ticiCoded(["2b", "5", "3"], "study05");
  eq(o.cd.tici.source, "user override"); eq(o.codes, [undefined, 5, 3]);
  const R = E.runValidation(mkRows("T", ["2b", "5", "3"]), { tici: "T" }, null);
  eq(R.exceptions.filter(e => e.check === "coding").length, 3);
});
t("bare '2' under mTICI grades: missing, counted, flagged", () => {
  const { cd, codes } = ticiCoded(["2", "2b", "3", "2"]);
  eq(cd.tici.scheme, "mtici"); eq(codes, [undefined, 3, 5, undefined]);
  assert(/ambiguous/.test(cd.vars.tici.reasons["2"])); assert(cd.vars.tici.warnings.length === 1);
  const rr = Array.from({ length: 30 }, (_, i) => ({ T: ["2", "2b", "3"][i % 3] }));
  const c = E.cohortSummary(rr, { tici: "T" });
  eq(c.variables.tici_ge_2b.n, 20); eq(c.variables.tici_ge_2b.n_unrecognized, 10); eq(c.variables.tici_ge_2b.tici_scheme, "mtici");
});
t("peri score and both exports use the per-column scheme", () => {
  const base = i => ({ nihss: "10", age: "70", ca: "0", p: "1" });
  const m = { nihss: "nihss", age: "age", hx_cancer: "ca", number_of_passes: "p", tici: "T" };
  const r05 = mkRows("T", ["3", "4", "5"], base), rmt = mkRows("T", ["3", "2b", "2c"], base);
  const a = E.runValidation(r05, m, null), b = E.runValidation(rmt, m, null);
  eq(a.score.scores.peri.scoreArr[0], 20 + 70 + 2 - 7 * 3);        // 0-5 "3" = 2b
  eq(b.score.scores.peri.scoreArr[0], 20 + 70 + 2 - 7 * 5);        // mTICI "3" = 5
  eq(a.coding.tici.scheme, "study05"); eq(b.coding.tici.scheme, "mtici");
  const c = E.cohortSummary(r05, m); eq(c.coding.tici.scheme, "study05"); eq(c.coding.tici.source, "auto-detected");
  eq(c.variables.tici_ge_2b.levels.Yes.count, "<11");
  eq(JSON.stringify(r05[0]), JSON.stringify(Object.assign({ T: "3" }, base(0))));   // not mutated
});

// ---- explicit value coding ---------------------------------------------------------
console.log("explicit value coding");
const amb = (vals, choices, vmaps) => { const rr = mkRows("A", vals);
  const cd = E.resolveCoding(rr, { pre_stroke_ambulatory_status: "A", coding_choices: choices, value_maps: vmaps });
  return { cv: cd.vars.pre_stroke_ambulatory_status, codes: rr.map(r => E.codeOf(cd.vars.pre_stroke_ambulatory_status, r.A)) }; };
t("ambulatory 0/1 or yes/no: no silent default, direction required", () => {
  const x = amb(["0", "1", "Yes", "No"]);
  eq(x.codes, [undefined, undefined, undefined, undefined]); assert(x.cv.required.length === 1);
});
t("ambulatory direction: 1/Yes = independent flips to study coding", () => {
  const x = amb(["0", "1", "Yes", "No"], { ambulatory_yes_means: "independent" });
  eq(x.codes, [1, 0, 0, 1]); eq(x.cv.required.length, 0); eq(x.cv.choice.yes_or_1_means, "independent / ambulatory");
  const y = amb(["0", "1"], { ambulatory_yes_means: "dependent" }); eq(y.codes, [0, 1]);
});
t("ambulatory text mapped by meaning, no question needed", () => {
  const x = amb(["Independent", "Wheelchair", "needs assistance", "walks with walker", "Ambulatory", "Bedbound", "Non-ambulatory", "walks without assistance"]);
  eq(x.codes, [0, 1, 1, 1, 0, 1, 1, 0]); eq(x.cv.required.length, 0);
});
t("per-value override and 'treat as missing'", () => {
  const x = amb(["0", "1", "unk"], { ambulatory_yes_means: "dependent" }, { pre_stroke_ambulatory_status: { "1": "0", "unk": E.MISSING_CODE } });
  eq(x.codes, [0, 0, null]);
});
const smk = (vals, choices) => { const rr = mkRows("S", vals);
  const cd = E.resolveCoding(rr, { hx_smoking: "S", coding_choices: choices });
  return { cv: cd.vars.hx_smoking, codes: rr.map(r => E.codeOf(cd.vars.hx_smoking, r.S)), cd }; };
t("binary smoking (yes/no): warning + required choice; 'ever' recorded", () => {
  const x = smk(["Yes", "No", "yes"]);
  assert(x.cv.binary); assert(/former smokers/.test(x.cv.warnings[0])); assert(x.cv.required.length === 1);
  eq(x.codes, [undefined, 0, undefined]);
  const y = smk(["Yes", "No"], { smoking_yes_means: "ever" });
  eq(y.codes, [1, 0]); eq(y.cv.required.length, 0);
  const rec = E.codingRecord(y.cd).variables.hx_smoking;
  eq(rec.choice.yes_or_1_means, "ever smoker (current or former)"); assert(/2 points/.test(rec.warnings[0]));
});
t("binary smoking (0/1 numeric) is also flagged; 0/1/2 and text are not", () => {
  const x = smk(["0", "1"]); assert(x.cv.binary); eq(x.codes, [0, undefined]);
  eq(smk(["0", "1"], { smoking_yes_means: "current" }).codes, [0, 1]);
  const z = smk(["0", "1", "2"]); assert(!z.cv.binary); eq(z.codes, [0, 1, 2]);
  const w = smk(["Never", "Current smoker", "Former smoker", "Ex-smoker"]); assert(!w.cv.binary); eq(w.codes, [0, 1, 2, 2]);
});
t("mRS text -> integer; out-of-range is unassigned (missing + exception), never 0", () => {
  const rr = mkRows("M", ["mRS 3", "0", "6", "Dead", "7", "3 - moderate disability", "x"]);
  const cd = E.resolveCoding(rr, { mrs_90day: "M" });
  eq(rr.map(r => E.codeOf(cd.vars.mrs_90day, r.M)), [3, 0, 6, 6, undefined, 3, undefined]);
  const R = E.runValidation(rr, { mrs_90day: "M" }, null);
  eq(R.exceptions.filter(e => e.check === "coding").map(e => e.value), ["7", "x"]);
});
t("unrecognised binary values -> missing and counted, never 0", () => {
  const rr = Array.from({ length: 40 }, (_, i) => ({ C: i < 12 ? "maybe" : i % 2 ? "Y" : "N" }));
  const c = E.cohortSummary(rr, { hx_cancer: "C" });
  eq(c.variables.hx_cancer.n, 28); eq(c.variables.hx_cancer.n_unrecognized, 12); eq(c.variables.hx_cancer.levels.No.count, 14);
  const tab = c.coding.variables.hx_cancer.table; eq(tab.find(r => r.raw === "maybe").how, "no code (missing)");
});


// ---- file / header handling --------------------------------------------------------
console.log("file and header handling");
t("delimiter: comma, tab and semicolon", () => {
  eq(E.parseDelimited("a,b\n1,2\n").headers, ["a", "b"]);
  eq(E.parseDelimited("a\tb\n1\t2\n").headers, ["a", "b"]);
  const T = E.parseDelimited("age;LKN to puncture (min)\n70;214,5\n");
  eq(T.headers, ["age", "LKN to puncture (min)"]); eq(T.rows[0]["LKN to puncture (min)"], "214,5");
  eq(E.parseDelimited('"x, y";z\n1;2\n').headers, ["x, y", "z"]);          // comma inside quotes is not the delimiter
});
t("decimal comma vs thousands separator", () => {
  eq(E.pnum("214,5"), 214.5); eq(E.pnum("0,75"), 0.75); eq(E.pnum("1,234"), 1234); eq(E.pnum("12"), 12);
});
t("duplicate / blank headers are renamed, not overwritten", () => {
  const T = E.tableFromGrid([["Age", "NIHSS", "Age", ""], ["60", "10", "61", "x"]]);
  eq(T.headers, ["Age", "NIHSS", "Age (2)", "Column 4"]); eq(T.rows[0]["Age (2)"], "61");
  assert(/Duplicate/.test(T.warnings[0]));
});
t("header-less sheet is flagged", () => {
  assert(E.tableFromGrid([["67", "12", "2b", "1"], ["71", "20", "3", "2"]]).warnings.some(w => /looks like data/.test(w)));
  eq(E.tableFromGrid([["Age", "NIHSS"], ["67", "12"]]).warnings, []);
});
t("date order decided per column; ambiguous / contradictory -> ask", () => {
  eq(E.detectDateOrder(["05/03/2023", "25/03/2023"]).order, "DM");
  eq(E.detectDateOrder(["3/5/2023 10:00", "3/25/2023 11:00"]).order, "MD");
  eq(E.detectDateOrder(["3/5/2023", "4/6/2023"]).order, null);
  eq(E.detectDateOrder(["13/1/2023", "1/13/2023"]).order, null);
  eq(E.detectDateOrder(["2023-03-05", "45000"]).n_slash, 0);
  const rr = [{ P: "05/03/2023" }, { P: "25/03/2023" }, { P: "11/04/2023" }];
  const c = E.cohortSummary(rr, { procedure_date: "P" });
  eq(c.enrollment_window.first_month, "2023-03"); eq(c.enrollment_window.last_month, "2023-04");   // 11/04 = 11 April, not 4 Nov
  const amb = [{ P: "3/5/2023" }, { P: "4/6/2023" }];
  assert(E.resolveCoding(amb, { procedure_date: "P" }).vars.procedure_date.required.length === 1, "ambiguous dates must be asked");
  const c2 = E.cohortSummary(amb, { procedure_date: "P", date_orders: { procedure_date: "DM" } });
  eq(c2.enrollment_window.first_month, "2023-05"); eq(c2.coding.variables.procedure_date.source, "user choice");
});
t("short generic headers are not grabbed (Time, Location, Date)", () => {
  const hdr = ["Time", "Location", "Date", "Notes", "MRN"];
  const sm = E.suggestMap(hdr), cm = E.suggestCohortMap(hdr, Object.values(sm));
  eq(Object.values(sm).filter(Boolean), []); eq(Object.values(cm).filter(Boolean), []);
  eq(E.suggestCohortMap(["Occlusion location", "Location"], []).occlusion_site, "Occlusion location");
  eq(E.suggestMap(["Pre-morbid mRS"]).mrs_pre_stroke, "Pre-morbid mRS");
});
t("numeric race / occlusion codes are not guessed", () => {
  eq(E.raceCode("5")[0], undefined); eq(E.occCode("2")[0], undefined);
  const cd = E.resolveCoding([{ R: "5" }, { R: "White" }], { race: "R" });
  eq(cd.vars.race.final["5"], undefined); eq(cd.vars.race.final["white"], "White");
});
t("'unknown' / 'UNK' / 'N/A' in coded columns -> missing (not an error)", () => {
  const cd = E.resolveCoding([{ C: "unknown" }, { C: "UNK" }, { C: "Yes" }], { hx_cancer: "C" });
  eq(cd.vars.hx_cancer.final["unknown"], null); eq(cd.vars.hx_cancer.final["unk"], null); eq(cd.vars.hx_cancer.final["yes"], 1);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
