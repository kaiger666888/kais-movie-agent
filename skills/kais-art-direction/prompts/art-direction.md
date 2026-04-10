# Art Direction Prompt 模板

## 变量定义

| 变量 | 说明 | 示例 |
|------|------|------|
| `{genre}` | 故事类型 | sci-fi, romance, horror |
| `{tone}` | 情感基调 | dark_hopeful, warm_comedic, tense |
| `{theme}` | 核心主题 | 孤独与连接, 成长, 复仇 |
| `{era}` | 时代背景 | 2077, medieval, 1920s |
| `{mood_keywords}` | 情绪关键词数组 | 废墟, 霓虹, 雨夜 |
| `{style_name}` | 风格名称 | 霓虹废墟, 胶片暖阳 |
| `{color_desc}` | 色彩描述 | 深蓝为主色调，霓虹粉点缀 |
| `{light_desc}` | 光效描述 | 高对比度霓虹灯，湿润路面反射 |
| `{texture_desc}` | 质感描述 | 金属锈蚀，玻璃反射，全息投影 |
| `{composition_desc}` | 构图描述 | 引导线透视，前景框架遮挡 |
| `{light_direction}` | 光照方向 | upper-left, lower-right, behind, front, multi-source |
| `{light_intensity}` | 光照强度 | 0.0 - 1.0 |
| `{color_temp}` | 色温 | 2700K (暖) - 8000K (冷) |
| `{light_mood}` | 光影氛围 | dramatic, soft-backlight, chiaroscuro, prismatic |

## 变量定义（光影参考图专用）

| 变量 | 说明 | 示例 |
|------|------|------|
| `{light_direction}` | 主光方向 | upper-left, lower-right, behind, front, multi-source |
| `{light_intensity_pct}` | 光照强度百分比 | 60%, 85%, 50% |
| `{color_temp}` | 色温值 | 3200K, 6500K, 8000K |
| `{light_mood}` | 光影氛围描述 | dramatic, rim-light, volumetric, soft-diffusion |
| `{style_name}` | 已锁定风格名称 | 霓虹废墟, 胶片暖阳 |
| `{light_quality}` | 已锁定光效描述 | 高对比度霓虹灯+湿润路面反射 |
| `{color_palette_str}` | 色彩方案字符串 | #0a0e17, #1a3a5c, #ff6b35 |

## 参考图生成 Prompt

```
Cinematic concept art, {style_name} style, {era} setting, {genre} genre.
Color palette: {color_desc}.
Lighting: {light_desc}.
Texture: {texture_desc}.
Composition: {composition_desc}.
Theme: {theme}. Mood: {tone}. Keywords: {mood_keywords}.
Ultra high quality, 16:9 aspect ratio, reference sheet, multiple angles, no text, no watermark.
```

## 光影参考图生成 Prompt（Lighting Reference）

> 用途：在风格锁定后（Step 3.5），生成一张纯光照研究参考图，作为渲染阶段的光影锚定。

```
Cinematic lighting reference sheet, pure lighting study, style: {style_name}.
Light direction: {light_direction}.
Color temperature: {color_temp}.
Intensity: {light_intensity_pct}.
Mood: {light_mood}.
Light quality: {light_quality}.
Color palette: {color_palette_str}.
Showing a neutral geometric scene with spheres and planes to demonstrate light and shadow distribution across surfaces.
No characters, no text, no watermark.
Ultra high quality, 16:9 aspect ratio, professional lighting diagram feel.
```

### 各风格默认光影参数

| 风格 | direction | intensity | color_temp | mood |
|------|-----------|-----------|------------|------|
| 电影胶片感 | upper-left | 0.6 | 3200K | warm, soft-diffusion, film-grain |
| 赛博朋克 | lower-right | 0.85 | 8000K | dramatic, neon-rim, volumetric, high-contrast |
| 日系清新 | behind | 0.5 | 6500K | soft-backlight, airy, natural-diffusion |
| 暗黑哥特 | upper-right | 0.9 | 2700K | chiaroscuro, candlelight, volumetric-dust |
| 纪录片写实 | front | 0.4 | 5600K | natural, ambient, handheld |
| 梦幻超现实 | multi-source | 0.7 | 7000K | prismatic, halo, multi-glow, ethereal |

## 风格详细定义

### 电影胶片感 (Film Noir / Analog)

**色彩**: 暖黄(#d4a574) + 深棕(#3d2b1f) + 褪色蓝(#6b8cae) + 米白(#f5f0e8) + 暗红(#8b3a3a)
**光效**: 柔和漫射光，模拟钨丝灯温暖感，轻微镜头眩光，胶片颗粒纹理
**质感**: 胶片颗粒感，有机材质（木头、布料、皮肤），自然磨损
**构图**: 经典黄金分割，浅景深虚化，水平线稳定构图
**适用**: 剧情、文艺、回忆、怀旧题材
**Era 偏好**: 1950s-2000s

### 赛博朋克 (Cyberpunk)

**色彩**: 深蓝(#0a1628) + 霓虹粉(#ff2d7b) + 电光绿(#00ff88) + 暗紫(#2d1b4e) + 金属灰(#8c9ead)
**光效**: 高对比度霓虹灯光，湿润路面反射，全息投影发光，LED 面板冷光
**质感**: 金属锈蚀，玻璃反射，全息投影透明感，碳纤维纹理
**构图**: 引导线透视（街道、走廊），前景框架遮挡，垂直线条强调高度
**适用**: 科幻、反乌托邦、未来都市、黑客题材
**Era 偏好**: 2040s-2090s

### 日系清新 (Japanese Clean)

**色彩**: 白(#fafafa) + 淡粉(#f8d7da) + 薄荷绿(#d4edda) + 天蓝(#cce5ff) + 浅木色(#f0e6d3)
**光效**: 自然漫射光，柔和逆光轮廓，窗户透光，阴影轻柔渐变
**质感**: 柔焦效果，通透空气感，轻纱飘动，干净表面
**构图**: 大量留白，低角度仰拍，中心聚焦，边角虚化
**适用**: 恋爱、日常、治愈、校园、青春题材
**Era 偏好**: 当代 / 1990s-2020s

### 暗黑哥特 (Dark Gothic)

**色彩**: 黑(#0d0d0d) + 深红(#5c1a1a) + 暗金(#8b7d3c) + 灰紫(#4a4a5a) + 象牙白(#f0ead6)
**光效**: 戏剧性明暗对比（chiaroscuro），烛光摇曳，月光冷调，体积光穿透尘埃
**质感**: 石材纹理，蕾丝细节，金属雕花，木材年轮，天鹅绒
**构图**: 对称构图，垂直线条强调（尖拱、柱子），低角度仰望，框架构图
**适用**: 恐怖、悬疑、奇幻、吸血鬼、宗教题材
**Era 偏好**: 中世纪 / 1800s-1900s

### 纪录片写实 (Documentary Realism)

**色彩**: 自然色温 + 低饱和度 + 微偏绿(#5a6b5a) + 土黄(#c4a35a) + 灰蓝(#7a8a9a)
**光效**: 自然光源，手持拍摄光感，环境光为主，偶尔补光灯效果
**质感**: 真实材质无修饰，皮肤毛孔，衣物纹理，环境颗粒感
**构图**: 手持构图略倾斜，抓拍感，不规则裁切，浅景深自然虚化
**适用**: 纪录片、社会议题、战争、现实主义、传记题材
**Era 偏好**: 当代 / 真实时间线

### 梦幻超现实 (Dreamy Surreal)

**色彩**: 渐变紫(#7b2d8e → #c084fc) + 荧光蓝(#00d4ff) + 金(#ffd700) + 珊瑚粉(#ff6b9d) + 星空白(#e8e0f0)
**光效**: 柔和发光，光晕效果，多重光源重叠，星光闪烁，棱镜折射
**质感**: 流体材质，水晶透明感，星尘粒子，云雾缭绕，光滑表面
**构图**: 中心对称，漂浮感（物体悬空），尺寸对比（大与小），镜面反射
**适用**: 奇幻、梦境、童话、意识流、精神探索题材
**Era 偏好**: 超越时代 / 梦境空间
