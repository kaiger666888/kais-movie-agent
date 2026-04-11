# kais-voice — 语音合成引擎

## 触发词
`配音`, `TTS`, `语音合成`, `voice`, `音色选择`, `角色配音`, `旁白`, `对白录音`

## 定位
管线音频层 — Phase 4.5（剧本之后、视频之前），负责角色配音、旁白、音频预生成。

## 核心能力

### 1. 多音色选择
内置 7 种 GLM-TTS 音色，根据角色特征自动推荐 + 生成样本供人工审核：

| 音色 | 性别 | 年龄 | 声线 | 适合角色 |
|------|------|------|------|---------|
| 彤彤 | 女 | 青年 | 温柔亲和 | 女主角、旁白、温柔女声 |
| 小陈 | 男 | 青年 | 阳光活泼 | 男主角、热血少年 |
| 锤锤 | 男 | 中年 | 沉稳可靠 | 领导、长辈、内心独白 |
| Jam | 男 | 青年 | 潮流活力 | 说唱、潮流旁白 |
| Kazi | 女 | 青年 | 知性优雅 | 解说、纪录片、商务 |
| Douji | 男 | 青年 | 少年清亮 | 学生、纯真角色 |
| Luodo | 男 | 中年 | 低沉磁性 | 反派、悬疑旁白 |

### 2. 音色审核流程
```
剧本对白 → 角色分析 → 推荐音色（Top 3）
  → 生成每个音色的样本（用角色的一句对白）
  → 发送给用户试听
  → 用户确认选择
  → 锁定角色→音色映射
```

### 3. 情感语调
GLM-TTS 自动根据文本情感调整语调，支持：开心/悲伤/愤怒/紧张/温暖/平静

### 4. 批量合成
按剧本分镜逐行合成，输出 mp3 文件列表，对接延长链 extension-chain 的 prebindAudio()。

## TTS Provider 接口

保留抽象接口，可切换其他 TTS 引擎：

```js
class TTSProvider {
  async synthesize(text, options)    // 合成音频
  async listVoices()                  // 列出音色
  async recommendVoices(character, scene)  // 推荐音色
}
```

**已实现**：GLMTTSProvider（智谱 GLM-TTS）
**可扩展**：CosyVoice、Edge TTS、Fish Audio、ElevenLabs

## 环境变量
- `ZHIPU_API_KEY`：智谱 API Key（GLM-TTS 使用）

## 文件结构
```
kais-voice/
├── SKILL.md
└── lib/
    └── tts-engine.js    # TTS 引擎（GLM-TTS + 抽象接口）
```

## 与管线集成

```
Phase 4:   剧本编写 → 对白文本
  ↓
Phase 4.5: 配音（kais-voice）
  ↓ 角色分析 → 音色推荐 → 样本生成 → 用户审核 → 锁定映射
  ↓ 批量合成 → mp3 文件列表
  ↓
Phase 5+:  延长链使用 prebindAudio() 切割 TTS 段
Phase 8:   后期合成 TTS + BGM + 视频
```
