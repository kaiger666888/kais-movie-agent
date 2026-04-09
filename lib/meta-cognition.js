// Meta-Cognition Layer - V3 Unified Entry Point
// Self-evaluation, evolution decisions, and improvement suggestions
// Pure Node.js, zero external dependencies

import { ResearchAgent } from './research-agent.js';
import { CriticAgent } from './critic-agent.js';
import { ConvergenceAgent } from './convergence-agent.js';

export { ResearchAgent } from './research-agent.js';
export { CriticAgent } from './critic-agent.js';
export { ConvergenceAgent } from './convergence-agent.js';

export class MetaCognitionLayer {
  #research;
  #critic;
  #convergence;

  constructor(config = {}) {
    this.#research = new ResearchAgent(config.research);
    this.#critic = new CriticAgent(config.critic);
    this.#convergence = new ConvergenceAgent(config.convergence);
  }

  /**
   * One-click self-evaluation of any artifact
   * @param {object} artifact - The artifact to evaluate
   * @param {'concept'|'story'|'visual'|'storyboard'} type - Artifact type
   */
  async selfEvaluate(artifact, type) {
    let evaluation;
    switch (type) {
      case 'concept':
        evaluation = await this.#critic.evaluateConcept(artifact);
        break;
      case 'story':
        evaluation = await this.#critic.evaluateStory(artifact);
        break;
      case 'visual':
        evaluation = await this.#critic.evaluateVisual(artifact, artifact.characters ?? [], artifact.scenes ?? []);
        break;
      case 'storyboard':
        evaluation = await this.#critic.evaluateStoryboard(artifact);
        break;
      default:
        return { error: `Unknown artifact type: ${type}`, valid_types: ['concept', 'story', 'visual', 'storyboard'] };
    }

    const improvements = await this.#critic.suggestImprovements(artifact, evaluation);

    return {
      evaluation,
      improvements,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Combined evolution decision
   * @param {object} evolutionState - Current evolution state
   */
  async shouldContinueEvolution(evolutionState) {
    // Check hard stops first
    const hardStop = this.#convergence.checkHardStop(evolutionState);
    if (hardStop.should_stop) {
      return { should_continue: false, stop: hardStop, category: 'hard' };
    }

    // Check soft stops
    const softStop = this.#convergence.checkSoftStop(evolutionState, null);
    if (softStop.should_stop) {
      return { should_continue: false, stop: softStop, category: 'soft' };
    }

    // Check rollback need
    const currentGen = { fitness_scores: evolutionState.fitness_scores };
    const prevGenerations = evolutionState.history ?? [];
    const previousGen = prevGenerations.length > 0 ? prevGenerations[prevGenerations.length - 1] : null;
    const rollback = this.#convergence.shouldRollback(currentGen, previousGen);

    return {
      should_continue: true,
      stop: null,
      rollback,
      category: 'continue',
    };
  }

  /**
   * Scan all completed artifacts and generate global improvement suggestions
   * @param {object} projectManifest - The project manifest with all artifacts
   */
  async suggestImprovements(projectManifest) {
    const evaluations = [];
    const allImprovements = [];

    // Evaluate each artifact type present
    if (projectManifest.concept) {
      const eval_ = await this.#critic.evaluateConcept(projectManifest.concept);
      const imps = await this.#critic.suggestImprovements(projectManifest.concept, eval_);
      evaluations.push({ type: 'concept', ...eval_ });
      allImprovements.push(...imps.map(i => ({ ...i, scope: 'concept' })));
    }

    if (projectManifest.story) {
      const eval_ = await this.#critic.evaluateStory(projectManifest.story);
      const imps = await this.#critic.suggestImprovements(projectManifest.story, eval_);
      evaluations.push({ type: 'story', ...eval_ });
      allImprovements.push(...imps.map(i => ({ ...i, scope: 'story' })));
    }

    if (projectManifest.art_direction) {
      const eval_ = await this.#critic.evaluateVisual(
        projectManifest.art_direction,
        projectManifest.characters ?? [],
        projectManifest.scenes ?? [],
      );
      const imps = await this.#critic.suggestImprovements(projectManifest.art_direction, eval_);
      evaluations.push({ type: 'visual', ...eval_ });
      allImprovements.push(...imps.map(i => ({ ...i, scope: 'visual' })));
    }

    if (projectManifest.storyboard) {
      const eval_ = await this.#critic.evaluateStoryboard(projectManifest.storyboard);
      const imps = await this.#critic.suggestImprovements(projectManifest.storyboard, eval_);
      evaluations.push({ type: 'storyboard', ...eval_ });
      allImprovements.push(...imps.map(i => ({ ...i, scope: 'storyboard' })));
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    allImprovements.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

    // Check evolution convergence if state exists
    let evolutionAdvice = null;
    if (projectManifest.evolution_state) {
      const hardStop = this.#convergence.checkHardStop(projectManifest.evolution_state);
      const softStop = this.#convergence.checkSoftStop(projectManifest.evolution_state, null);
      evolutionAdvice = { hardStop, softStop };
    }

    return {
      project_id: projectManifest.project_id,
      evaluations,
      improvements: allImprovements,
      overall_health: evaluations.length > 0
        ? Math.round(avg(evaluations.map(e => e.overall)) * 10) / 10
        : null,
      evolution_advice: evolutionAdvice,
      timestamp: new Date().toISOString(),
    };
  }

  // Expose sub-agents for advanced usage
  get research() { return this.#research; }
  get critic() { return this.#critic; }
  get convergence() { return this.#convergence; }
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
