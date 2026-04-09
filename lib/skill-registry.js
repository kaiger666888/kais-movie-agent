// Skill Registry - DI Container with dependency resolution

const DEFAULT_SKILLS = {
  'kais-topic-selector': { input: [], output: 'ConceptArtifact', layer: 'text' },
  'kais-story-outline': { input: ['ConceptArtifact'], output: 'StoryDNA', layer: 'text' },
  'kais-scenario-writer': { input: ['StoryDNA'], output: 'ScenarioScript', layer: 'text' },
  'kais-art-direction': { input: ['StoryDNA'], output: 'ArtDirection', layer: 'visual' },
  'kais-character-designer': { input: ['StoryDNA', 'ArtDirection'], output: 'CharacterBible[]', layer: 'visual' },
  'kais-scene-designer': { input: ['StoryDNA', 'ArtDirection'], output: 'SceneDesign[]', layer: 'visual' },
  'kais-storyboard-designer': { input: ['ScenarioScript', 'CharacterBible[]', 'SceneDesign[]', 'ArtDirection'], output: 'Storyboard', layer: 'visual' },
  'kais-shooting-script': { input: ['Storyboard', 'CharacterBible[]', 'ArtDirection'], output: 'ShootingScript', layer: 'execution' },
  'kais-camera': { input: ['ShootingScript'], output: 'VideoClip[]', layer: 'execution' },
};

export class SkillRegistry {
  #skills = new Map();

  constructor(preload = DEFAULT_SKILLS) {
    for (const [name, config] of Object.entries(preload)) {
      this.register(name, config);
    }
  }

  register(skillName, skillConfig) {
    this.#skills.set(skillName, {
      path: skillConfig.path || null,
      inputSchema: skillConfig.input || [],
      outputSchema: skillConfig.output || null,
      dependencies: skillConfig.dependencies || [],
      capabilities: skillConfig.capabilities || [],
      layer: skillConfig.layer || 'text',
      ...skillConfig,
    });
  }

  get(skillName) {
    return this.#skills.get(skillName) || null;
  }

  list() {
    return [...this.#skills.keys()];
  }

  getDependencies(skillName) {
    const skill = this.#skills.get(skillName);
    if (!skill) return [];
    // Input artifacts that other skills produce
    return skill.inputSchema || [];
  }

  getConsumers(skillName) {
    const skill = this.#skills.get(skillName);
    if (!skill) return [];
    const output = skill.outputSchema;
    if (!output) return [];
    const consumers = [];
    for (const [name, s] of this.#skills) {
      if (name === skillName) continue;
      if (s.inputSchema?.includes(output)) consumers.push(name);
    }
    return consumers;
  }

  resolveExecutionOrder(skillNames) {
    // Build adjacency: skill -> set of skills it must wait for
    const nameSet = new Set(skillNames);
    const outputToProducer = new Map();
    for (const [name, skill] of this.#skills) {
      if (!nameSet.has(name)) continue;
      if (skill.outputSchema) outputToProducer.set(skill.outputSchema, name);
    }

    const inDegree = new Map();
    const adj = new Map(); // producer -> [consumers]

    for (const name of nameSet) {
      inDegree.set(name, 0);
      adj.set(name, []);
    }

    for (const name of nameSet) {
      const skill = this.#skills.get(name);
      for (const input of (skill.inputSchema || [])) {
        const producer = outputToProducer.get(input);
        if (producer && nameSet.has(producer) && producer !== name) {
          adj.get(producer).push(name);
          inDegree.set(name, inDegree.get(name) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const result = [];
    while (queue.length) {
      const node = queue.shift();
      result.push(node);
      for (const next of adj.get(node)) {
        inDegree.set(next, inDegree.get(next) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }

    if (result.length !== nameSet.size) {
      throw new Error('Circular dependency detected in skill graph');
    }
    return result;
  }

  detectCycles() {
    try {
      this.resolveExecutionOrder(this.list());
      return false;
    } catch {
      return true;
    }
  }

  async validate(skillName) {
    const skill = this.#skills.get(skillName);
    if (!skill) return { valid: false, errors: [`Skill "${skillName}" not registered`] };

    const errors = [];
    if (skill.path) {
      try {
        const { existsSync } = await import('node:fs');
        if (!existsSync(skill.path)) errors.push(`Path does not exist: ${skill.path}`);
      } catch {
        // fs not available, skip path check
      }
    }
    if (!skill.outputSchema) errors.push('Missing output schema');
    return { valid: errors.length === 0, errors };
  }
}

export { DEFAULT_SKILLS };
