/**
 * v2_topology/index.js — Canonical v2.0 PRFP DAG node registry
 *
 * Source of truth: hermes-agent nodes.yaml (schema_version: design-2026-06-16-prfp)
 * 16 nodes total (15 linear + 1 consultative)
 *
 * Layer 0: root
 *   - creative_source
 * Layer 1: intent_parallel
 *   - style_genome, character_designer
 * Layer 2: narrative + visual intent
 *   - screenplay, script_auditor (critic), cinematographer
 * Layer 3: visual execution
 *   - prompt_injector, visual_executor, continuity_auditor (critic)
 * Layer 4: audio
 *   - audio_pipeline
 * Layer 5: post + form-specific
 *   - editor, colorist, hook_retention (短剧 only)
 * Layer 6: final gates + consultative
 *   - quality_gate, compliance_gate, theory_critic (consultative)
 */
import { CreativeSource } from './creative_source.js';
import { StyleGenome } from './style_genome.js';
import { Screenplay } from './screenplay.js';
import { ScriptAuditor } from './script_auditor.js';
import { CharacterDesigner } from './character_designer.js';
import { Cinematographer } from './cinematographer.js';
import { PromptInjector } from './prompt_injector.js';
import { VisualExecutor } from './visual_executor.js';
import { ContinuityAuditor } from './continuity_auditor.js';
import { AudioPipeline } from './audio_pipeline.js';
import { Editor } from './editor.js';
import { Colorist } from './colorist.js';
import { HookRetention } from './hook_retention.js';
import { QualityGate } from './quality_gate.js';
import { ComplianceGate } from './compliance_gate.js';
import { TheoryCritic } from './theory_critic.js';
import { NodeBase } from './_node-base.js';

// Node class registry — keyed by canonical node ID
export const NODE_CLASSES = {
  creative_source: CreativeSource,
  style_genome: StyleGenome,
  screenplay: Screenplay,
  script_auditor: ScriptAuditor,
  character_designer: CharacterDesigner,
  cinematographer: Cinematographer,
  prompt_injector: PromptInjector,
  visual_executor: VisualExecutor,
  continuity_auditor: ContinuityAuditor,
  audio_pipeline: AudioPipeline,
  editor: Editor,
  colorist: Colorist,
  hook_retention: HookRetention,
  quality_gate: QualityGate,
  compliance_gate: ComplianceGate,
  theory_critic: TheoryCritic,
};

// Total node count per design (15 linear + 1 consultative = 16)
export const TOTAL_NODES = 16;
export const LINEAR_NODE_COUNT = 15;
export const CONSULTATIVE_NODE_COUNT = 1;

/**
 * Instantiate a node by canonical ID.
 * @param {string} nodeId
 * @param {object} [spec] — optional node spec from nodes.yaml
 * @returns {NodeBase}
 */
export function createNode(nodeId, spec = null) {
  const NodeClass = NODE_CLASSES[nodeId];
  if (!NodeClass) {
    throw new Error(
      `[v2_topology] Unknown node ID '${nodeId}'. ` +
      `Valid IDs: ${Object.keys(NODE_CLASSES).join(', ')}`
    );
  }
  return new NodeClass(spec);
}

/**
 * Build full DAG registry (all 16 nodes instantiated).
 * @param {object} [specs] — optional map of nodeId → spec
 * @returns {Object<string, NodeBase>}
 */
export function buildNodeRegistry(specs = {}) {
  const registry = {};
  for (const [nodeId, NodeClass] of Object.entries(NODE_CLASSES)) {
    registry[nodeId] = new NodeClass(specs[nodeId] || null);
  }
  return registry;
}

/**
 * List all node IDs (useful for validation / debugging).
 */
export function listNodeIds() {
  return Object.keys(NODE_CLASSES);
}

/**
 * DAG topology — topological execution order per edges.yaml (linear edges only).
 * Loop_with_critic / human_gate / consultative edges handled by v2_pipeline.js orchestrator.
 *
 * Phase 10 order matches V8 phase order (since all nodes are V8 pass-through).
 */
export const LINEAR_EXECUTION_ORDER = [
  'creative_source',           // Layer 0
  'style_genome',              // Layer 1 (parallel intent — can run with character_designer)
  'character_designer',        // Layer 1
  'screenplay',                // Layer 2
  'script_auditor',            // Layer 2 (critic — loops with screenplay)
  'cinematographer',           // Layer 2
  'prompt_injector',           // Layer 3
  'visual_executor',           // Layer 3
  'continuity_auditor',        // Layer 3 (critic — loops with visual_executor)
  'audio_pipeline',            // Layer 4
  'editor',                    // Layer 5
  'colorist',                  // Layer 5
  'hook_retention',            // Layer 5 (form-specific, short_drama only)
  'quality_gate',              // Layer 6
  'compliance_gate',           // Layer 6
  // theory_critic — consultative, not in linear order
];

export {
  NodeBase,
  CreativeSource,
  StyleGenome,
  Screenplay,
  ScriptAuditor,
  CharacterDesigner,
  Cinematographer,
  PromptInjector,
  VisualExecutor,
  ContinuityAuditor,
  AudioPipeline,
  Editor,
  Colorist,
  HookRetention,
  QualityGate,
  ComplianceGate,
  TheoryCritic,
};
