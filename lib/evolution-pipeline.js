// Evolution Pipeline — V3 Population-Based Evolution Controller
// Pure Node.js, zero external dependencies

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EvolutionEngine, MUTATION_STRATEGIES } from './evolution-engine.js';
import { FitnessEvaluator } from './fitness-evaluator.js';
import { PromptMutator } from './prompt-mutator.js';

// ── Layer Configuration ──

const LAYER_CONFIG = {
  text: {
    // Pop=5→3→2 high exploration
    topic:      { populationSize: 5, selection: 'tournament', maxGenerations: 3, convergenceThreshold: 2 },
    outline:    { populationSize: 3, selection: 'hierarchical', maxGenerations: 2, convergenceThreshold: 2 },
    scenario:   { populationSize: 2, selection: 'ab_test', maxGenerations: 1, convergenceThreshold: 1 },
  },
  visual: {
    // Pop=3 moderate selection
    'art-direction': { populationSize: 3, selection: 'tournament', maxGenerations: 2, convergenceThreshold: 2 },
    characters:      { populationSize: 3, selection: 'tournament', maxGenerations: 2, convergenceThreshold: 2 },
    scenes:          { populationSize: 3, selection: 'tournament', maxGenerations: 2, convergenceThreshold: 2 },
    storyboard:      { populationSize: 3, selection: 'tournament', maxGenerations: 2, convergenceThreshold: 2 },
  },
  execution: {
    // Pop=1 high convergence
    'shooting-script': { populationSize: 1, selection: 'none', maxGenerations: 0 },
    production:        { populationSize: 1, selection: 'none', maxGenerations: 0 },
    post:              { populationSize: 1, selection: 'none', maxGenerations: 0 },
  },
};

// Map step IDs to artifact types for evaluation
const STEP_TO_TYPE = {
  topic: 'concept',
  outline: 'story',
  scenario: 'story',
  'art-direction': 'art_direction',
  characters: 'character',
  scenes: 'scene',
  storyboard: 'storyboard',
};

// Steps that participate in evolution
const EVOLVABLE_STEPS = new Set([
  'topic', 'outline', 'scenario',
  'art-direction', 'characters', 'scenes', 'storyboard',
]);

/**
 * Skill executor function type
 * @typedef {function} SkillExecutor
 * @param {string} skillName
 * @param {object} input - skill input with possibly mutated prompt
 * @returns {Promise<object>} skill output artifact
 */

export class EvolutionPipeline {
  #config;
  #engine;
  #evaluator;
  #mutator;
  #skillExecutor; // function(skillName, input) => Promise<artifact>
  #stateDir;

  constructor(config = {}) {
    this.#config = {
      maxGenerations: config.maxGenerations ?? 3,
      populationSizes: config.populationSizes ?? { text: 5, visual: 3, execution: 1 },
      stateDir: config.stateDir ?? '/tmp/crew-v3-evolution',
      evaluatorConfig: config.evaluatorConfig ?? {},
    };

    this.#engine = new EvolutionEngine({
      maxPopulation: 20,
      mutationRate: 0.3,
      selectionStrategy: 'tournament',
    });

    this.#evaluator = new FitnessEvaluator(this.#config.evaluatorConfig);
    this.#mutator = new PromptMutator();
    this.#stateDir = this.#config.stateDir;
    mkdirSync(this.#stateDir, { recursive: true });
  }

  /**
   * Set the skill executor function
   * @param {SkillExecutor} fn
   */
  setSkillExecutor(fn) {
    this.#skillExecutor = fn;
  }

  /**
   * Get layer config for a step
   */
  getLayerForStep(stepId) {
    if (LAYER_CONFIG.text[stepId]) return 'text';
    if (LAYER_CONFIG.visual[stepId]) return 'visual';
    if (LAYER_CONFIG.execution[stepId]) return 'execution';
    return null;
  }

  /**
   * Check if a step supports evolution
   */
  isEvolvable(stepId) {
    return EVOLVABLE_STEPS.has(stepId);
  }

  /**
   * Get evolution config for a step
   */
  getStepConfig(stepId) {
    return LAYER_CONFIG.text[stepId]
      || LAYER_CONFIG.visual[stepId]
      || LAYER_CONFIG.execution[stepId]
      || null;
  }

  /**
   * Main evolution method — evolve a skill call
   * @param {string} skillName
   * @param {object} input - { prompt, ...otherInputs }
   * @param {object} evolutionConfig - overrides
   * @returns {Promise<object>} best artifact
   */
  async evolveSkill(skillName, input, evolutionConfig = {}) {
    const stepId = this.#skillNameToStepId(skillName);
    if (!stepId || !this.isEvolvable(stepId)) {
      // Not evolvable — just execute once
      return this.#executeOnce(skillName, input);
    }

    const stepConfig = { ...this.getStepConfig(stepId), ...evolutionConfig };
    const popSize = stepConfig.populationSize || 1;

    if (popSize <= 1) {
      return this.#executeOnce(skillName, input);
    }

    log(`Evolution: ${skillName} (pop=${popSize}, strategy=${stepConfig.selection}, maxGen=${stepConfig.maxGenerations})`);

    const artifactType = STEP_TO_TYPE[stepId] || 'concept';
    const population = [];
    const evaluations = [];
    let generation = 0;
    const maxGen = stepConfig.maxGenerations ?? this.#config.maxGenerations;

    // ── Step 1: Generate initial population ──
    log(`  Gen 0: Generating ${popSize} candidates...`);
    const basePrompt = input.prompt || JSON.stringify(input);

    for (let i = 0; i < popSize; i++) {
      let prompt = basePrompt;
      if (i > 0) {
        // Mutate prompt for diversity
        const strategy = MUTATION_STRATEGIES[i % MUTATION_STRATEGIES.length];
        prompt = this.#mutator.mutate(basePrompt, strategy, {
          topic: input.topic,
          genre: input.genre,
        });
      }

      try {
        const artifact = await this.#executeOnce(skillName, { ...input, prompt });
        population.push({ artifact, prompt, index: i, generation: 0 });
        log(`  Candidate ${i + 1}/${popSize}: generated`);
      } catch (e) {
        log(`  Candidate ${i + 1}/${popSize}: FAILED — ${e.message}`, '⚠️');
      }
    }

    if (population.length === 0) {
      throw new Error(`All candidates failed for ${skillName}`);
    }

    // ── Step 2: Evaluate fitness ──
    for (const member of population) {
      const eval_ = await this.#evaluator.evaluate(member.artifact, artifactType);
      member.fitness = eval_.total;
      member.scores = eval_.scores;
      evaluations.push(eval_);
    }

    // Log fitness
    population.sort((a, b) => b.fitness - a.fitness);
    log(`  Gen 0 fitness: ${population.map(p => `${p.fitness.toFixed(1)}`).join(', ')}`);

    // ── Evolution loop ──
    for (generation = 1; generation <= maxGen; generation++) {
      // Check convergence
      const diversity = this.#evaluator.evaluateDiversity(population);
      if (diversity < 0.1) {
        log(`  Gen ${generation}: Converged (diversity=${diversity.toFixed(3)})`, '✅');
        break;
      }

      // Selection
      const selected = this.#select(population, stepConfig.selection);
      log(`  Gen ${generation}: Selected ${selected.length}/${population.length}`);

      // Genetic operations — create next generation
      const nextGen = [];

      // Elitism: keep the best
      nextGen.push({ ...population[0], generation, index: nextGen.length });

      // Crossover + mutation
      while (nextGen.length < popSize) {
        const parentA = selected[Math.floor(Math.random() * selected.length)];
        const parentB = selected[Math.floor(Math.random() * selected.length)];

        // Crossover prompts
        let childPrompt = this.#mutator.crossover(parentA.prompt, parentB.prompt);

        // Mutate based on weakest dimension of parents
        const parentScores = { ...parentA.scores, ...parentB.scores };
        const eval_ = { scores: parentScores };
        childPrompt = this.#mutator.adaptiveMutate(childPrompt, eval_, population);

        try {
          const artifact = await this.#executeOnce(skillName, { ...input, prompt: childPrompt });
          const childEval = await this.#evaluator.evaluate(artifact, artifactType);
          nextGen.push({
            artifact,
            prompt: childPrompt,
            fitness: childEval.total,
            scores: childEval.scores,
            generation,
            index: nextGen.length,
          });
        } catch (e) {
          log(`  Gen ${generation} child: FAILED — ${e.message}`, '⚠️');
        }
      }

      // Replace population
      population.length = 0;
      population.push(...nextGen);
      population.sort((a, b) => b.fitness - a.fitness);
      log(`  Gen ${generation} fitness: ${population.map(p => `${p.fitness.toFixed(1)}`).join(', ')}`);
    }

    // ── Final selection ──
    const best = population[0];
    log(`  Winner: candidate #${best.index + 1} (fitness=${best.fitness.toFixed(1)})`, '🏆');

    // Save evolution state
    this.#saveEvolutionState(skillName, {
      population: population.map(p => ({
        index: p.index,
        fitness: p.fitness,
        scores: p.scores,
        generation: p.generation,
        promptPreview: p.prompt.slice(0, 100),
      })),
      winner: { index: best.index, fitness: best.fitness, scores: best.scores },
      generations: generation,
      artifactType,
    });

    return best.artifact;
  }

  /**
   * Run text-layer evolution (topic → outline → scenario)
   */
  async runTextEvolution(input) {
    const results = {};

    // Topic: Pop=5, tournament
    if (input.topic) {
      results.topic = await this.evolveSkill('kais-topic-selector', input, {
        populationSize: 5,
        selection: 'tournament',
        maxGenerations: 3,
      });
    }

    // Outline: Pop=3, hierarchical
    if (results.topic || input.outlineInput) {
      const outlineInput = results.topic
        ? { ...input, concept: results.topic }
        : input;
      results.outline = await this.evolveSkill('kais-story-outline', outlineInput, {
        populationSize: 3,
        selection: 'hierarchical',
        maxGenerations: 2,
      });
    }

    // Scenario: Pop=2, A/B test
    if (results.outline || input.scenarioInput) {
      const scenarioInput = results.outline
        ? { ...input, story: results.outline }
        : input;
      results.scenario = await this.evolveSkill('kais-scenario-writer', scenarioInput, {
        populationSize: 2,
        selection: 'ab_test',
        maxGenerations: 1,
      });
    }

    return results;
  }

  /**
   * Run visual-layer evolution
   */
  async runVisualEvolution(input) {
    const results = {};
    const visualSteps = ['art-direction', 'characters', 'scenes', 'storyboard'];
    const visualSkills = [
      'kais-art-direction', 'kais-character-designer',
      'kais-scene-designer', 'kais-storyboard-designer',
    ];

    for (let i = 0; i < visualSteps.length; i++) {
      const stepId = visualSteps[i];
      const skillName = visualSkills[i];
      const stepInput = { ...input, ...results };

      results[stepId] = await this.evolveSkill(skillName, stepInput, {
        populationSize: 3,
        selection: 'tournament',
        maxGenerations: 2,
      });
    }

    return results;
  }

  // ── Selection Strategies ──

  #select(population, strategy) {
    const sorted = [...population].sort((a, b) => b.fitness - a.fitness);
    const count = Math.max(1, Math.ceil(population.length / 2));

    switch (strategy) {
      case 'tournament':
        return this.#tournamentSelect(sorted, count);
      case 'hierarchical':
        return sorted.slice(0, count);
      case 'ab_test':
        return sorted.slice(0, 1); // Just pick the best
      case 'director':
        return sorted; // Return all for human review
      default:
        return sorted.slice(0, count);
    }
  }

  #tournamentSelect(sorted, count) {
    const winners = [];
    const pool = [...sorted];
    while (winners.length < count && pool.length >= 2) {
      const i1 = Math.floor(Math.random() * pool.length);
      const i2 = Math.floor(Math.random() * pool.length);
      if (i1 === i2) continue;
      const a = pool.splice(Math.max(i1, i2), 1)[0];
      const b = pool.splice(Math.min(i1, i2), 1)[0];
      winners.push(a.fitness >= b.fitness ? a : b);
    }
    if (winners.length < count && pool.length > 0) {
      winners.push(pool[0]);
    }
    return winners;
  }

  // ── State Management ──

  getEvolutionState() {
    return {
      populationSizes: this.#config.populationSizes,
      maxGenerations: this.#config.maxGenerations,
    };
  }

  #saveEvolutionState(skillName, state) {
    const filepath = join(this.#stateDir, `${skillName.replace(/\//g, '_')}.json`);
    writeFileSync(filepath, JSON.stringify({
      type: 'EvolutionState',
      version: '3.0',
      skill: skillName,
      timestamp: new Date().toISOString(),
      ...state,
    }, null, 2));
  }

  saveEvolutionState(filepath) {
    const state = this.getEvolutionState();
    writeFileSync(filepath, JSON.stringify(state, null, 2));
    return true;
  }

  loadEvolutionState(filepath) {
    if (!existsSync(filepath)) return null;
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  }

  // ── Utilities ──

  async #executeOnce(skillName, input) {
    if (!this.#skillExecutor) {
      throw new Error('No skill executor set. Use setSkillExecutor() first.');
    }
    return this.#skillExecutor(skillName, input);
  }

  #skillNameToStepId(skillName) {
    const map = {
      'kais-topic-selector': 'topic',
      'kais-story-outline': 'outline',
      'kais-scenario-writer': 'scenario',
      'kais-art-direction': 'art-direction',
      'kais-character-designer': 'characters',
      'kais-scene-designer': 'scenes',
      'kais-storyboard-designer': 'storyboard',
    };
    return map[skillName] || null;
  }
}

function log(msg, emoji = '🧬') {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}] ${emoji} [Evolution] ${msg}`);
}
