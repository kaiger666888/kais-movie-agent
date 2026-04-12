// prompt-validator.js — 生图前 AI 预检模块
// 在调用即梦 API 生图之前，用视觉模型检查 prompt 和参考图是否符合生成目标

const SYSTEM_PROMPT = `You are an AI image generation prompt quality reviewer for the Jimeng (即梦) API. Your task is to evaluate whether a prompt and optional reference images are suitable for image generation.

Rate each dimension (1-10) and list specific issues:

1. **prompt_quality**: Is the prompt well-written for Jimeng?
   - English preferred (Jimeng works best with English prompts)
   - Sufficient visual detail (scene/lighting/composition/color palette)
   - No contradictory descriptions (e.g. "bright" AND "dark")
   - No unsupported directives

2. **reference_alignment**: Do reference images match the prompt?
   - Content consistency between images and prompt
   - Style alignment with expected style
   - If no reference images provided, score 10 by default

3. **goal_alignment**: Does the prompt serve the generation goal?
   - Content relevance to the stated goal
   - Aspect ratio and style match requirements

Output ONLY valid JSON (no markdown fences):
{
  "prompt_quality": {"score": 8, "issues": []},
  "reference_alignment": {"score": 9, "issues": []},
  "goal_alignment": {"score": 7, "issues": ["..."]},
  "total_score": 8,
  "passed": true,
  "suggestion": "..."
}

Rules:
- total_score = round average of the 3 dimension scores
- passed = total_score >= 7
- If no reference images, set reference_alignment.score to 10 with empty issues
- Keep suggestion concise (one sentence) or null if passed
- List all issues found, even minor ones`;

const FIX_SYSTEM_PROMPT = `You are an AI prompt optimizer for the Jimeng (即梦) image generation API. Given a prompt and a list of issues, fix the prompt to address each issue.

Rules:
- Output ONLY the fixed prompt text (no explanation, no JSON, no quotes)
- Keep the same language (prefer English for Jimeng)
- Preserve the original intent and style
- Add visual details if the prompt lacks specificity
- Remove contradictions
- Keep the prompt under 500 words`;

const PASS_THRESHOLD = 7;
const MAX_FIX_ROUNDS = 2;
const TIMEOUT_MS = 30_000;

export class PromptValidator {
  constructor(options = {}) {
    this.model = options.model || 'glm-4.6v';
    this.baseUrl = (options.openaiBaseUrl || 'http://localhost:11434/v1').replace(/\/$/, '');
    this.apiKey = options.openaiApiKey || 'ollama';
  }

  /** Call OpenAI-compatible chat completions API */
  async _chat(systemPrompt, userContent) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: 1024
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    } finally {
      clearTimeout(timer);
    }
  }

  /** Build user content array with optional reference images */
  _buildUserContent(prompt, referenceImages, options) {
    const parts = [];

    // Reference images
    if (referenceImages?.length) {
      for (const img of referenceImages) {
        if (img.startsWith('http://') || img.startsWith('https://')) {
          parts.push({ type: 'image_url', image_url: { url: img } });
        } else {
          // Assume base64
          const b64 = img.includes(',') ? img : `data:image/png;base64,${img}`;
          parts.push({ type: 'image_url', image_url: { url: b64 } });
        }
      }
    }

    // Text context
    const lines = [`Prompt to evaluate:\n${prompt}`];
    if (options.goal) lines.push(`\nGeneration goal: ${options.goal}`);
    if (options.style) lines.push(`Expected style: ${options.style}`);
    if (options.ratio) lines.push(`Expected aspect ratio: ${options.ratio}`);

    parts.push({ type: 'text', text: lines.join('\n') });
    return parts;
  }

  /** Parse JSON from model output, tolerating markdown fences */
  _parseJSON(text) {
    // Strip markdown code fences if present
    let cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  }

  /** Core validation — returns structured result */
  async validate(prompt, referenceImages = [], options = {}) {
    // Pure code checks (no AI needed)
    const codeIssues = [];
    if (options.ratio && typeof options.ratio !== 'string') {
      codeIssues.push(`Invalid ratio: ${options.ratio}`);
    }

    try {
      const userContent = this._buildUserContent(prompt, referenceImages, options);
      const raw = await this._chat(SYSTEM_PROMPT, userContent);
      const result = this._parseJSON(raw);

      // Merge code-level issues
      if (codeIssues.length) {
        result.prompt_quality.issues.push(...codeIssues);
      }

      // Ensure reference_alignment defaults if no images
      if (!referenceImages?.length) {
        result.reference_alignment = result.reference_alignment || { score: 10, issues: [] };
        result.reference_alignment.score = 10;
        result.reference_alignment.issues = [];
      }

      // Recompute total
      const scores = [
        result.prompt_quality?.score || 5,
        result.reference_alignment?.score || 5,
        result.goal_alignment?.score || 5
      ];
      result.total_score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      result.passed = result.total_score >= PASS_THRESHOLD;

      const allIssues = [
        ...(result.prompt_quality?.issues || []),
        ...(result.reference_alignment?.issues || []),
        ...(result.goal_alignment?.issues || [])
      ];

      return {
        passed: result.passed,
        score: result.total_score,
        issues: allIssues,
        suggestion: result.suggestion || null,
        details: {
          prompt_quality: result.prompt_quality?.score || 5,
          reference_alignment: result.reference_alignment?.score || 5,
          goal_alignment: result.goal_alignment?.score || 5
        }
      };
    } catch (err) {
      // API failure — don't block the pipeline
      console.warn(`[PromptValidator] API call failed, defaulting to pass: ${err.message}`);
      return {
        passed: true,
        score: 7,
        issues: codeIssues,
        suggestion: null,
        details: { prompt_quality: 7, reference_alignment: 7, goal_alignment: 7 }
      };
    }
  }

  /** Auto-fix prompt based on issues */
  async fix(prompt, issues, options = {}) {
    if (!issues?.length) return prompt;

    const fixRequest = `Fix the following prompt to address these issues:\n\n` +
      `Prompt:\n${prompt}\n\n` +
      `Issues:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\n` +
      (options.style ? `Style: ${options.style}\n` : '') +
      (options.ratio ? `Ratio: ${options.ratio}\n` : '') +
      `Output ONLY the improved prompt.`;

    try {
      const fixed = await this._chat(FIX_SYSTEM_PROMPT, fixRequest);
      return fixed.trim() || prompt;
    } catch (err) {
      console.warn(`[PromptValidator] Fix failed, returning original: ${err.message}`);
      return prompt;
    }
  }

  /** Full preflight: validate → fix if needed → re-validate */
  async preflight(prompt, referenceImages = [], options = {}) {
    const originalPrompt = prompt;
    let currentPrompt = prompt;
    let result = await this.validate(currentPrompt, referenceImages, options);
    let fixRounds = 0;

    while (!result.passed && fixRounds < MAX_FIX_ROUNDS) {
      fixRounds++;
      console.log(`[PromptValidator] Fix round ${fixRounds}: ${result.issues.join('; ')}`);

      currentPrompt = await this.fix(currentPrompt, result.issues, options);
      if (currentPrompt === prompt && fixRounds === 1) break; // Fix returned unchanged

      result = await this.validate(currentPrompt, referenceImages, options);
      if (result.passed) break;
    }

    if (!result.passed && fixRounds >= MAX_FIX_ROUNDS) {
      console.warn(`[PromptValidator] Max fix rounds reached, proceeding with best effort prompt`);
    }

    return {
      passed: result.passed,
      originalPrompt,
      finalPrompt: currentPrompt,
      score: result.score,
      details: result.details,
      issues: result.issues,
      suggestion: result.suggestion,
      fixRounds
    };
  }
}
