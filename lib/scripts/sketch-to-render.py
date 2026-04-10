#!/usr/bin/env python3
"""
sketch-to-render.py — 基于线稿的渲染器

将审核通过的线稿 + 风格描述 + 角色参考图 → 最终渲染图

用法:
  python3 sketch-to-render.py \
    --sketch /path/to/sketch.png \
    --prompt "赛博朋克风格，霓虹灯光，暗色调" \
    --ref /path/to/char_ref.png \
    --output /path/to/render.png \
    [--model jimeng-5.0] \
    [--ratio 9:16] \
    [--sample-strength 0.25]

环境变量:
  JIMENG_SESSION_ID: 即梦 session ID
  JIMENG_API_URL: API 地址 (默认 http://localhost:8000)
"""

import argparse, json, base64, urllib.request, os, sys, time

API_URL = os.environ.get("JIMENG_API_URL", "http://localhost:8000")
SESSION_ID = os.environ.get("JIMENG_SESSION_ID", "")


def img_to_base64(path):
    """图片文件转 base64 data URI"""
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lstrip(".")
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}.get(ext, "image/png")
    return f"data:{mime};base64,{b64}"


def render_from_sketch(sketch_path, prompt, ref_images, model, ratio, sample_strength, style_prompt=""):
    """调用即梦 API 基于线稿渲染"""
    
    # 构建渲染 prompt：保留构图 + 添加风格
    render_prompt = prompt
    if style_prompt:
        render_prompt = f"{prompt}\n风格要求：{style_prompt}"
    
    negative = "线稿, sketch, lineart, 草图, draft, 线条, 粗糙, rough, unfinished, 黑白, monochrome, wireframe"
    
    # images: [线稿(主要结构), 角色参考图(外观一致性)]
    images = [img_to_base64(sketch_path)]
    images.extend(ref_images)
    
    body = {
        "model": model,
        "prompt": render_prompt,
        "negative_prompt": negative,
        "ratio": ratio,
        "resolution": "2k",
        "sample_strength": sample_strength,
        "images": images,
    }
    
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API_URL}/v1/images/generations",
        data=data,
        headers={
            "Authorization": f"Bearer {SESSION_ID}",
            "Content-Type": "application/json"
        }
    )
    
    with urllib.request.urlopen(req, timeout=120) as r:
        result = json.loads(r.read())
    
    if not result.get("data"):
        raise RuntimeError(f"API 未返回图片: {result}")
    
    return result["data"][0]["url"]


def main():
    parser = argparse.ArgumentParser(description="基于线稿的渲染器")
    parser.add_argument("--sketch", required=True, help="线稿图片路径")
    parser.add_argument("--prompt", required=True, help="场景描述 + 风格")
    parser.add_argument("--style", default="", help="额外风格描述（独立于prompt）")
    parser.add_argument("--ref", nargs="*", default=[], help="角色参考图路径（可多张）")
    parser.add_argument("--output", required=True, help="输出渲染图路径")
    parser.add_argument("--model", default="jimeng-5.0", help="模型版本")
    parser.add_argument("--ratio", default="9:16", help="图片比例")
    parser.add_argument("--sample-strength", type=float, default=0.25, help="线稿结构保留强度")
    parser.add_argument("--retry", type=int, default=1, help="失败重试次数")
    
    args = parser.parse_args()
    
    if not SESSION_ID:
        print("❌ 请设置 JIMENG_SESSION_ID 环境变量")
        sys.exit(1)
    
    if not os.path.exists(args.sketch):
        print(f"❌ 线稿不存在: {args.sketch}")
        sys.exit(1)
    
    # 准备参考图
    ref_images = []
    for ref_path in args.ref:
        if os.path.exists(ref_path):
            ref_images.append(img_to_base64(ref_path))
            print(f"📎 角色参考: {os.path.basename(ref_path)}")
    
    print(f"📝 线稿: {os.path.basename(args.sketch)}")
    print(f"🎯 参考图: {len(ref_images) + 1} 张 (线稿+角色)")
    
    for attempt in range(args.retry + 1):
        try:
            print(f"🎨 渲染中 (尝试 {attempt + 1}/{args.retry + 1})...", flush=True)
            url = render_from_sketch(
                args.sketch, args.prompt, ref_images,
                args.model, args.ratio, args.sample_strength, args.style
            )
            
            os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
            urllib.request.urlretrieve(url, args.output)
            print(f"✅ 渲染完成: {args.output}")
            
            meta = {
                "output": args.output,
                "sketch": args.sketch,
                "url": url,
                "prompt": args.prompt,
                "style": args.style,
                "model": args.model,
                "sample_strength": args.sample_strength,
                "ref_count": len(ref_images),
                "total_images": len(ref_images) + 1,
                "attempts": attempt + 1
            }
            meta_path = args.output + ".meta.json"
            with open(meta_path, "w") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            
            sys.exit(0)
            
        except Exception as e:
            print(f"❌ 渲染失败: {e}")
            if attempt < args.retry:
                time.sleep(3)
            else:
                sys.exit(1)


if __name__ == "__main__":
    main()
