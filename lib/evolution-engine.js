// Evolution Engine - V3 Crew Evolutionary Core
// Pure Node.js, zero external dependencies

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const MUTATION_STRATEGIES = ['conservative', 'radical', 'reversal', 'micro', 'archetype'];

export class EvolutionEngine {
  #population = [];
  #generation = 0;
  #fitnessHistory = [];
  #converged = false;
  #convergenceThreshold;
  #maxPopulation;
  #mutationRate;
  #selectionStrategy;

  constructor(config = {}) {
    this.#maxPopulation = config.maxPopulation ?? 20;
    this.#mutationRate = config.mutationRate ?? 0.3;
    this.#selectionStrategy = config.selectionStrategy ?? 'tournament';
    this.#convergenceThreshold = config.convergenceThreshold ?? 3;
  }

  // --- Population Management ---

  createPopulation(artifacts) {
    this.#population = artifacts.slice(0, this.#maxPopulation).map((a, i) => ({
      id: `artifact-${i}-${Date.now()}`,
      ...a,
      fitness: 0,
      generation: this.#generation,
    }));
    return this.#population;
  }

  getPopulation() {
    return [...this.#population];
  }

  evaluateFitness(artifacts) {
    // artifacts: array of { id, score } — score 0-100
    for (const item of artifacts) {
      const member = this.#population.find(p => p.id === item.id);
      if (member) member.fitness = item.score ?? 0;
    }
    const scores = this.#population.map(p => p.fitness);
    this.#fitnessHistory.push({ generation: this.#generation, avg: avg(scores), max: Math.max(...scores), min: Math.min(...scores) });
    return this.#population.map(p => ({ id: p.id, fitness: p.fitness }));
  }

  // --- Selection Strategies ---

  tournamentSelect(scores, k = 2) {
    // scores: { id, fitness }[]
    const pool = scores.length ? scores : this.#population.map(p => ({ id: p.id, fitness: p.fitness }));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const contenders = shuffled.slice(0, k);
    contenders.sort((a, b) => b.fitness - a.fitness);
    return contenders[0];
  }

  directorSelect(candidateIds) {
    // Returns candidates marked for human approval
    const candidates = this.#population.filter(p => candidateIds.includes(p.id));
    return candidates.map(c => ({ ...c, status: 'pending_review' }));
  }

  autoSelect(scores, threshold = 60) {
    return scores.filter(s => s.fitness >= threshold);
  }

  // --- Genetic Operations ---

  crossover(parentA, parentB) {
    if (!parentA || !parentB) return null;
    const keys = new Set([...Object.keys(parentA), ...Object.keys(parentB)]);
    const child = {};
    for (const key of keys) {
      child[key] = Math.random() < 0.5 ? parentA[key] : parentB[key];
    }
    child.id = `artifact-${this.#generation}-${Date.now()}`;
    child.generation = this.#generation + 1;
    child.fitness = 0;
    return child;
  }

  mutate(artifact, strategy = 'conservative') {
    const clone = structuredClone(artifact);
    clone.id = `artifact-${this.#generation}-mut-${Date.now()}`;
    clone.generation = this.#generation + 1;
    clone.mutation = strategy;

    const mutators = {
      conservative: (obj) => {
        // Small tweaks to numeric/string fields
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'number' && k !== 'fitness') {
            obj[k] = v + (Math.random() - 0.5) * v * 0.1;
          } else if (typeof v === 'string' && v.length > 5 && k !== 'id') {
            // Slight word substitution hint
            obj[k] = v; // placeholder — actual content mutation done by skill
            obj._mutated = true;
          }
        }
        return obj;
      },
      radical: (obj) => {
        obj._radical = true;
        return obj;
      },
      reversal: (obj) => {
        obj._reversal = true;
        return obj;
      },
      micro: (obj) => {
        obj._micro = true;
        return obj;
      },
      archetype: (obj) => {
        obj._archetype = true;
        return obj;
      },
    };

    return (mutators[strategy] || mutators.conservative)(clone);
  }

  // --- Convergence Control ---

  checkConvergence(generations, threshold) {
    const recent = this.#fitnessHistory.slice(-threshold);
    if (recent.length < threshold) return false;
    const avgRange = recent.map(r => r.max - r.min);
    const avgSpread = avg(avgRange);
    this.#converged = avgSpread < 5; // converged if spread < 5 points
    return this.#converged;
  }

  getConvergenceStatus() {
    const history = this.#fitnessHistory;
    return {
      generation: this.#generation,
      converged: this.#converged,
      history,
      populationSize: this.#population.length,
    };
  }

  // --- State Persistence ---

  saveState(filepath) {
    const state = {
      population: this.#population,
      generation: this.#generation,
      fitnessHistory: this.#fitnessHistory,
      converged: this.#converged,
    };
    writeFileSync(filepath, JSON.stringify(state, null, 2));
    return true;
  }

  loadState(filepath) {
    if (!existsSync(filepath)) return false;
    const state = JSON.parse(readFileSync(filepath, 'utf-8'));
    this.#population = state.population ?? [];
    this.#generation = state.generation ?? 0;
    this.#fitnessHistory = state.fitnessHistory ?? [];
    this.#converged = state.converged ?? false;
    return true;
  }
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
