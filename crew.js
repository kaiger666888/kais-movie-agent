// crew.js — kais-pilot 编排文件 (V3 Movie Pipeline)
// 单步执行，每步完成后报告状态

export default {
  id: "kais-aigc-movie-v3",
  name: "AI 短片制作 V3",
  version: "3.0.0",

  steps: [
    {
      id: "topic",
      name: "选题分析",
      skill: "kais-topic-selector",
      input: [],
      output: "concept.json",
      prompt: "根据用户主题进行选题分析，输出 ConceptArtifact 格式的 JSON。",
    },
    {
      id: "outline",
      name: "故事大纲",
      skill: "kais-story-outline",
      input: ["concept.json"],
      output: "story.json",
      prompt: "基于 concept.json 生成故事大纲，输出 StoryDNA 格式。",
    },
    {
      id: "art-direction",
      name: "美术方向",
      skill: "kais-art-direction",
      input: ["concept.json", "story.json"],
      output: "art-direction.json",
      prompt: "基于选题和故事确定全局美术风格，输出 ArtDirection 格式。此步骤为全局风格锁。",
    },
    {
      id: "characters",
      name: "角色设计",
      skill: "kais-character-designer",
      input: ["concept.json", "story.json", "art-direction.json"],
      output: "characters.json",
      prompt: "基于故事和美术方向设计角色，输出 CharacterBible[] 格式。",
    },
    {
      id: "scenes",
      name: "场景设计",
      skill: "kais-scene-designer",
      input: ["concept.json", "story.json", "art-direction.json", "characters.json"],
      output: "scenes.json",
      prompt: "基于故事和角色设计场景布局，输出 SceneDesign[] 格式。",
    },
    {
      id: "scenario",
      name: "剧本写作",
      skill: "kais-scenario-writer",
      input: ["story.json", "characters.json", "scenes.json", "art-direction.json"],
      output: "scenario.json",
      prompt: "基于故事、角色和场景编写完整剧本，输出 ScenarioScript 格式。",
    },
    {
      id: "storyboard",
      name: "分镜设计",
      skill: "kais-storyboard-designer",
      input: ["scenario.json", "characters.json", "scenes.json", "art-direction.json"],
      output: "storyboard.json",
      prompt: "基于剧本和场景设计分镜，输出 Storyboard 格式（含每个镜头的画面描述）。",
    },
    {
      id: "shooting-script",
      name: "拍摄脚本",
      skill: "kais-shooting-script",
      input: ["storyboard.json", "art-direction.json", "characters.json"],
      output: "shooting-script.json",
      prompt: "将分镜转化为可执行的拍摄脚本，输出 ShootingScript 格式（含 prompt、seed、ratio）。",
    },
    {
      id: "production",
      name: "素材生产",
      skill: null,
      input: ["shooting-script.json", "art-direction.json"],
      output: "production.json",
      prompt: "调用 dreamina CLI 为每个镜头生成图片素材。",
    },
    {
      id: "post",
      name: "后期合成",
      skill: null,
      input: ["production.json"],
      output: "final.json",
      prompt: "使用 ffmpeg 拼接所有视频片段为最终成片。",
    },
  ],

  // 项目配置
  config: {
    popSize: 1,
    defaultShots: 8,
    defaultDuration: 50,
    defaultRatio: "9:16",
    workdir: "/tmp/crew-v3-build",
  },

  // 执行命令模板
  commands: {
    run: "node /tmp/crew-v3-build/pipeline.mjs run <topic>",
    complete: "node /tmp/crew-v3-build/pipeline.mjs complete <projectId>",
    resume: "node /tmp/crew-v3-build/pipeline.mjs resume",
    status: "node /tmp/crew-v3-build/pipeline.mjs status",
    list: "node /tmp/crew-v3-build/pipeline.mjs list",
  },
};
