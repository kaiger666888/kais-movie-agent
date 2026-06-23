/**
 * AssetBus — 跨 Phase 资产总线 (V3)
 *
 * 每个 Phase 审核通过后，产出结构化资产文件写入 .pipeline-assets/
 * 后续 Phase 强制读取，确保一致性。
 *
 * V3.0 新增:
 *   - 3 个 typed slots: creative-history / failed-shots / finetune-dataset
 *   - Envelope 格式 {value, derived_from, content_hash, schema_version} 向后兼容 v2.0
 *   - 原子写入 (write-tmp-then-rename)
 *   - mtime-based cache key (写入自动失效)
 *   - appendLine 方法用于 JSONL slot
 */
import { readFile, writeFile, mkdir, rename, stat, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pid } from 'node:process';

const ASSETS_DIR = '.pipeline-assets';
const SCHEMA_VERSION = '3.0';

const ASSET_SCHEMA = {
  // --- V2 Legacy (kept for backward compat) ---
  'art-bible': {
    file: 'art-bible.json',
    fields: ['style_anchor', 'lighting_rules', 'color_palette', 'composition_rules',
             'voice_style_anchor', 'bgm_strategy', 'sfx_mode', 'reverb_profile'],
  },
  'character-assets': {
    file: 'character-assets.json',
    fields: ['characters', 'ip_triple_view', 'ip_design_image', 'clothing_details'],
  },
  'voice-timeline': {
    file: 'voice-timeline.json',
    fields: ['timeline'],
  },
  'shot-list': {
    file: 'shot-list.json',
    fields: ['shots'],
  },
  'scene-assets': {
    file: 'scene-assets.json',
    fields: ['scenes'],
  },
  'prop-assets': {
    file: 'prop-assets.json',
    fields: ['props'],
  },
  // --- V4.1 Audio-Visual Fusion ---
  'visual-soul': {
    file: 'visual-soul.json',
    fields: ['soul_frame_url', 'style_anchor', 'color_palette', 'lighting_rules', 'selected_index', 'visual_tags'],
  },
  'voice-soul': {
    file: 'voice-soul.json',
    fields: ['voice_assignments', 'voice_embeddings', 'matched_visual_index', 'voice_mood'],
  },
  'geometry-bed': {
    file: 'geometry-bed.json',
    fields: ['character_models', 'scene_meshes', 'acoustic_rt60'],
  },
  'spatio-temporal-script': {
    file: 'spatio-temporal-script.json',
    fields: ['shots', 'audio_events', 'duration_coupling'],
  },
  'temp-dialogue': {
    file: 'temp-dialogue.json',
    fields: ['temp_lines', 'voice_assignments', 'viseme_skeletons'],
  },
  'bgm-skeleton': {
    file: 'bgm-skeleton.json',
    fields: ['ambient_segments', 'signature_segments', 'bpm', 'key'],
  },
  'motion-preview': {
    file: 'motion-preview.json',
    fields: ['camera_paths', 'rough_mix_path', 'preview_video_path'],
  },
  'audio-reverb': {
    file: 'audio-reverb.json',
    fields: ['scene_ir_profiles', 'shot_transitions'],
  },
  // --- V3.0 New typed slots (keystone for Phase 21/23/25) ---
  'creative-history': {
    file: 'creative-history.json',
    schema: {
      shots: 'Array<{shot_id, source_hash, derived_from: string[], content_hash, timestamp}>',
      version: 'number',
    },
  },
  'failed-shots': {
    file: 'failed-shots.json',
    schema: {
      failures: 'Array<{shot_id, error, timestamp, run_id, prompt, fingerprints?: {dino?: number[], phash?: string}}>',
      version: 'number',
    },
  },
  'finetune-dataset': {
    file: 'finetune-dataset.jsonl',  // JSONL (append-friendly)
    format: 'jsonl',
    schema: {
      samples: 'string',  // JSONL, 每行一个 sample
      version: 'number',
    },
  },
};

/**
 * Compute SHA-256 content hash of a JSON-serializable value.
 * @param {*} value
 * @returns {string} hex digest
 */
function computeContentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Wrap raw data in V3.0 envelope.
 * @param {*} value - actual data
 * @param {string[]} [derivedFrom=[]] - upstream asset content hashes
 * @returns {{value, derived_from: string[], content_hash: string, schema_version: string}}
 */
function wrapEnvelope(value, derivedFrom = []) {
  return {
    value,
    derived_from: Array.isArray(derivedFrom) ? derivedFrom : [],
    content_hash: computeContentHash(value),
    schema_version: SCHEMA_VERSION,
  };
}

/**
 * Unwrap envelope if present (v3.0), otherwise return raw data (v2.0 backward compat).
 * @param {*} raw - parsed JSON content
 * @returns {*} - the underlying value
 */
function unwrapEnvelope(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)
      && raw.schema_version === SCHEMA_VERSION
      && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value;
  }
  return raw;
}

export class AssetBus {
  constructor(workdir) {
    this._dir = join(workdir, ASSETS_DIR);
    this._cache = new Map();
  }

  async _ensureDir() {
    await mkdir(this._dir, { recursive: true });
  }

  /**
   * Atomic write: write to tmp file then POSIX rename.
   * Guarantees readers never see a partially-written file.
   * @param {string} file - absolute path
   * @param {string} data - serialized content
   */
  async _atomicWrite(file, data) {
    const tmp = `${file}.tmp.${pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  /**
   * Get mtime-based cache key for a slot's file.
   * @param {string} assetName
   * @returns {Promise<string|null>} cache key or null if file missing
   */
  async _cacheKey(assetName) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) return null;
    const path = join(this._dir, schema.file);
    try {
      const st = await stat(path);
      return `${assetName}:${st.mtimeMs}`;
    } catch {
      return null;
    }
  }

  /**
   * Write asset. New data is auto-wrapped in v3.0 envelope.
   * @param {string} assetName - schema slot key
   * @param {*} data - payload (will be placed in envelope.value)
   * @param {object} [opts]
   * @param {string[]} [opts.derived_from] - upstream content hashes
   * @param {string[]} [opts.derivedFrom] - camelCase alias for opts.derived_from (Phase 23)
   * @param {boolean} [opts.envelope=true] - wrap in v3.0 envelope.
   *        Phase 23: when opts.derivedFrom / opts.derived_from is non-empty, envelope
   *        is auto-enabled (even if opts.envelope=false would otherwise skip it) so the
   *        content_hash linkage required by CreativeHistoryTracker is always recorded.
   * @returns {Promise<string>} file path written
   */
  async write(assetName, data, opts = {}) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    if (schema.format === 'jsonl') {
      throw new Error(`Slot ${assetName} is JSONL — use appendLine() instead of write()`);
    }
    await this._ensureDir();
    const path = join(this._dir, schema.file);

    // Phase 23: accept both snake_case (legacy) and camelCase (canonical) derived_from
    const derivedFrom = opts.derivedFrom ?? opts.derived_from ?? [];
    const derivedList = Array.isArray(derivedFrom) ? derivedFrom : [];
    // derivedFrom non-empty forces envelope so content_hash is captured
    const useEnvelope = (derivedList.length > 0) ? true : (opts.envelope !== false);
    const payload = useEnvelope
      ? wrapEnvelope(data, derivedList)
      : data;

    await this._atomicWrite(path, JSON.stringify(payload, null, 2));

    // Invalidate stale cache entries for this slot (mtime changed → new key)
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${assetName}:`) || key === assetName) {
        this._cache.delete(key);
      }
    }
    // Prime cache with current mtime key
    const key = await this._cacheKey(assetName);
    if (key) this._cache.set(key, payload);
    return path;
  }

  /**
   * Read asset. Auto-unwraps v3.0 envelope; returns raw data for v2.0 files.
   * @param {string} assetName
   * @returns {Promise<*>} payload value (unwrapped), or null if missing
   */
  async read(assetName) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);

    // mtime-based cache key — write triggers mtime change → next read misses
    const key = await this._cacheKey(assetName);
    if (key && this._cache.has(key)) {
      const cached = this._cache.get(key);
      return unwrapEnvelope(cached);
    }

    try {
      const raw = await readFile(join(this._dir, schema.file), 'utf-8');
      const parsed = JSON.parse(raw);
      if (key) this._cache.set(key, parsed);
      return unwrapEnvelope(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Read raw envelope (for inspecting derived_from / content_hash metadata).
   * @param {string} assetName
   * @returns {Promise<object|null>} raw envelope object
   */
  async readEnvelope(assetName) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    try {
      const raw = await readFile(join(this._dir, schema.file), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async require(assetName) {
    const data = await this.read(assetName);
    if (!data) throw new Error(`Required asset "${assetName}" not found in ${this._dir}`);
    return data;
  }

  /**
   * Atomic append a single line to a JSONL slot.
   * Uses O_APPEND semantics — safe for concurrent producers within one process.
   * @param {string} assetName - must be a jsonl-format slot
   * @param {object} lineObj - object to serialize as one JSONL line
   * @returns {Promise<string>} file path
   */
  async appendLine(assetName, lineObj) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    if (schema.format !== 'jsonl') {
      throw new Error(`Slot ${assetName} is not JSONL — use write() instead of appendLine()`);
    }
    await this._ensureDir();
    const path = join(this._dir, schema.file);
    const line = JSON.stringify(lineObj) + '\n';
    await appendFile(path, line, { encoding: 'utf-8' });
    // Invalidate cache for this slot
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${assetName}:`) || key === assetName) {
        this._cache.delete(key);
      }
    }
    return path;
  }

  /**
   * Read all lines of a JSONL slot as array of parsed objects.
   * @param {string} assetName
   * @returns {Promise<object[]>}
   */
  async readLines(assetName) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    if (schema.format !== 'jsonl') {
      throw new Error(`Slot ${assetName} is not JSONL — use read() instead`);
    }
    try {
      const raw = await readFile(join(this._dir, schema.file), 'utf-8');
      return raw.split('\n')
        .filter(l => l.trim().length > 0)
        .map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }

  listAssetNames() {
    return Object.keys(ASSET_SCHEMA);
  }
}

// Exported for testing / external use
export { ASSET_SCHEMA, SCHEMA_VERSION, computeContentHash, wrapEnvelope, unwrapEnvelope };

export default AssetBus;
