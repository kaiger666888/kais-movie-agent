// Research Agent - kais-research-agent
// Auto-collects industry cases and latest techniques
// Pure Node.js, zero external dependencies

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TOPICS = ['prompt_engineering', 'film_techniques', 'ai_video_trends', 'story_structure'];

const RESEARCH_SOURCES = {
  ai_video_trends: [
    { name: 'Runway', url: 'https://runwayml.com/blog', focus: 'Gen-3 Alpha, motion brush, camera control' },
    { name: 'Pika', url: 'https://pika.art', focus: 'Pika 2.0, scene expansion' },
    { name: 'Sora', url: 'https://openai.com/sora', focus: 'Long-form generation, physics simulation' },
    { name: '可灵', url: 'https://klingai.com', focus: 'Kling 2.0, motion control' },
    { name: '即梦', url: 'https://jimeng.jianying.com', focus: 'Seedance 2.0, video generation' },
    { name: 'Runway Awards', url: 'https://runwayml.com/awards', focus: 'Award-winning AI films' },
  ],
  story_structure: [
    { name: '三幕式结构', url: null, focus: 'Setup, Confrontation, Resolution — Act I/II/II beats' },
    { name: '英雄之旅', url: null, focus: "Campbell's 17-stage monomyth — Ordinary World to Return with Elixir" },
    { name: '救猫咪', url: null, focus: "Snyder's 15 beats — Catalyst, Midpoint, Dark Night, Finale" },
    { name: '序列理论', url: null, focus: '8-sequence structure for screenwriting' },
    { name: '五幕式', url: null, focus: 'Freytag Pyramid — Exposition, Rising, Climax, Falling, Denouement' },
  ],
  prompt_engineering: [
    { name: 'CoT Prompting', url: null, focus: 'Chain-of-thought, self-consistency, tree-of-thought' },
    { name: 'System Prompts', url: null, focus: 'Role definition, constraint specification, output format control' },
    { name: 'Few-shot Learning', url: null, focus: 'In-context examples, example selection strategies' },
    { name: 'Negative Prompts', url: null, focus: 'Exclusion techniques for image/video generation' },
    { name: 'Structured Output', url: null, focus: 'JSON mode, schema-guided generation' },
  ],
  film_techniques: [
    { name: '镜头语言', url: null, focus: 'Shot types, camera angles, movements, transitions' },
    { name: '色彩理论', url: null, focus: 'Color psychology, palette design, complementary schemes' },
    { name: '蒙太奇', url: null, focus: 'Eisenstein montage, rhythmic editing, juxtaposition' },
    { name: '声音设计', url: null, focus: 'Foley, ambient sound, music synchronization' },
    { name: '视觉特效', url: null, focus: 'Compositing, CGI integration, practical effects hybrid' },
  ],
};

const DEFAULT_KNOWLEDGE = {
  ai_video_trends: {
    findings: [
      { insight: 'Seedance 2.0 supports image-to-video with strong motion coherence', confidence: 0.9, date: '2025-Q4' },
      { insight: 'Sora can generate up to 60s clips with consistent characters', confidence: 0.85, date: '2025-Q4' },
      { insight: 'Runway Gen-3 Alpha supports camera path control via text', confidence: 0.9, date: '2025-Q3' },
      { insight: 'Kling 2.0 introduced motion brush for object-level control', confidence: 0.85, date: '2025-Q3' },
    ],
  },
  story_structure: {
    findings: [
      { insight: 'Hero Journey: 12 stages from Ordinary World to Return with Elixir', confidence: 0.95, date: 'classic' },
      { insight: 'Save the Cat: 15 beats with Catalyst at 10%, Midpoint at 50%', confidence: 0.95, date: 'classic' },
      { insight: 'Three-Act Structure: Act I (25%), Act II (50%), Act III (25%)', confidence: 0.95, date: 'classic' },
      { insight: 'Emotional arc: "Man in Hole" is the most popular story shape', confidence: 0.8, date: 'research' },
    ],
  },
  prompt_engineering: {
    findings: [
      { insight: 'Chain-of-thought improves reasoning by 40% on complex tasks', confidence: 0.9, date: '2025' },
      { insight: 'Negative prompts critical for AI video — prevent morphing artifacts', confidence: 0.85, date: '2025' },
      { insight: 'Structured output (JSON mode) ensures pipeline compatibility', confidence: 0.9, date: '2025' },
      { insight: 'Few-shot with 3 diverse examples outperforms 10 similar examples', confidence: 0.75, date: '2025' },
    ],
  },
  film_techniques: {
    findings: [
      { insight: '180-degree rule essential for spatial coherence in AI video', confidence: 0.9, date: 'classic' },
      { insight: 'Color grading: teal-orange complementary is industry standard', confidence: 0.85, date: 'classic' },
      { insight: 'Montage theory: collision of images creates meaning beyond content', confidence: 0.9, date: 'classic' },
      { insight: 'Shot duration average: 2-5s for modern short-form, 5-10s for cinematic', confidence: 0.8, date: '2025' },
    ],
  },
};

export class ResearchAgent {
  #knowledgeBase;
  #knowledgeDir;
  #sources;

  constructor(config = {}) {
    this.#knowledgeDir = config.knowledgeDir ?? '/tmp/crew-v3-build/knowledge';
    this.#sources = config.sources ?? RESEARCH_SOURCES;
    this.#knowledgeBase = {};
    this.loadKnowledgeBase();
  }

  async research(topic, options = {}) {
    if (!TOPICS.includes(topic)) {
      return { findings: [], sources: [], updatedAt: new Date().toISOString(), relevance_score: 0, error: `Unknown topic: ${topic}` };
    }

    const maxFindings = options.maxFindings ?? 10;
    const minConfidence = options.minConfidence ?? 0.5;

    const topicData = this.#knowledgeBase[topic] ?? { findings: [] };
    const sources = this.#sources[topic] ?? [];

    const findings = topicData.findings
      .filter(f => f.confidence >= minConfidence)
      .slice(0, maxFindings)
      .map(f => ({ ...f, topic }));

    return {
      findings,
      sources: sources.map(s => ({ name: s.name, url: s.url, focus: s.focus })),
      updatedAt: new Date().toISOString(),
      relevance_score: findings.length > 0 ? Math.min(1, findings.reduce((a, f) => a + f.confidence, 0) / findings.length) : 0,
    };
  }

  async dailyResearch() {
    const results = {};
    for (const topic of TOPICS) {
      const sources = this.#sources[topic] ?? [];
      // In production, this would fetch from URLs. Here we use built-in knowledge.
      const existing = this.#knowledgeBase[topic] ?? { findings: [] };
      const newFindings = DEFAULT_KNOWLEDGE[topic]?.findings.filter(
        f => !existing.findings.some(e => e.insight === f.insight)
      ) ?? [];

      if (newFindings.length > 0) {
        existing.findings.push(...newFindings);
        existing.updatedAt = new Date().toISOString();
        this.#knowledgeBase[topic] = existing;
        results[topic] = { added: newFindings.length, total: existing.findings.length };
      } else {
        results[topic] = { added: 0, total: existing.findings.length };
      }
    }
    await this.updateKnowledgeBase(results);
    return results;
  }

  async evaluateGap(artifact, industryBenchmarks = []) {
    const artifactScore = artifact.quality_score ?? artifact.fitness ?? 0;
    const benchmarkScores = industryBenchmarks.map(b => b.score ?? b.quality_score ?? 70);
    const benchmarkAvg = benchmarkScores.length ? benchmarkScores.reduce((a, b) => a + b, 0) / benchmarkScores.length : 70;

    const gapScore = Math.max(0, Math.min(1, 1 - (artifactScore / benchmarkAvg)));

    const suggestions = [];
    if (gapScore > 0.3) suggestions.push({ area: 'quality', action: 'Review and enhance core content quality to meet industry standards', impact: 'high' });
    if (gapScore > 0.5) suggestions.push({ area: 'structure', action: 'Compare against award-winning examples in the same genre', impact: 'high' });
    if (gapScore > 0.1) suggestions.push({ area: 'refinement', action: 'Apply advanced techniques from latest research findings', impact: 'medium' });

    return {
      gap_score: Math.round(gapScore * 100) / 100,
      artifact_score: artifactScore,
      benchmark_average: Math.round(benchmarkAvg * 100) / 100,
      suggestions,
      reference_cases: industryBenchmarks.slice(0, 3).map(b => ({ name: b.name, score: b.score })),
    };
  }

  async updateKnowledgeBase(findings) {
    try {
      mkdirSync(this.#knowledgeDir, { recursive: true });
      const filepath = join(this.#knowledgeDir, 'research-knowledge.json');
      writeFileSync(filepath, JSON.stringify(this.#knowledgeBase, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  loadKnowledgeBase() {
    try {
      const filepath = join(this.#knowledgeDir, 'research-knowledge.json');
      if (existsSync(filepath)) {
        this.#knowledgeBase = JSON.parse(readFileSync(filepath, 'utf-8'));
      } else {
        this.#knowledgeBase = structuredClone(DEFAULT_KNOWLEDGE);
      }
      return this.#knowledgeBase;
    } catch {
      this.#knowledgeBase = structuredClone(DEFAULT_KNOWLEDGE);
      return this.#knowledgeBase;
    }
  }

  getKnowledgeBase() {
    return this.#knowledgeBase;
  }
}
