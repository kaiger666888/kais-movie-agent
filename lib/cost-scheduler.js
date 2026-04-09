// Cost-Aware Scheduler - Budget-aware task orchestration

const LAYER_COST_RANGES = {
  text: { min: 0, max: 0, unit: 'LLM call' },
  visual: { min: 1, max: 5, unit: 'credits/variant' },
  execution: { min: 5, max: 20, unit: 'credits/shot' },
};

export class CostAwareScheduler {
  #spent = 0;
  #history = [];

  constructor() {}

  estimateCost(skillName, params = {}) {
    // Layer-based estimation; params can override
    const layer = params.layer || this.#guessLayer(skillName);
    const range = LAYER_COST_RANGES[layer] || LAYER_COST_RANGES.text;
    const base = (range.min + range.max) / 2;

    // Adjust by complexity hints
    let multiplier = 1;
    if (params.variantCount) multiplier = Math.max(multiplier, params.variantCount);
    if (params.shotCount) multiplier = params.shotCount;

    return { min: range.min * multiplier, max: range.max * multiplier, expected: base * multiplier, unit: range.unit };
  }

  #guessLayer(skillName) {
    if (skillName.includes('camera') || skillName.includes('shooting') || skillName.includes('video')) return 'execution';
    if (skillName.includes('art') || skillName.includes('character') || skillName.includes('scene') || skillName.includes('storyboard')) return 'visual';
    return 'text';
  }

  schedule(task, context) {
    const { budget, spent, skillQueue } = context;
    const remaining = budget - spent;
    const cost = this.estimateCost(task.skillName, task.params);

    if (cost.expected > remaining) {
      return { decision: 'skip', reason: `Insufficient budget (need ~${cost.expected}, have ${remaining})`, cost };
    }

    return { decision: 'execute', cost, remaining: remaining - cost.expected };
  }

  canParallelize(tasks, budget) {
    let totalMin = 0;
    let totalMax = 0;
    for (const task of tasks) {
      const cost = this.estimateCost(task.skillName, task.params);
      totalMin += cost.min;
      totalMax += cost.max;
    }
    const remaining = budget - this.#spent;
    return { canParallel: totalMin <= remaining, minCost: totalMin, maxCost: totalMax, remaining };
  }

  getOptimalStrategy(taskQueue, budget) {
    const remaining = budget - this.#spent;
    const parallel = [];
    const sequential = [];
    let estimatedCost = 0;
    const layerGroups = new Map(); // layer -> tasks

    // Group by layer
    for (const task of taskQueue) {
      const cost = this.estimateCost(task.skillName, task.params);
      estimatedCost += cost.expected;
      const layer = cost.unit.includes('LLM') ? 'text' : cost.unit.includes('shot') ? 'execution' : 'visual';
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer).push({ ...task, cost });
    }

    // Text tasks: always parallel (free)
    parallel.push(...(layerGroups.get('text') || []));
    // Visual tasks: parallel if budget allows
    const visualTasks = layerGroups.get('visual') || [];
    const visualCost = visualTasks.reduce((s, t) => s + t.cost.expected, 0);
    if (visualCost <= remaining * 0.5) {
      parallel.push(...visualTasks);
    } else {
      sequential.push(...visualTasks);
    }
    // Execution tasks: always sequential (expensive, sequential dependency)
    sequential.push(...(layerGroups.get('execution') || []));

    const riskLevel = estimatedCost > budget ? 'high' : estimatedCost > budget * 0.7 ? 'medium' : 'low';

    return { parallel, sequential, estimated_cost: estimatedCost, risk_level: riskLevel };
  }

  trackCost(skillName, actualCost) {
    this.#spent += actualCost;
    this.#history.push({ skillName, cost: actualCost, timestamp: Date.now() });
  }

  getSpent() { return this.#spent; }

  getRemaining(budget) { return budget - this.#spent; }

  getHistory() { return [...this.#history]; }
}
