// Domain Events - Event-driven skill coordination

export class DomainEvent {
  constructor(type, payload, source) {
    this.id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.type = type;
    this.payload = payload;
    this.source = source;
    this.timestamp = Date.now();
  }

  toJSON() {
    return { id: this.id, type: this.type, payload: this.payload, source: this.source, timestamp: this.timestamp };
  }
}

export const EventTypes = {
  ART_DIRECTION_LOCKED: 'art_direction.locked',
  ART_DIRECTION_CHANGED: 'art_direction.changed',
  CHARACTER_SELECTED: 'character.selected',
  CHARACTER_CHANGED: 'character.changed',
  SCENE_APPROVED: 'scene.approved',
  STORYBOARD_APPROVED: 'storyboard.approved',
  SHOT_GENERATED: 'shot.generated',
  SHOT_FAILED: 'shot.failed',
  EVOLUTION_ROUND_COMPLETE: 'evolution.round_complete',
  PRODUCTION_COMPLETE: 'production.complete',
};

const DEFAULT_RESPONSE_RULES = {
  'art_direction.changed': ['kais-character-designer', 'kais-scene-designer', 'kais-storyboard-designer'],
  'character.selected': ['kais-storyboard-designer'],
  'scene.approved': ['kais-storyboard-designer'],
};

export class DomainEventManager {
  #eventBus;
  #rules = new Map();

  constructor(eventBus) {
    this.#eventBus = eventBus;
    // Load default rules
    for (const [eventType, skills] of Object.entries(DEFAULT_RESPONSE_RULES)) {
      this.addRule(eventType, skills);
    }
  }

  publish(eventType, payload, source) {
    const event = new DomainEvent(eventType, payload, source);
    this.#eventBus.emit(`domain.${eventType}`, event);
    // Auto-execute response rules
    this.executeResponse(eventType, payload);
    return event;
  }

  addRule(eventType, affectedSkills) {
    const existing = this.#rules.get(eventType) || [];
    this.#rules.set(eventType, [...new Set([...existing, ...affectedSkills])]);
  }

  getAffectedSkills(eventType) {
    return this.#rules.get(eventType) || [];
  }

  executeResponse(eventType, payload) {
    const affected = this.getAffectedSkills(eventType);
    if (affected.length === 0) return;
    this.#eventBus.emit('domain.response', { eventType, affectedSkills: affected, payload });
  }
}

export { DEFAULT_RESPONSE_RULES as RESPONSE_RULES };
