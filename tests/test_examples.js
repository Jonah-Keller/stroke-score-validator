// End-to-end check of validator.html on the SYNTHETIC example sheets in examples/.
// For each sheet: load the file into the real page (jsdom) -> compare the automatic
// column mapping with examples/expected/<name>.json -> do only what a real person
// would have to do (fix wrong guesses in the dropdowns, answer required questions,
// code values the tool cannot know) -> Validate & Score -> compare both exports with
// the known answers computed by examples/make_examples.py.
//
// Needs jsdom:  (cd tests && npm install)   then   node tests/test_examples.js
"use strict";
const fs = require("fs"), path = require("path");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) { console.error("jsdom not found: run `cd tests && npm install` (or set NODE_PATH)"); process.exit(2); }

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "validator.html"), "utf8");
const EX = path.join(ROOT, "examples"), EXP = path.join(EX, "expected");
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const report = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log("    FAIL " + msg); } }

// ---- page with the few browser APIs jsdom lacks --------------------------------
function openPage() {
  const errors = [], downloads = {};
  const vc = new (require("jsdom").VirtualConsole)();
  vc.on("jsdomError", e => errors.push(String(e.message || e) + (e.detail ? " :: " + (e.detail.stack || e.detail).toString().split("\n").slice(0, 3).join(" | ") : "")));
  const dom = new JSDOM(HTML, { runScripts: "dangerously", virtualConsole: vc, beforeParse(w) {
    w.onerror = m => errors.push(String(m));
    w.addEventListener("error", e => errors.push(String(e.message || e)));
    const NodeBlob = globalThis.Blob, Orig = w.Blob;
    class B extends Orig { constructor(parts, opts) { super(parts, opts); this.__parts = parts; }
      stream() { return new NodeBlob(this.__parts).stream(); } }
    w.Blob = B;
    w.DecompressionStream = globalThis.DecompressionStream; w.Response = globalThis.Response; w.TextDecoder = globalThis.TextDecoder;
    const asBuf = blob => new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsArrayBuffer(blob); });
    const asTxt = blob => new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); });
    w.File.prototype.arrayBuffer = function () { return asBuf(this); };
    w.File.prototype.text = function () { return asTxt(this); };
    w.URL.createObjectURL = b => { w.__last = b; return "blob:x"; }; w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads[this.download] = w.__last; };
    w.HTMLElement.prototype.scrollIntoView = () => {};
  } });
  return { w: dom.window, d: dom.window.document, errors, downloads };
}
async function loadFile(P, name, bytes) {
  const { w, d } = P;
  const file = new w.File([new Uint8Array(bytes)], name);
  const input = d.querySelector("#file"); Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  for (let k = 0; k < 200; k++) {
    if (!d.querySelector("#mapper").classList.contains("hidden")) return true;
    if (d.querySelector("#loadmsg .err")) return false;
    await sleep(10);
  }
  return false;
}
const VARS = P => [...P.d.querySelectorAll("#maprows select[id^='sel_'], #cohortrows select[id^='csel_']")]
  .map(s => [s.id.replace(/^c?sel_/, ""), s]);
function setSel(P, s, v) { s.value = v; s.dispatchEvent(new P.w.Event("change")); }
const q = (P, sel) => P.d.querySelector(sel);
const jsonOf = blob => JSON.parse(blob.__parts.join(""));
function required(P) {     // variable names that currently show a required question
  return [...P.d.querySelectorAll(".vmap")].filter(b => b.querySelector(".err")).map(b => b.id.replace(/^vm_/, ""));
}
function applyActions(P, a) {
  if (a.tici_scheme) setSel(P, q(P, ".vmq[data-q='tici_scheme']"), a.tici_scheme);
  for (const [k, v] of Object.entries(a.choices || {})) { const s = q(P, ".vmq[data-q='" + k + "']");
    ok(!!s, "question " + k + " shown"); if (s) setSel(P, s, v); }
  for (const [nm, m] of Object.entries(a.value_codes || {})) for (const [raw, code] of Object.entries(m)) {
    const s = q(P, ".vmsel[data-var='" + nm + "'][data-k='" + raw + "']");
    ok(!!s, "value dropdown " + nm + "=" + raw); if (s) setSel(P, s, code); }
}
async function runAndExport(P, anyway) {
  const res = q(P, "#results"); const stale = P.d.createElement("i"); stale.id = "staleMarker"; res.appendChild(stale);
  q(P, "#run").click(); await sleep(5);
  if (anyway && q(P, "#runAnyway")) { q(P, "#runAnyway").click(); await sleep(5); }
  if (q(P, "#staleMarker") || !q(P, "#dlCohort")) { const m = q(P, "#staleMarker"); if (m) m.remove(); return null; }   // not re-rendered
  q(P, "#dlCohort").click(); q(P, "#dlResearch").click();
  return { cs: jsonOf(P.downloads["cohort_summary.json"]), ve: jsonOf(P.downloads["validation_export.json"]) };
}
// compare an exported count with the truth, honouring small-cell suppression
function sameCount(exp, truth) {
  if (exp === "<11") return truth >= 1 && truth <= 10;
  if (exp === "suppressed") return truth >= 11;
  return exp === truth;
}
const CHECKS = {
  n_patients: c => c.cs.n_patients,
  nihss_median: c => c.cs.variables.nihss.median, age_median: c => c.cs.variables.age.median, age_n: c => c.cs.variables.age.n,
  mrs90_n: c => c.cs.variables.mrs_90day_0_2.n, mrs90_0_2: c => c.cs.variables.mrs_90day_0_2.levels.Yes.count,
  mrs90_6: c => c.cs.variables.mrs_90day_6.levels.Yes.count,
  tici_n: c => c.cs.variables.tici_ge_2b.n, tici_ge_2b: c => c.cs.variables.tici_ge_2b.levels.Yes.count,
  female: c => c.cs.variables.sex.levels.Female.count,
  race_white: c => c.cs.variables.race.levels.White.count,
  race_black: c => c.cs.variables.race.levels["Black or African American"].count,
  hispanic: c => c.cs.variables.ethnicity.levels["Hispanic or Latino"].count,
  ivt_yes: c => c.cs.variables.iv_thrombolysis.levels.Yes.count, occ_m1: c => c.cs.variables.occlusion_site.levels.M1.count,
  nonambulatory: c => c.cs.variables.pre_stroke_ambulatory_status.levels.Yes.count,
  smoke_never: c => c.cs.variables.hx_smoking.levels.Never.count, smoke_current: c => c.cs.variables.hx_smoking.levels.Current.count,
  smoke_former: c => c.cs.variables.hx_smoking.levels.Former.count,
  l2p_median: c => c.cs.variables.lkn_to_puncture_min.median, l2p_implausible: c => c.cs.variables.lkn_to_puncture_min.n_implausible_dropped,
  first_month: c => c.cs.enrollment_window.first_month, last_month: c => c.cs.enrollment_window.last_month,
  peri_n_scored: c => c.ve.scores.peri.summary.n_scored, preop_n_scored: c => c.ve.scores.preop.summary.n_scored,
  preop_median: c => c.cs.variables.preop_score.median, preop_ge_42: c => c.cs.variables.preop_score_ge_threshold.levels.Yes.count,
};
const MEDIANS = new Set(["nihss_median", "age_median", "l2p_median", "preop_median"]);

async function runExample(E) {
  console.log("\n== " + E.file);
  const P = openPage();
  const okLoad = await loadFile(P, E.file, fs.readFileSync(path.join(EX, E.file)));
  ok(okLoad, E.file + " loads"); if (!okLoad) { console.log("    " + q(P, "#loadmsg").textContent); return; }
  if (E.sheets) { const s = q(P, "#sheetsel"); ok(!!s, "sheet picker shown");
    if (s) { ok(s.value === E.user_actions.sheet, "default sheet = " + E.user_actions.sheet + " (got " + s.value + ")"); } }
  // 1. automatic column mapping
  const auto = {}, right = [], wrong = [], missed = [], extra = [];
  for (const [v, s] of VARS(P)) auto[v] = s.value || null;
  for (const [v, s] of VARS(P)) { const want = E.mapping[v] || null, got = auto[v];
    if (want && got === want) right.push(v);
    else if (want && !got) missed.push(v);
    else if (want && got !== want) wrong.push(v + " (picked '" + got + "')");
    else if (!want && got) extra.push(v + " (picked '" + got + "')"); }
  for (const bad of E.must_not_map || []) ok(!Object.values(auto).includes(bad), "decoy column '" + bad + "' not auto-mapped");
  // fix what the tool got wrong, as a person would via the dropdowns
  for (const [v, s] of VARS(P)) { const want = E.mapping[v] || ""; if ((s.value || "") !== want) setSel(P, s, want); }
  // 2. questions the tool raises
  const prompts = required(P);
  ok(JSON.stringify(prompts.slice().sort()) === JSON.stringify(E.prompts.slice().sort()),
     "prompts " + JSON.stringify(prompts) + " == expected " + JSON.stringify(E.prompts));
  // the run is blocked while a question is open
  if (prompts.length) { q(P, "#run").click(); ok(!q(P, "#dlCohort") && /answer/i.test(q(P, "#runmsg").textContent), "run blocked until questions answered"); }
  // values the tool could not code (shown red) = what the person must code by hand
  const needCodes = [...P.d.querySelectorAll(".vmsel")].filter(s => s.value === "" && !prompts.includes(s.getAttribute("data-var")))
    .map(s => s.getAttribute("data-var") + "=" + s.getAttribute("data-k"));
  const planned = Object.entries(E.user_actions.value_codes || {}).flatMap(([v, m]) => Object.keys(m).map(k => v + "=" + k));
  ok(JSON.stringify(needCodes.slice().sort()) === JSON.stringify(planned.slice().sort()),
     "values needing a hand code " + JSON.stringify(needCodes) + " == expected " + JSON.stringify(planned));
  applyActions(P, E.user_actions);
  ok(required(P).length === 0, "no open questions after user actions (left: " + required(P) + ")");
  const unassigned = [...P.d.querySelectorAll(".vmsel")].filter(s => s.value === "").map(s => s.getAttribute("data-var") + "=" + s.getAttribute("data-k"));
  // 3. score + export, compare with truth
  const out = await runAndExport(P);
  ok(!!out, "results rendered" + (out ? "" : " :: " + P.errors.join("; "))); if (!out) return;
  const mism = [];
  if (E.tici_scheme) { const t1 = out.ve.coding.tici && out.ve.coding.tici.scheme, t2 = out.cs.coding.tici && out.cs.coding.tici.scheme;
    ok(t1 === E.tici_scheme && t2 === E.tici_scheme, "TICI scheme " + E.tici_scheme + " in both exports (got " + t1 + ")"); }
  for (const [k, truth] of Object.entries(E.checks)) {
    let got; try { got = CHECKS[k](out); } catch (e) { got = "ERR " + e.message; }
    const good = MEDIANS.has(k) ? got === truth : (typeof truth === "number" ? sameCount(got, truth) : got === truth);
    if (!good) mism.push(k + ": exported " + JSON.stringify(got) + ", truth " + JSON.stringify(truth));
  }
  ok(mism.length === 0, "exports match truth" + (mism.length ? ":\n      " + mism.join("\n      ") : ""));
  ok(P.errors.length === 0, "no JS errors " + P.errors.join("; "));
  report.push({ file: E.file, auto_ok: right.length + "/" + Object.keys(E.mapping).length,
    manual: [].concat(missed.map(m => m + " (not found)"), wrong, extra.map(x => "cleared " + x)),
    prompts, needCodes, unassigned_after: unassigned, match: mism.length === 0 });
  return P;
}

// ---- correction workflow: Edit mapping -> change -> re-run, Save/Load mapping ----
async function editAndRerun(E) {
  console.log("\n== edit mapping + re-run (" + E.file + ")");
  const P = openPage();
  await loadFile(P, E.file, fs.readFileSync(path.join(EX, E.file)));
  for (const [v, s] of VARS(P)) { const want = E.mapping[v] || ""; if ((s.value || "") !== want) setSel(P, s, want); }
  applyActions(P, E.user_actions);
  const a = await runAndExport(P);
  ok(q(P, "#editMap") !== null, "Edit mapping button present");
  q(P, "#editMap").click();
  ok(!q(P, "#mapper").classList.contains("hidden"), "mapper visible after Edit mapping");
  // choices are preserved
  ok(q(P, ".vmq[data-q='ambulatory_yes_means']").value === E.user_actions.choices.ambulatory_yes_means, "prompt answer preserved");
  ok(q(P, ".vmsel[data-var='sex'][data-k='1']").value === "Male", "per-value code preserved");
  // change: drop IV thrombolysis, flip one race code, override the TICI scheme
  setSel(P, q(P, "#csel_iv_thrombolysis"), "");
  setSel(P, q(P, ".vmsel[data-var='race'][data-k='6']"), "__missing");
  const b = await runAndExport(P);
  ok(b.cs.variables.iv_thrombolysis.mapped === false, "cleared column is not in the new export");
  ok(b.cs.variables.race.n < a.cs.variables.race.n && b.cs.variables.race.levels.Other.count === 0, "race value set to missing reduces race n");
  ok(b.cs.variables.tici_ge_2b.levels.Yes.count === a.cs.variables.tici_ge_2b.levels.Yes.count, "re-run does not re-recode TICI");
  ok(b.ve.scores.peri.summary.n_scored === a.ve.scores.peri.summary.n_scored, "peri n_scored stable across re-runs");
  // a third run with nothing changed is identical
  const c = await runAndExport(P);
  ok(JSON.stringify(Object.assign({}, c.cs, { exported_at: 0 })) === JSON.stringify(Object.assign({}, b.cs, { exported_at: 0 })), "identical re-run gives identical export");
  // override the TICI scheme -> recorded as user override
  setSel(P, q(P, ".vmq[data-q='tici_scheme']"), "study05");
  ok((await runAndExport(P)) === null && /no code yet/.test(q(P, "#runmsg").textContent) && /tici/.test(q(P, "#runmsg").textContent),
     "override to 0-5 on a letter-grade column: letters listed as uncoded before scoring");
  const d2 = await runAndExport(P, true);
  ok(d2 && d2.ve.coding.tici.source === "user override" && d2.cs.coding.tici.scheme === "study05", "TICI override recorded in both exports");
  ok(d2 && d2.cs.variables.tici_ge_2b.n < b.cs.variables.tici_ge_2b.n, "letter grades not coded under 0-5 are missing, not guessed");
  // Save mapping -> new page -> Load mapping -> same result as run b
  setSel(P, q(P, ".vmq[data-q='tici_scheme']"), "");
  q(P, "#saveMap").click();
  const saved = jsonOf(P.downloads["column_mapping.json"]);
  ok(saved.schema === "column_mapping/v1" && !JSON.stringify(saved).includes("SYN-"), "saved mapping has settings only (no data rows)");
  const P2 = openPage();
  await loadFile(P2, E.file, fs.readFileSync(path.join(EX, E.file)));
  const mf = new P2.w.File([JSON.stringify(saved)], "column_mapping.json");
  const mi = q(P2, "#loadMapFile"); Object.defineProperty(mi, "files", { value: [mf], configurable: true });
  mi.dispatchEvent(new P2.w.Event("change")); await sleep(50);
  ok(required(P2).length === 0, "loaded mapping answers every question");
  const e2 = await runAndExport(P2);
  ok(JSON.stringify(Object.assign({}, e2.cs, { exported_at: 0 })) === JSON.stringify(Object.assign({}, b.cs, { exported_at: 0 })), "Load mapping reproduces the edited export");
}

// ---- values without a code are asked about, never guessed ------------------------------
async function uncodedPrompt(E) {
  console.log("\n== uncoded values prompt (" + E.file + ")");
  const P = openPage();
  await loadFile(P, E.file, fs.readFileSync(path.join(EX, E.file)));
  for (const [v, s] of VARS(P)) { const want = E.mapping[v] || ""; if ((s.value || "") !== want) setSel(P, s, want); }
  applyActions(P, { choices: E.user_actions.choices });        // answer questions but leave sex/race codes blank
  q(P, "#run").click(); await sleep(5);
  const msg = q(P, "#runmsg").textContent;
  ok(!q(P, "#dlCohort") && /no code yet/.test(msg) && /sex/.test(msg) && /race/.test(msg), "scoring paused and uncoded sex/race values listed");
  ok(!!q(P, "#runAnyway"), "'Score anyway' offered");
  q(P, "#runAnyway").click(); await sleep(5);
  ok(!!q(P, "#dlCohort"), "Score anyway runs");
  q(P, "#dlCohort").click(); const cs = jsonOf(P.downloads["cohort_summary.json"]);
  ok(cs.variables.sex.n === 0 && cs.variables.sex.n_unrecognized === 80, "uncoded sex counted as missing, not guessed");
  ok(cs.variables.race.n === 0 && cs.variables.race.levels.Other.count === 0, "numeric race codes not folded into Other");
}

// ---- file-level messages -------------------------------------------------------------
async function fileMessages() {
  console.log("\n== file-level messages");
  const xls = JSON.parse(fs.readFileSync(path.join(EXP, "registry_style_xls.json"), "utf8"));
  let P = openPage();
  ok(!(await loadFile(P, xls.file, fs.readFileSync(path.join(EX, xls.file)))), ".xls not loaded");
  ok(/\.xls/.test(q(P, "#loadmsg").textContent) && /re-save|save it as/i.test(q(P, "#loadmsg").textContent), ".xls -> clear re-save message: " + q(P, "#loadmsg").textContent.slice(0, 90));
  P = openPage(); ok(!(await loadFile(P, "empty.csv", Buffer.from(""))), "empty file rejected");
  ok(/empty/i.test(q(P, "#loadmsg").textContent), "empty file message: " + q(P, "#loadmsg").textContent.slice(0, 80));
  P = openPage(); ok(!(await loadFile(P, "header_only.csv", Buffer.from("age,nihss\n"))), "header-only file rejected");
  ok(/no data rows/i.test(q(P, "#loadmsg").textContent), "header-only message: " + q(P, "#loadmsg").textContent.slice(0, 80));
  P = openPage(); await loadFile(P, "headerless.csv", Buffer.from("67,12,2b,1,0\n71,20,3,2,1\n55,8,2c,1,0\n"));
  ok(/first row looks like data/i.test(q(P, "#loadmsg").textContent), "header-less warning: " + q(P, "#loadmsg").textContent.slice(0, 90));
  P = openPage(); await loadFile(P, "ambiguous_dates.csv", Buffer.from("NIHSS,cancer,mRS90,Procedure date\n10,0,2,3/5/2023\n12,1,4,4/6/2023\n"));
  ok(!!q(P, ".vmq[data-q='date_order:procedure_date']") && required(P).includes("procedure_date"), "ambiguous date column asks M/D or D/M");
  q(P, "#run").click(); ok(/M\/D\/YYYY/.test(q(P, "#runmsg").textContent), "run paused until the date order is chosen");
  setSel(P, q(P, ".vmq[data-q='date_order:procedure_date']"), "DM"); ok(required(P).length === 0, "answering the date order clears the question");
  P = openPage(); await loadFile(P, "dupes.csv", Buffer.from("Age,NIHSS,Age\n60,10,61\n70,12,71\n"));
  ok(/duplicate/i.test(q(P, "#loadmsg").textContent), "duplicate header warning: " + q(P, "#loadmsg").textContent.slice(0, 90));
  ok([...q(P, "#sel_age").options].map(o => o.value).includes("Age (2)"), "duplicate header renamed 'Age (2)'");
}

(async () => {
  const files = fs.readdirSync(EXP).filter(f => f.endsWith(".json")).sort();
  const cases = files.map(f => JSON.parse(fs.readFileSync(path.join(EXP, f), "utf8"))).filter(E => !E.expect_error);
  for (const E of cases) await runExample(E);
  await editAndRerun(cases.find(E => E.file === "messy_export.csv"));
  await uncodedPrompt(cases.find(E => E.file === "messy_export.csv"));
  await fileMessages();
  console.log("\nPer-example summary");
  for (const r of report) console.log("  " + r.file.padEnd(24) + " auto-mapped " + r.auto_ok.padEnd(6) +
    " manual: " + (r.manual.length ? r.manual.join("; ") : "none") + " | prompts: " + (r.prompts.length ? r.prompts.join(", ") : "none") +
    " | values coded by hand: " + (r.needCodes.length ? r.needCodes.join(", ") : "none") +
    " | uncoded left: " + (r.unassigned_after.length ? r.unassigned_after.join(", ") : "none") + " | exports match truth: " + (r.match ? "yes" : "NO"));
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
