#!/usr/bin/env python3
"""Build step3-scripts.json — assemble from part files."""
import json, os

outdir = "/home/kai/workspace/kais-movie-agent/output/20260619-urban-fantasy-comedy"
parts_dir = os.path.join(outdir, "parts")

data = {
  "type": "ScreenplaysV1_Audited",
  "version": "2.0.0",
  "expert": "screenplay + script_auditor (rhythm-enhanced rewrite)",
  "pipeline": "kais-movie-agent V8.6 / Step 3 (rewrite)",
  "generated_at": "2026-06-19",
  "scripts": {}
}

variant_meta = {
    "alpha": {
        "variant_name": "悬疑强化版",
        "variant_description": "悬疑主旋律，每集结尾颠覆认知，情感最后2集爆发。苏念AI产品经理视角作为冷幽默调剂，悬疑线为主导。"
    },
    "beta": {
        "variant_name": "悬疑+喜剧均衡版",
        "variant_description": "悬疑和喜剧交替，苏念职场视角大量喜剧冲突，情感中段+结尾双爆发。PM术语贯穿始终形成独特风格。"
    },
    "gamma": {
        "variant_name": "奇幻悬疑版",
        "variant_description": "奇幻视觉奇观+悬疑，P1800有意识这条线最强。车是活的——从第一集就建立，逐层升级直到终极揭示。"
    }
}

for variant in ("alpha", "beta", "gamma"):
    episodes = []
    for half in ("ep1_4", "ep5_8"):
        filepath = os.path.join(parts_dir, f"{variant}_{half}.json")
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                episodes.extend(json.load(f))
    meta = variant_meta[variant]
    meta["episodes"] = episodes
    data["scripts"][variant] = meta

outpath = os.path.join(outdir, "step3-scripts.json")
with open(outpath, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

size = os.path.getsize(outpath)
print(f"Written: {outpath}")
print(f"Size: {size:,} bytes ({size/1024:.1f} KB)")
for v in data["scripts"]:
    eps = data["scripts"][v].get("episodes", [])
    total_scenes = sum(len(e.get("scenes", [])) for e in eps)
    print(f"  {v} ({data['scripts'][v]['variant_name']}): {len(eps)} episodes, {total_scenes} scenes total")
