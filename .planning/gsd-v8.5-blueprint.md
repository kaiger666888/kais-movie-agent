# GSD Blueprint: kais-movie-agent V8.5 — dreamina CLI 取代 jimeng-client + Step 7 资产库重建

## 背景
- jimeng-client.js 已废弃，全面被 dreamina CLI 取代
- dreamina CLI 是即梦官方 AIGC 工具，支持 text2image / image2image / multimodal2video / multiframe2video / frames2video / image_upscale
- image2image 最多 10 张参考图（比 compositions 更灵活）
- multiframe2video 支持 2-20 图直接生成连贯故事视频
- Step 7 角色资产库流程需要用 dreamina CLI 重写

## 目标
1. SKILL.md 工具映射全部替换为 dreamina CLI 命令
2. jimeng-client.js 标记废弃
3. Step 7 角色资产库完整流程（L1/L2/L3/L4）用 dreamina CLI 重写
4. Step 17 视频生成新增 multiframe2video 模式
5. Git commit + push

## 变更清单

### 1. lib/jimeng-client.js
- 文件顶部添加 `@deprecated` 标记
- 指向 dreamina CLI

### 2. SKILL.md 变更

#### 2a. 工具映射表替换
旧：
```
文生图   → dreamina text2image --prompt "..." --model_version 5.0 --ratio 16:9 --resolution_type 2k --poll 0
图生图   → dreamina reference2image --prompt "..." --reference-image ./ref.png --reference-strength 0.6
图合成   → dreamina image2image --prompt "..." --images L1_face.png L2_costume.png --sample-strength 0.4
视频omni → dreamina multimodal2video --prompt "@Image1 ..." --images L1_*.png scene.png
```
新（修正为实际 CLI 参数）：
```
文生图   → dreamina text2image --prompt "..." --model_version 5.0 --ratio 16:9 --resolution_type 2k --poll 0
图生图   → dreamina image2image --images ./ref.png --prompt "..." --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
双参考   → dreamina image2image --images L1_face.png,L2_costume.png --prompt "..." --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 0
视频omni → dreamina multimodal2video --image L1_01.png --image L1_02.png --image L1_03.png --image scene.png --prompt "@Image1 provides identity..." --model_version seedance2.0fast --duration 5 --ratio 16:9 --poll 0
故事视频 → dreamina multiframe2video --images frame1.png,frame2.png,... --transition-prompt "turn A to B" --transition-prompt "turn B to C" --poll 0
超分     → dreamina image_upscale --image ./photo.png --resolution_type 4k --poll 0
```

注意关键差异：
- image2image 用 `--images` (逗号分隔) 不是 `--image` (stringArray)
- image2image 没有 `--sample-strength` 参数（即梦 5.0 内部自动处理）
- multimodal2video 用 `--image` (stringArray, 可 repeat)

#### 2b. Step 7 角色资产库完整流程重写

Phase A: 角色设定
- 输入：锁定剧本 + style-genome.json
- 工具：hermes character_designer → 角色外貌/服装设定
- 输出：character-spec.json

Phase B: L1 身份锚点
- 输入：character-spec + style-genome
- 工具：hermes visual_executor (drawer) → reference-prompt-builder.buildIdentityAnchorPrompt() → dreamina text2image × 20
  ```
  dreamina text2image --prompt "portrait, head and shoulders, neutral expression, ..." \
    --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 120
  ```
- 工具：scene-evaluator.py --mode render 质量检测
- 闭环：不合格 → visual_executor 修正 prompt → 重生成（最多 3 轮）
- 输出：≥3 张达标 → 命名 `{角色名}_L1_01.png` → registerIdentityAnchors()

Phase C: L2 造型卡片（每套服装正+侧）
- 输入：L1 锚点 + character-spec 服装列表
- 工具：hermes visual_executor → buildCostumeSheetPrompt(view=front) → dreamina image2image
  ```
  dreamina image2image --images L1_01.png,L1_02.png \
    --prompt "full body front view, standing, {costume_desc}, clean background" \
    --model_version 5.0 --ratio 3:4 --resolution_type 2k --poll 120
  ```
- 侧面同理（--prompt 中换 view=side）
- 工具：scene-evaluator.py 全身+服装检测
- 闭环：不合格重生（最多 2 轮）
- 命名规范：`{角色名}_{造型名}_正.png` / `_{造型名}_侧.png`
- 规则：一造型一卡片，不混放

Phase D: L3 姿势包（按需，从剧本动作列表提取）
- 工具：dreamina image2image --images L1_01.png,{L2正面} --prompt "..."
  - sample_strength 无参数，靠 prompt 控制变化幅度

Phase E: L4 表情标定（按需）
- 工具：dreamina image2image --images L1_01.png --prompt "{expression}"

Phase F: 资产库快照
- CharacterAssetManager.getAssetSnapshot() → character-asset-manifest.json

#### 2c. Step 17 视频生成新增模式

模式 A: 多图故事（multiframe2video）
- 适用：分镜帧已就绪，直接从 N 帧生成连贯视频
- ```
  dreamina multiframe2video --images frame1.png,frame2.png,frame3.png \
    --transition-prompt "character walks to desk" \
    --transition-prompt "character picks up book" \
    --poll 0
  ```

模式 B: 全能参考（multimodal2video）— 原有模式
- 适用：需要强角色一致性（L1 锚点 + 场景图）
- ```
  dreamina multimodal2video --image L1_01.png --image L1_02.png --image L1_03.png \
    --image scene_frame.png --prompt "@Image1 @Image2 @Image3 provide identity, @Image4 provides scene" \
    --model_version seedance2.0fast --duration 5 --ratio 16:9 --poll 0
  ```

模式 C: 首尾帧（frames2video）
- 适用：明确起止状态的视频
- ```
  dreamina frames2video --first ./start.png --last ./end.png \
    --prompt "character transforms" --model_version seedance2.0fast --duration 5 --poll 0
  ```

#### 2d. 外部服务表更新
- 删除 jimeng-free-api 行（docker 容器不再需要）
- 替换为 dreamina CLI

#### 2e. GPU Runtime Manager 表
- 删除 jimeng-free-api 相关行
- dreamina CLI 是本地二进制，不需要 docker

#### 2f. 删除所有 jimeng-client 引用
- grep SKILL.md 中所有 jimeng-client / jimeng-free-api / compositions API / localhost:8003 引用
- 替换为 dreamina CLI 对应命令

### 3. DEPRECATED.md 更新
- 添加 jimeng-client.js 废弃记录
- 添加 jimeng-free-api docker 容器废弃记录

## 验收标准
- SKILL.md 中不含 localhost:8003 / jimeng-client / jimeng-free-api / compositions API
- SKILL.md 中 dreamina CLI 命令参数与 `dreamina -h` 一致
- Step 7 有完整的 L1/L2/L3/L4 流程（含生成→检测→重生成闭环）
- Step 17 有三种视频生成模式
- jimeng-client.js 文件顶部有 @deprecated
