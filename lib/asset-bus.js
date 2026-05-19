/**
 * AssetBus — 跨 Phase 资产总线 (V2)
 *
 * 每个 Phase 审核通过后，产出结构化资产文件写入 .pipeline-assets/
 * 后续 Phase 强制读取，确保一致性。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ASSETS_DIR = '.pipeline-assets';

const ASSET_SCHEMA = {
  // --- V2 Legacy (kept for backward compat) ---
  'art-bible': {
    file: 'art-bible.json',
    fields: ['style_anchor', 'lighting_rules', 'color_palette', 'composition_rules',
             'voice_style_anchor', 'bgm_strategy', 'sfx_mode', 'reverb_profile'],
  },
  'character-assets': {
    file: 'character-assets.json',
    fields: ['characters'],
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
};

export class AssetBus {
  constructor(workdir) {
    this._dir = join(workdir, ASSETS_DIR);
    this._cache = new Map();
  }

  async _ensureDir() {
    await mkdir(this._dir, { recursive: true });
  }

  async write(assetName, data) {
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    await this._ensureDir();
    const path = join(this._dir, schema.file);
    await writeFile(path, JSON.stringify(data, null, 2));
    this._cache.set(assetName, data);
    return path;
  }

  async read(assetName) {
    if (this._cache.has(assetName)) return this._cache.get(assetName);
    const schema = ASSET_SCHEMA[assetName];
    if (!schema) throw new Error(`Unknown asset: ${assetName}`);
    try {
      const raw = await readFile(join(this._dir, schema.file), 'utf-8');
      const data = JSON.parse(raw);
      this._cache.set(assetName, data);
      return data;
    } catch {
      return null;
    }
  }

  async require(assetName) {
    const data = await this.read(assetName);
    if (!data) throw new Error(`Required asset "${assetName}" not found in ${this._dir}`);
    return data;
  }

  listAssetNames() {
    return Object.keys(ASSET_SCHEMA);
  }
}

export default AssetBus;
