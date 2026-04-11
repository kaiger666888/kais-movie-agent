#!/usr/bin/env python3
"""
sketch-generator.py — 线稿生成器 (multipart form 版)

场景描述 + S.P.A.C.E空间约束 + 角色参考图 → 漫画风格黑白线稿

用法:
  python3 sketch-generator.py \
    --prompt "角色坐在桌前吃面" \
    --space "SUPPORT:碗在桌面|角色坐椅上 PHYSICS:重力向下 ATTACHMENT:右手握筷 CONSTRAINT:无多余筷 ENVIRONMENT:实验室 PERSPECTIVE:中景" \
    --ref /path/to/char_ref.png \
    --output /path/to/output.png

环境变量:
  JIMENG_SESSION_ID: 即梦 session ID
  JIMENG_API_URL: API 地址 (默认 http://localhost:8000)
"""

import argparse, json, urllib.request, os, sys, time, uuid, subprocess

API_URL = os.environ.get("JIMENG_API_URL", "http://localhost:8000")
SESSION_ID = os.environ.get("JIMENG_SESSION_ID", "")


def generate_sketch(prompt, space_constraints, ref_paths, model, ratio, sample_strength):
    """用 multipart form 调用即梦 API（经实测稳定）"""
    
    sketch_prompt = (
        f"manga comic style line art, black ink on white paper, clean crisp outlines, "
        f"no screentone no shading no color, japanese manga panel art style, "
        f"expressive facial features, clear background elements in line art, "
        f"{ratio.replace(':', '')} vertical manga panel. "
        f"{prompt}. "
        f"Space constraints: {space_constraints}"
    )

    negative = (
        "colored, rendered, shaded, gradient, oil painting, watercolor, photo, 3D, realistic, "
        "bad anatomy, deformed, distorted, mutated hands, missing fingers, extra fingers, "
        "bad hands, extra limbs, missing limbs, bad proportions, distorted face, long neck, "
        "floating objects, duplicate items, items in mid-air"
    )

    # 用 curl multipart form（比 urllib 更稳定）
    cmd = [
        "curl", "-s", "--max-time", "120",
        f"{API_URL}/v1/images/generations",
        "-H", f"Authorization: Bearer {SESSION_ID}",
        "-F", f"prompt={sketch_prompt}",
        "-F", f"negative_prompt={negative}",
        "-F", f"model={model}",
        "-F", f"ratio={ratio}",
        "-F", f"sample_strength={sample_strength}",
    ]
    
    # 参考图
    for ref in ref_paths:
        if os.path.exists(ref):
            cmd.extend(["-F", f"images=@{ref}"])
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=130)
    if result.returncode != 0:
        raise RuntimeError(f"curl failed: {result.stderr[:200]}")
    
    d = json.loads(result.stdout)
    if not d.get("data"):
        raise RuntimeError(f"API no data: {result.stdout[:200]}")
    
    return d["data"][0]["url"]


def download_image(url, output_path):
    req = urllib.request.Request(url)
    req.add_header("Referer", "https://jimeng.jianying.com/")
    with urllib.request.urlopen(req, timeout=30) as r:
        with open(output_path, "wb") as f:
            f.write(r.read())


def main():
    parser = argparse.ArgumentParser(description="线稿生成器")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--space", default="")
    parser.add_argument("--ref", nargs="*", default=[])
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="jimeng-5.0")
    parser.add_argument("--ratio", default="9:16")
    parser.add_argument("--sample-strength", type=float, default=0.35)
    parser.add_argument("--retry", type=int, default=2)
    args = parser.parse_args()

    if not SESSION_ID:
        print("❌ 设置 JIMENG_SESSION_ID 环境变量")
        sys.exit(1)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    for attempt in range(args.retry + 1):
        try:
            print(f"🎨 线稿 ({attempt+1}/{args.retry+1})...", flush=True)
            url = generate_sketch(args.prompt, args.space, args.ref, args.model, args.ratio, args.sample_strength)
            download_image(url, args.output)
            print(f"✅ {args.output} ({os.path.getsize(args.output)//1024}KB)")
            
            meta = {"output": args.output, "prompt": args.prompt, "space": args.space,
                     "model": args.model, "sample_strength": args.sample_strength,
                     "ref_count": len(args.ref), "attempts": attempt+1}
            with open(args.output + ".meta.json", "w") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            sys.exit(0)
        except Exception as e:
            print(f"❌ {e}")
            if attempt < args.retry:
                time.sleep(3)
            else:
                sys.exit(1)


if __name__ == "__main__":
    main()
