# kais-review-page — 项目审核 HTML 页面构建器

## 触发词
`审核页面`, `review page`, `preview page`, `构建审核页`, `生成交互页面`, `HTML预览`

## 概述
为电影管线各 Phase 产出物构建**交互式 HTML 审核页面**，支持图片预览、Prompt 复制、分组筛选、状态标注。页面通过本地 HTTP server 提供访问。

## 设计原则

1. **暗色主题** — 专业感，长时间查看不疲劳
2. **信息密度** — 一屏内尽可能展示完整上下文（参考图 + 参数 + prompt）
3. **可操作性** — 点击 prompt 即可复制（兼容 HTTP，用 `execCommand` 不用 `clipboard`）
4. **分组有序** — 按用户要求排序（shot 编号 / phase 分组 / chain 分组）
5. **状态标注** — 用颜色标签区分 phase/mode/status

## 页面模板

### 通用结构

```html
<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8">
<title>项目名 - 审核页标题</title>
<style>
/* 暗色主题 + 卡片布局 + 响应式 */
</style>
</head><body>
<h1>🎬 标题</h1>
<div class="meta">统计信息</div>
<div class="summary">统计卡片</div>
<!-- 卡片列表 -->
<script>
// 点击复制（HTTP 兼容）
function cp(el){
  var ta=document.createElement("textarea");
  ta.value=el.innerText;
  ta.style.cssText="position:fixed;left:-9999px";
  document.body.appendChild(ta);
  ta.select();
  try{document.execCommand("copy")}catch(e){}
  document.body.removeChild(ta);
}
</script>
</body></html>
```

### CSS 规范

```css
* { margin:0; padding:0; box-sizing:border-box }
body { background:#0a0a0a; color:#eee; font-family:-apple-system,sans-serif; padding:16px }
h1 { text-align:center; font-size:22px; margin-bottom:4px }
.meta { text-align:center; color:#888; font-size:13px; margin-bottom:20px }

/* 统计卡片 */
.sg { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px }
.si { background:#1a1a1a; border-radius:8px; padding:12px; text-align:center }
.si .n { font-size:28px; font-weight:bold; color:#ffd700 }
.si .l { font-size:12px; color:#888; margin-top:4px }

/* 卡片 */
.card { background:#1a1a1a; border-radius:8px; margin-bottom:12px; overflow:hidden; border-left:3px solid #333 }
.ch { display:flex; align-items:center; gap:8px; padding:8px 12px; background:#222 }
.ph { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold; color:#000 }
.md { margin-left:auto; padding:2px 8px; border-radius:10px; font-size:11px; color:#000 }
.cb { padding:12px }

/* 参考图 */
.cb img { width:120px; height:213px; object-fit:cover; border-radius:4px; margin-bottom:8px }

/* 信息行 */
.ir { display:flex; flex-wrap:wrap; gap:8px; font-size:12px; color:#8cf; margin-bottom:6px }

/* 可复制 Prompt 框 */
.pb { background:#111; border:1px solid #333; border-radius:6px; padding:8px; margin-top:8px; cursor:pointer }
.pt { font-size:12px; color:#cfc; word-break:break-all; line-height:1.5; white-space:pre-wrap }

/* 分隔线 */
.divider { border-top:1px dashed #444; margin:16px 0 }
```

### Phase 颜色映射

| Phase | 背景色 |
|-------|--------|
| 现实 | `#4a9ff` |
| 觉醒 | `#ffd700` |
| 画卷 | `#ff6b9d` |
| 梦碎 | `#ff4444` |
| 醒来 | `#888` |
| 余韵 | `#7ec8e3` |

### 模式颜色映射

| 模式 | CSS class | 背景色 |
|------|-----------|--------|
| 单帧 | `.md.sf` | `#4a9ff` |
| 首尾帧 | `.md.se` | `#ffd700` |
| 延长链 | `.md.ch` | `#ff6b9d` |
| 连续多帧 | `.md.cm` | `#7ec8e3` |

## 卡片字段规范

每个 shot 卡片应包含（按需选用）：

```html
<div class="card">
  <div class="ch">
    <span class="ph" style="background:{color}">{phase}</span>
    <b>Shot {num}: {title}</b>
    <span class="md {mode}">{mode_label}</span>
  </div>
  <div class="cb">
    <!-- 参考图 -->
    <img src="{image_url}">
    <!-- 运镜信息 -->
    <div class="ir">
      <span>📷{camera_movement}</span>
      <span>🔭{lens}</span>
      <span>💫motion {strength}</span>
      <span>⏱️{duration}s</span>
    </div>
    <!-- 可选：诗句 -->
    <div class="pm">📜{poem}</div>
    <!-- 可选：字幕 -->
    <div class="st">字幕: {subtitle_text}</div>
    <!-- 可选：音效 -->
    <div class="sd">🎵{sound_design}</div>
    <!-- 可选：备注 -->
    <div class="nt">⚠️{notes}</div>
    <!-- 可复制 Prompt -->
    <div class="pb" onclick="cp(this)">
      <div class="pt">{prompt_text}</div>
    </div>
  </div>
</div>
```

## 点击复制实现（关键经验）

### ❌ 不要用 `navigator.clipboard`
```javascript
// 非 HTTPS 环境下不可用（本地 HTTP server 会失败）
navigator.clipboard.writeText(text)
```

### ✅ 用 textarea + execCommand
```javascript
function cp(el) {
  var ta = document.createElement("textarea");
  ta.value = el.innerText;
  ta.style.cssText = "position:fixed;left:-9999px";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy") } catch(e) {}
  document.body.removeChild(ta);
}
```

### ⚠️ 复制内容清理
- **只复制纯 prompt 文字**，不包含标签文字（"Seedance Prompt"、"已复制"等）
- prompt 中去掉 `@1`、`@2` 等参考标记（用户手动提交时不需要）
- 使用 `.innerText` 而非 `.innerHTML`（避免复制 HTML 标签）

## HTTP Server 启动

```bash
cd /tmp/project-preview && python3 -m http.server 9998 --bind 0.0.0.0 &
```

- 端口默认 `9998`，避免与常用服务冲突
- 绑定 `0.0.0.0` 允许局域网访问
- 图片用绝对 URL：`http://{host_ip}:9998/{relative_path}`
- Server 可能因 session 断开而停止，需检查并重启

## 构建脚本规范

### 数据来源
- **storyboard_v2.json** — 分镜板数据（shots 数组）
- **coverage_map.json** — 拍摄手法映射
- **shooting_script.json** — 拍摄脚本
- **EP01_screenplay_v5.json** — 剧本原文

### Python 构建模板

```python
import json

# 加载数据
with open('storyboard_v2.json') as f:
    sb = json.load(f)
sb_lookup = {s['shot_num']: s for s in sb['shots']}

# 遍历生成卡片
body = ''
for s in sb['shots']:
    # 构建 HTML 字符串（用字符串拼接，避免 f-string 与 heredoc 冲突）
    body += '<div class="card">...'
    
# 组装完整 HTML
html = CSS_HEADER + body + JS_FOOTER
with open(output_path, 'w') as f:
    f.write(html)
```

### ⚠️ 常见坑

1. **Python f-string + Bash heredoc 冲突** — 写独立 `.py` 文件再执行，不要内嵌
2. **图片路径** — 确认 HTTP server 的根目录与图片路径对应
3. **prompt 中的特殊字符** — JSON 加载后直接用，不要二次转义
4. **排序** — storyboard_v2.json 的 shots 顺序可能不是 shot_num 顺序，按需排序

## 各 Phase 审核页面类型

| Phase | 页面内容 | 关键字段 |
|-------|---------|---------|
| Phase 5 场景图 | 25张场景图 + prompt + 风格标注 | scene image, style prompt |
| Phase 6 分镜板 | 25个分镜卡 + 运镜 + 诗句 + 字幕 | storyboard data, camera, poem, subtitle |
| Phase 5.7 Coverage Map | 运镜手法映射表 | camera movement, lens, motion |
| Phase 7 视频任务 | 生成模式分组 + 可复制 prompt | mode(single/chain/start-end), prompt |

## 完整示例

```python
import json

with open('storyboard_v2.json') as f:
    sb = json.load(f)

pc = {'现实':'#4a9ff', '觉醒':'#ffd700', '画卷':'#ff6b9d', '梦碎':'#ff4444', '醒来':'#888', '余韵':'#7ec8e3'}

body = ''
for s in sb['shots']:
    num = s['shot_num']
    c = pc.get(s['phase'], '#fff')
    p = s.get('video_prompt', s.get('prompt', '')).replace('@1', '')
    
    body += (
        '<div class="card"><div class="ch">'
        '<span class="ph" style="background:' + c + '">' + s['phase'] + '</span>'
        '<b>Shot ' + str(num) + ': ' + s['title'] + '</b>'
        '<span class="md ch">🔗 连续多帧</span>'
        '</div><div class="cb">'
        '<img src="http://192.168.71.140:9998/scenes/shot' + str(num) + '.png">'
        '<div class="ir">'
        '<span>📷 ' + s['camera']['movement'] + '</span>'
        '<span>💫 motion ' + str(s['camera']['motion_strength']) + '</span>'
        '<span>⏱️ ' + str(s['duration']) + 's</span>'
        '</div>'
        '<div class="pb" onclick="cp(this)"><div class="pt">' + p + '</div></div>'
        '</div></div>'
    )

html = (
    '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>审核页</title>\n'
    '<style>\n'
    '*{margin:0;padding:0;box-sizing:border-box}\n'
    'body{background:#0a0a0a;color:#eee;font-family:-apple-system,sans-serif;padding:16px}\n'
    '/* ... 完整 CSS ... */\n'
    '</style></head><body>\n'
    '<h1>🎬 项目标题</h1>\n'
    '<div class="meta">统计信息</div>\n'
    + body +
    '\n<script>\n'
    'function cp(el){var ta=document.createElement("textarea");ta.value=el.innerText;ta.style.cssText="position:fixed;left:-9999px";document.body.appendChild(ta);ta.select();try{document.execCommand("copy")}catch(e){}document.body.removeChild(ta);}\n'
    '</script>\n</body></html>'
)

with open('/tmp/project-preview/review.html', 'w') as f:
    f.write(html)
```
