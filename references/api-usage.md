# API 完整用法参考

## Pipeline 管线编排器

```js
import { Pipeline } from './lib/pipeline.js';

const pipeline = new Pipeline({
  workdir: '/path/to/project',
  episode: 'EP01',
  config: { title: '短片', genre: '科幻', duration_sec: 60, characters: [...] },
  onPhaseComplete: (phase, result) => { ... },
  onPhaseFail: (phase, error) => { ... },
});

// 执行全部
const result = await pipeline.run();

// 从断点恢复
const result2 = await pipeline.resume('character');

// 只执行某个阶段
const result3 = await pipeline.runPhase('camera', { execute: async (p, phase) => { ... } });
```

## PostProduction 后期合成

```js
import { PostProduction } from './lib/post-production.js';

const post = new PostProduction({ workdir, episode });

// 一站式后期
const result = await post.run({
  dialogueLines: [{ text: '你好', start_time: 0, end_time: 2, speaker: '角色A' }],
  videoPath: 'output/rough_cut.mp4',
  ttsDir: 'assets/tts/',
  bgmPath: 'assets/bgm/bgm.mp3',
  burnSubtitles: false,
});
```

## BGM 选择

```js
import { selectBGMStyle, generateBGMPrompt } from './lib/bgm-selector.js';

// 根据场景情感推荐 BGM
const recommendations = selectBGMStyle('英雄站在山顶', '史诗', 30);

// 生成音乐 AI 提示词
const prompt = generateBGMPrompt('追逐场景', '紧张', 20);
```

## Git Stage Manager CLI

```bash
node lib/git-stage-manager.js init <workdir>              # 初始化
node lib/git-stage-manager.js checkpoint <workdir> <phase> # 手动 checkpoint
node lib/git-stage-manager.js log <workdir>               # 查看历史
node lib/git-stage-manager.js rollback <workdir> <phase>   # 回滚
node lib/git-stage-manager.js diff <workdir> <A> <B>       # 比较
node lib/git-stage-manager.js current <workdir>            # 当前阶段
node lib/git-stage-manager.js stages                       # 列出所有阶段
```
