// Convergence Agent - kais-convergence-agent
// Arbitrates whether evolution should stop or continue
// Pure Node.js, zero external dependencies

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export class ConvergenceAgent {
  #maxGenerations;
  #maxBudget;
  #stagnationLimit;
  #targetScore;
  #history = [];

  constructor(config = {}) {
    this.#maxGenerations = config.maxGenerations ?? 20;
    this.#maxBudget = config.maxBudget ?? Infinity;
    this.#stagnationLimit = config.stagnationLimit ?? 5;
    this.#targetScore = config.targetScore ?? 8.0;
  }

  /**
   * Hard stop conditions — MUST stop when any is true
   */
  checkHardStop(evolutionState) {
    const { generation, fitness_scores, budget_spent, director_stop } = evolutionState;

    if (director_stop) {
      return { should_stop: true, reason: 'director_terminate', confidence: 1.0, is_hard: true };
    }

    if (generation >= this.#maxGenerations) {
      return { should_stop: true, reason: 'max_generations_reached', confidence: 1.0, is_hard: true, detail: `Generation ${generation} >= ${this.#maxGenerations}` };
    }

    if (budget_spent !== undefined && budget_spent >= this.#maxBudget) {
      return { should_stop: true, reason: 'budget_exhausted', confidence: 1.0, is_hard: true };
    }

    return { should_stop: false, reason: null, confidence: 0, is_hard: true };
  }

  /**
   * Soft stop conditions — RECOMMEND stopping
   */
  checkSoftStop(evolutionState, criticEvaluation) {
    const { generation, fitness_scores, deadline } = evolutionState;
    const scores = fitness_scores ?? [];

    // Track history for stagnation detection
    if (scores.length > 0) {
      this.#history.push({ generation, max: Math.max(...scores), avg: avg(scores) });
    }

    // Check stagnation: no significant improvement in N generations
    if (this.#history.length >= this.#stagnationLimit) {
      const recent = this.#history.slice(-this.#stagnationLimit);
      const maxScores = recent.map(h => h.max);
      const variance = stdDev(maxScores);

      if (variance < 1.0) {
        return {
          should_stop: true,
          reason: 'stagnation',
          confidence: 0.8,
          is_hard: false,
          detail: `Variance of top scores over ${this.#stagnationLimit} generations: ${variance.toFixed(2)} < 1.0`,
        };
      }
    }

    // Check if target score reached
    if (scores.length > 0 && Math.max(...scores) >= this.#targetScore) {
      return {
        should_stop: true,
        reason: 'target_score_reached',
        confidence: 0.9,
        is_hard: false,
        detail: `Top score ${Math.max(...scores)} >= target ${this.#targetScore}`,
      };
    }

    // Check deadline: 80% of time used
    if (deadline) {
      const now = Date.now();
      const total = new Date(deadline).getTime() - (evolutionState.start_time ? new Date(evolutionState.start_time).getTime() : now);
      const elapsed = now - (evolutionState.start_time ? new Date(evolutionState.start_time).getTime() : now);
      if (total > 0 && elapsed / total >= 0.8) {
        return {
          should_stop: true,
          reason: 'deadline_approaching',
          confidence: 0.7,
          is_hard: false,
          detail: `Used ${Math.round(elapsed / total * 100)}% of available time`,
        };
      }
    }

    // Critic suggests quality is good enough
    if (criticEvaluation && criticEvaluation.overall >= this.#targetScore) {
      return {
        should_stop: true,
        reason: 'critic_approval',
        confidence: 0.75,
        is_hard: false,
        detail: `Critic overall score: ${criticEvaluation.overall}`,
      };
    }

    return { should_stop: false, reason: null, confidence: 0, is_hard: false };
  }

  /**
   * Determine if current generation should be rolled back
   */
  shouldRollback(currentGen, previousGen) {
    if (!previousGen || previousGen.length === 0) return { should_rollback: false, reason: 'no_previous_data' };

    const currentScores = currentGen.fitness_scores ?? [];
    const prevScores = previousGen.fitness_scores ?? [];

    if (currentScores.length === 0) return { should_rollback: false, reason: 'no_scores' };

    const currentMax = Math.max(...currentScores);
    const prevAvg = avg(prevScores);
    const prevMax = Math.max(...prevScores);

    // Rollback if current best is significantly worse than previous average
    if (currentMax < prevAvg * 0.8) {
      return {
        should_rollback: true,
        reason: 'quality_regression',
        confidence: 0.8,
        detail: `Current best (${currentMax}) < 80% of previous average (${prevAvg.toFixed(1)})`,
      };
    }

    // Rollback if current max is much worse than previous max
    if (currentMax < prevMax * 0.7) {
      return {
        should_rollback: true,
        reason: 'peak_regression',
        confidence: 0.7,
        detail: `Current best (${currentMax}) < 70% of previous best (${prevMax})`,
      };
    }

    return { should_rollback: false, reason: null };
  }

  /**
   * Recommend the best solution from population
   */
  recommendBest(population, fitnessScores) {
    if (!population || population.length === 0) {
      return { best: null, alternatives: [], reasoning: 'empty_population' };
    }

    const scored = population.map((p, i) => ({
      artifact: p,
      fitness: fitnessScores[i] ?? p.fitness ?? 0,
      index: i,
    }));

    scored.sort((a, b) => b.fitness - a.fitness);
    const best = scored[0];
    const alternatives = scored.slice(1, 4);

    // Diversity bonus: pick alternatives that differ from best
    const fitnessRange = best.fitness - (scored[scored.length - 1]?.fitness ?? 0);
    const diversityThreshold = Math.max(0, best.fitness - fitnessRange * 0.3);

    const diverseAlternatives = alternatives
      .filter(a => a.fitness >= diversityThreshold)
      .slice(0, 3);

    // Innovation score: how much the best differs from average
    const avgFitness = avg(scored.map(s => s.fitness));
    const innovation = avgFitness > 0 ? (best.fitness - avgFitness) / avgFitness : 0;

    const reasoning = [
      `Best fitness: ${best.fitness.toFixed(1)} (avg: ${avgFitness.toFixed(1)})`,
      `Innovation gap: ${(innovation * 100).toFixed(0)}% above average`,
      diverseAlternatives.length > 0
        ? `${diverseAlternatives.length} diverse alternatives within range`
        : 'No strong alternatives found',
    ].join('; ');

    return {
      best: best.artifact,
      best_score: best.fitness,
      alternatives: diverseAlternatives.map(a => ({ artifact: a.artifact, score: a.fitness })),
      reasoning,
      population_stats: {
        size: population.length,
        avg_fitness: Math.round(avgFitness * 100) / 100,
        max_fitness: best.fitness,
        min_fitness: scored[scored.length - 1]?.fitness ?? 0,
        fitness_range: Math.round(fitnessRange * 100) / 100,
      },
    };
  }

  getHistory() {
    return [...this.#history];
  }

  reset() {
    this.#history = [];
  }
}
