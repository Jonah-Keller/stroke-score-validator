#!/usr/bin/env python3
"""Build a validation figure from the validator's de-identified export(s).

Input : one or more `validation_export.json` files from validator.html
        ("⬇ Researcher export (de-identified)"). NO PHI — only per-patient
        (score, prediction, observed outcome) for each score + summary metrics.
Output: validation_figure_<score>.png / .pdf  (ROC, score distribution, 2x2, metrics)

Usage : pip install numpy matplotlib
        python make_validation_figure.py export1.json [export2.json ...]
        python make_validation_figure.py --score peri  export*.json
        python make_validation_figure.py --by-site export*.json
"""
import sys, json, argparse
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

def load(paths, score):
    sites=[]
    for p in paths:
        d=json.load(open(p))
        # v2 (both scores) or v1 (single) fallback
        if d.get("schema","").startswith("validation_export/v2"):
            sc=d["scores"].get(score) or d["scores"][list(d["scores"])[0]]
            skey=score+"_score"
            rows=[r for r in d.get("rows",[]) if r.get("observed") in ("poor","good") and r.get(skey) not in (None,"")]
            val=np.array([float(r[skey]) for r in rows],float)
            thr=sc["threshold_pts"]; ref=sc.get("ref_auc"); label=sc.get("label",score)
        else:  # v1
            rows=[r for r in d.get("rows",[]) if r.get("observed") in ("poor","good") and r.get("risk_score") not in (None,"")]
            val=np.array([float(r["risk_score"]) for r in rows],float)
            thr=d["score"]["threshold_pts"]; ref=d["score"].get("ref_auc"); label=score
        poor=np.array([r["observed"]=="poor" for r in rows],bool)
        sites.append(dict(label=d.get("site_label") or p.split("/")[-1],
                          score=val, poor=poor, thr=thr, ref=ref, sclabel=label))
    return sites

def auc_roc(score, poor):
    P=poor.sum(); N=(~poor).sum()
    if P==0 or N==0: return float("nan"), np.array([[0,0],[1,1]])
    order=np.argsort(-score,kind="mergesort"); s=score[order]; y=poor[order]
    tp=fp=0; pts=[(0,0)]; prev=None
    for si,yi in zip(s,y):
        if prev is not None and si!=prev: pts.append((fp/N,tp/P))
        if yi: tp+=1
        else: fp+=1
        prev=si
    pts.append((fp/N,tp/P)); pts.append((1,1))
    o=np.argsort(score,kind="mergesort"); rr=np.empty(len(score)); i=0; sv=score[o]
    while i<len(sv):
        j=i
        while j+1<len(sv) and sv[j+1]==sv[i]: j+=1
        rr[o[i:j+1]]=(i+1+j+1)/2; i=j+1
    a=(rr[poor].sum()-P*(P+1)/2)/(P*N)
    return a, np.array(pts)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--score", default="preop", choices=["preop","peri"])
    ap.add_argument("--by-site", action="store_true")
    ap.add_argument("--out", default=None)
    a=ap.parse_args()
    sites=load(a.files, a.score)
    score=np.concatenate([s["score"] for s in sites]); poor=np.concatenate([s["poor"] for s in sites])
    thr=sites[0]["thr"]; ref=sites[0]["ref"]; sclabel=sites[0]["sclabel"]
    good=~poor; auc,roc=auc_roc(score,poor)
    pp=score>=thr
    tp=int((pp&poor).sum()); fp=int((pp&good).sum()); fn=int((~pp&poor).sum()); tn=int((~pp&good).sum())
    sens=tp/(tp+fn) if (tp+fn) else float("nan"); spec=tn/(tn+fp) if (tn+fp) else float("nan")
    ppv=tp/(tp+fp) if (tp+fp) else float("nan"); npv=tn/(tn+fn) if (tn+fn) else float("nan")

    fig,ax=plt.subplots(2,2,figsize=(11,9))
    fig.suptitle(f"External validation — {sclabel}", fontsize=15, fontweight="bold")
    # (A) ROC
    a0=ax[0,0]; a0.plot([0,1],[0,1],"--",color="#bbb",lw=1)
    a0.plot(roc[:,0],roc[:,1],color="#1565c0",lw=2.2,label=f"external AUC {auc:.3f}")
    if a.by_site and len(sites)>1:
        for s in sites:
            au,rc=auc_roc(s["score"],s["poor"]); a0.plot(rc[:,0],rc[:,1],lw=1,alpha=.6,label=f"{s['label']} ({au:.2f})")
    if ref: a0.plot([],[]," ",label=f"derivation ref {ref:.3f}")
    a0.set_xlabel("1 − specificity"); a0.set_ylabel("sensitivity (poor)"); a0.set_title("ROC"); a0.legend(fontsize=9,loc="lower right")
    # (B) score distribution by outcome
    a1=ax[0,1]; bins=np.linspace(score.min(),score.max(),24)
    a1.hist(score[good],bins=bins,alpha=.6,label="good",color="#2e7d32")
    a1.hist(score[poor],bins=bins,alpha=.6,label="poor",color="#c62828")
    a1.axvline(thr,color="#111",ls="--",lw=1.5,label=f"threshold {thr}")
    a1.set_xlabel("risk score"); a1.set_ylabel("patients"); a1.set_title("Score distribution by outcome"); a1.legend(fontsize=9)
    # (C) confusion heatmap
    a2=ax[1,0]; M=np.array([[tp,fp],[fn,tn]])
    a2.imshow(M,cmap="Blues"); a2.set_xticks([0,1]); a2.set_yticks([0,1])
    a2.set_xticklabels(["obs poor","obs good"]); a2.set_yticklabels(["pred POOR","pred GOOD"])
    for (r,c),v in np.ndenumerate(M): a2.text(c,r,str(v),ha="center",va="center",fontsize=16,
        color="#fff" if v>M.max()/2 else "#111")
    a2.set_title(f"Confusion @ score ≥ {thr}")
    # (D) metrics
    a3=ax[1,1]; a3.axis("off")
    txt=(f"n = {len(score)}    poor prevalence = {poor.mean()*100:.0f}%\n\n"
         f"  AUC          {auc:.3f}" + (f"   (deriv {ref:.3f})" if ref else "") + "\n"
         f"  sensitivity  {sens*100:.0f}%\n  specificity  {spec*100:.0f}%\n"
         f"  PPV          {ppv*100:.0f}%\n  NPV          {npv*100:.0f}%\n\n"
         f"  sites pooled: {len(sites)}")
    a3.text(0.02,0.98,txt,va="top",family="monospace",fontsize=12)
    plt.tight_layout(rect=[0,0,1,0.96])
    out=a.out or f"validation_figure_{a.score}"
    for ext in ("png","pdf"): fig.savefig(f"{out}.{ext}",dpi=150)
    print(f"wrote {out}.png / .pdf   ({sclabel}: pooled n={len(score)}, AUC={auc:.3f}, sens={sens:.2f}, spec={spec:.2f}, PPV={ppv:.2f}, NPV={npv:.2f})")

if __name__=="__main__":
    main()
