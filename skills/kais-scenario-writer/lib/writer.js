/**
 * kais-scenario-writer — A/B variant scenario script generator & evaluator
 * ES Module
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, '../prompts/scenario-writer.md');

/**
 * Load prompt templates
 */
function loadTemplates() {
  const content = readFileSync(PROMPT_PATH, 'utf-8');
  const sections = content.split(/^## Variant/m);
  return {
    A: sections[1]?.split(/^---/m)[0]?.trim() || '',
    B: sections[2]?.split(/^---/m)[0]?.trim() || '',
  };
}

/**
 * Fill template variables
 */
function fillTemplate(template, vars) {
  return template
    .replace(/\{logline\}/g, vars.logline || '')
    .replace(/\{characters\}/g, vars.characters || '')
    .replace(/\{beats\}/g, vars.beats || '')
    .replace(/\{style\}/g, vars.style || '')
    .replace(/\{duration\}/g, String(vars.duration || 180))
    .replace(/\{theme\}/g, vars.theme || '');
}

/**
 * Generate Variant A (Comedic)
 * @param {object} storyDNA - StoryDNA artifact
 * @returns {string} Prompt for comedic variant
 */
export function generateVariantA(storyDNA) {
  const templates = loadTemplates();
  const beatsStr = storyDNA.beats
    ?.sort((a, b) => a.sequence - b.sequence)
    .map((b, i) => `${i + 1}. [${b.name}] ${b.description} (情感: ${b.emotional_arc || '—'})`)
    .join('\n') || '';

  const charsStr = Array.isArray(storyDNA.characters)
    ? storyDNA.characters.map(c => typeof c === 'string' ? c : `${c.name}: ${c.personality || ''}`).join('\n')
    : String(storyDNA.characters || '');

  return fillTemplate(templates.A, {
    logline: storyDNA.logline,
    characters: charsStr,
    beats: beatsStr,
    style: 'A_comedic',
    duration: storyDNA.estimated_duration,
    theme: storyDNA.theme,
  });
}

/**
 * Generate Variant B (Dramatic)
 * @param {object} storyDNA - StoryDNA artifact
 * @returns {string} Prompt for dramatic variant
 */
export function generateVariantB(storyDNA) {
  const templates = loadTemplates();
  const beatsStr = storyDNA.beats
    ?.sort((a, b) => a.sequence - b.sequence)
    .map((b, i) => `${i + 1}. [${b.name}] ${b.description} (情感弧线: ${b.emotional_arc || '—'})`)
    .join('\n') || '';

  const charsStr = Array.isArray(storyDNA.characters)
    ? storyDNA.characters.map(c => typeof c === 'string' ? c : `${c.name}: ${c.personality || ''}`).join('\n')
    : String(storyDNA.characters || '');

  return fillTemplate(templates.B, {
    logline: storyDNA.logline,
    characters: charsStr,
    beats: beatsStr,
    style: 'B_dramatic',
    duration: storyDNA.estimated_duration,
    theme: storyDNA.theme,
  });
}

/**
 * Evaluate a ScenarioScript across 5 dimensions
 * @param {object} script - ScenarioScript artifact
 * @returns {object} Evaluation scores
 */
export function evaluate(script) {
  if (!script || !script.scenes) {
    return { error: 'Invalid ScenarioScript: missing scenes' };
  }

  const scenes = script.scenes;
  const totalScenes = scenes.length;
  const totalActions = scenes.reduce((sum, s) => sum + (s.actions?.length || 0), 0);
  const dialogues = scenes.flatMap(s => s.actions || []).filter(a => a.dialogue);

  // 1. Rhythm (节奏感) — based on scene count vs duration, beat coverage
  const avgSceneDuration = script.total_duration_sec / totalScenes;
  const rhythmScore = (avgSceneDuration >= 15 && avgSceneDuration <= 60) ? 8.5
    : (avgSceneDuration < 15 ? 6.0 : 7.0);

  // 2. Character consistency (角色一致性) — heuristic: character presence across scenes
  const charSet = new Set(dialogues.map(d => d.character));
  const charCoverage = totalScenes > 0 ? charSet.size / Math.max(totalScenes, 1) : 0;
  const consistencyScore = Math.min(10, 5 + charCoverage * 10);

  // 3. Emotional tension (情感张力) — based on dialogue density and parenthetical usage
  const tensionActions = scenes.flatMap(s => s.actions || []).filter(a => a.parenthetical);
  const tensionScore = Math.min(10, 5 + (tensionActions.length / Math.max(dialogues.length, 1)) * 10);

  // 4. Dialogue naturalness (对白自然度) — heuristic: avg dialogue length
  const avgDialogueLen = dialogues.length > 0
    ? dialogues.reduce((s, d) => s + d.dialogue.length, 0) / dialogues.length : 0;
  const naturalnessScore = (avgDialogueLen >= 5 && avgDialogueLen <= 50) ? 8.5
    : (avgDialogueLen < 5 ? 6.5 : 7.0);

  // 5. Theme alignment (主题契合度) — placeholder, would need LLM for real eval
  const themeScore = 7.5;

  const weights = { rhythm: 0.25, character_consistency: 0.25, emotional_tension: 0.20, dialogue_naturalness: 0.15, theme_alignment: 0.15 };
  const overall = rhythmScore * weights.rhythm
    + consistencyScore * weights.character_consistency
    + tensionScore * weights.emotional_tension
    + naturalnessScore * weights.dialogue_naturalness
    + themeScore * weights.theme_alignment;

  return {
    rhythm: Math.round(rhythmScore * 10) / 10,
    character_consistency: Math.round(consistencyScore * 10) / 10,
    emotional_tension: Math.round(tensionScore * 10) / 10,
    dialogue_naturalness: Math.round(naturalnessScore * 10) / 10,
    theme_alignment: themeScore,
    overall: Math.round(overall * 100) / 100,
    needs_rewrite: overall < 7.0,
  };
}
