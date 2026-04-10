#!/usr/bin/env python3
"""
scene-evaluator.py — AI 生成场景图逻辑一致性自动评价器

用法:
  python3 scene-evaluator.py <spec.json> <img_path_or_dir>
  python3 scene-evaluator.py --mode sketch <spec.json> <img_path_or_dir>
  python3 scene-evaluator.py --mode render <spec.json> <img_path_or_dir>
  
  spec.json 格式:
  {
    "shots": [
      {
        "id": "B01-foot-catch",
        "description": "场景描述",
        "constraints": ["约束1", "约束2", ...]
      }
    ]
  }

  也可以直接传目录，自动匹配 id.png

  --mode sketch: 线稿审核模式（检查构图/空间/逻辑）
  --mode render: 渲染审核模式（检查风格/美感/一致性）

输出: 每张图 PASS/FAIL + 问题列表
"""

import json, base64, urllib.request, os, sys, glob

API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MODEL = "glm-4v-flash"
MAX_IMG_SIZE = 4 * 1024 * 1024  # 4MB


def get_api_key():
    config_path = os.path.expanduser("~/.openclaw/openclaw.json")
    with open(config_path) as f:
        return json.load(f)["models"]["providers"]["zai"]["apiKey"]


def compress_if_needed(img_path, max_size=MAX_IMG_SIZE):
    """如果图片超过 max_size，压缩到 1080px 宽"""
    size = os.path.getsize(img_path)
    if size <= max_size:
        return img_path
    
    compressed = img_path + ".eval.tmp.png"
    try:
        import subprocess
        subprocess.run(["convert", img_path, "-resize", "1080x", "-quality", "85", compressed],
                      check=True, capture_output=True)
        return compressed
    except Exception:
        # 如果 imagemagick 不可用，尝试用 ffmpeg
        try:
            subprocess.run(["ffmpeg", "-y", "-i", img_path, "-vf", "scale=1080:-1", "-q:v", "5", compressed],
                          check=True, capture_output=True)
            return compressed
        except Exception:
            print(f"⚠️ 无法压缩 {img_path}，可能导致 API 错误")
            return img_path


def evaluate_single(img_path, description, constraints, api_key, mode="default"):
    """调用视觉模型评估单张图片"""
    actual_path = compress_if_needed(img_path)
    
    with open(actual_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    
    checks_text = "\n".join(f"  {i+1}. {c}" for i, c in enumerate(constraints))
    
    if mode == "sketch":
        prompt = (
            f"你是线稿审核员，检查AI生成的黑白漫画线稿。\n"
            f"场景：{description}\n\n"
            f"线稿专项检查：\n"
            f"1. 构图是否合理（空间关系正确）\n"
            f"2. 是否为纯黑白线稿（无彩色、无灰度渐变）\n"
            f"3. 关键元素是否完整\n"
            f"4. 线条是否清晰（无模糊、无噪点）\n"
            f"5. 人物姿态是否符合描述\n\n"
            f"约束检查：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )
    elif mode == "render":
        prompt = (
            f"你是渲染图审核员，检查基于线稿生成的AI渲染图。\n"
            f"场景：{description}\n\n"
            f"渲染专项检查：\n"
            f"1. 是否有残留线稿痕迹（线条、轮廓线）\n"
            f"2. 风格是否统一（色彩、光影、质感）\n"
            f"3. 角色外观是否一致\n"
            f"4. 构图是否保持了线稿的结构\n"
            f"5. 整体美感是否达标\n\n"
            f"约束检查：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )
    else:
        prompt = (
            f"你是AI生成图片的逻辑一致性审核员。\n"
            f"场景：{description}\n\n"
            f"检查每一项，标注✅或❌并简要说明：\n{checks_text}\n\n"
            f"最后给出：PASS 或 FAIL\n如果 FAIL，列出所有问题。简洁回答。"
        )
    
    payload = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]
        }]
    }
    
    data = json.dumps(payload).encode()
    req = urllib.request.Request(API_URL, data=data, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    })
    
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
        return d["choices"][0]["message"]["content"]
    
    # 清理临时文件
    if actual_path != img_path:
        try:
            os.unlink(actual_path)
        except:
            pass


def parse_result(text):
    """从评价结果中提取 PASS/FAIL"""
    if "FAIL" in text.upper():
        return "FAIL", text
    return "PASS", text


def main():
    import argparse
    parser = argparse.ArgumentParser(description="场景图逻辑一致性评价器")
    parser.add_argument("--mode", choices=["default", "sketch", "render"], default="default",
                       help="审核模式: sketch=线稿审核, render=渲染审核")
    parser.add_argument("spec", help="spec.json 路径")
    parser.add_argument("target", help="图片路径或目录")
    args = parser.parse_args()
    
    spec_path = args.spec
    target = args.target
    api_key = get_api_key()
    
    with open(spec_path) as f:
        spec = json.load(f)
    
    shots = spec.get("shots", [])
    
    results = {"pass": [], "fail": [], "error": []}
    
    for shot in shots:
        shot_id = shot["id"]
        desc = shot["description"]
        constraints = shot["constraints"]
        
        # 找到对应图片
        if os.path.isdir(target):
            # 在目录中找 id 开头的 png
            matches = glob.glob(os.path.join(target, f"{shot_id}*.png"))
            if not matches:
                matches = glob.glob(os.path.join(target, f"*{shot_id}*.png"))
            img_path = matches[0] if matches else None
        else:
            img_path = target
        
        if not img_path or not os.path.exists(img_path):
            print(f"❌ {shot_id}: 图片未找到")
            results["error"].append(shot_id)
            continue
        
        try:
            print(f"🔍 [{args.mode}] {shot_id}...", end=" ", flush=True)
            eval_text = evaluate_single(img_path, desc, constraints, api_key, mode=args.mode)
            status, detail = parse_result(eval_text)
            
            if status == "FAIL":
                print(f"❌ FAIL")
                results["fail"].append({"id": shot_id, "detail": detail})
            else:
                print(f"✅ PASS")
                results["pass"].append(shot_id)
        except Exception as e:
            print(f"⚠️ ERROR: {e}")
            results["error"].append(shot_id)
    
    # 汇总
    print(f"\n{'='*60}")
    print(f"📊 评价结果: {len(results['pass'])} PASS / {len(results['fail'])} FAIL / {len(results['error'])} ERROR")
    
    if results["fail"]:
        print(f"\n❌ 需要重跑:")
        for item in results["fail"]:
            print(f"  - {item['id']}")
            # 打印问题要点
            for line in item["detail"].split("\n"):
                if "❌" in line:
                    print(f"    {line.strip()}")
    
    # 输出 JSON 结果供后续流程使用
    output_path = os.path.join(os.path.dirname(target) if os.path.isdir(target) else os.path.dirname(target), "eval-result.json")
    with open(output_path, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=str)
    print(f"\n📄 详细结果: {output_path}")
    
    # 返回非零退出码如果有 FAIL
    sys.exit(1 if results["fail"] else 0)


if __name__ == "__main__":
    main()
