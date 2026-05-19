/**
 * SceneReverbManager — V4.1 场景级混响
 * 纯 CPU，零 GPU。RT60 舒尔泽方程 + 场景级 IR 配置
 */
export class SceneReverbManager {
  constructor({ assetBus }) {
    this.bus = assetBus;
  }

  static REVERB_PROFILES = {
    urban_alley_night: { ir_file: 'urban_alley_night.wav', rt60: 0.8, early_reflections: 0.3, diffusion: 0.6 },
    small_room_interior: { ir_file: 'small_room.wav', rt60: 0.4, early_reflections: 0.2, diffusion: 0.4 },
    large_hall: { ir_file: 'large_hall.wav', rt60: 2.2, early_reflections: 0.5, diffusion: 0.8 },
    outdoor_open: { ir_file: 'outdoor_open.wav', rt60: 0.1, early_reflections: 0.05, diffusion: 0.1 },
    corridor: { ir_file: 'corridor.wav', rt60: 1.2, early_reflections: 0.4, diffusion: 0.6 },
    bathroom: { ir_file: 'bathroom.wav', rt60: 1.5, early_reflections: 0.35, diffusion: 0.5 },
    forest: { ir_file: 'forest.wav', rt60: 0.3, early_reflections: 0.15, diffusion: 0.3 },
    cave: { ir_file: 'cave.wav', rt60: 3.0, early_reflections: 0.6, diffusion: 0.9 },
  };

  // Material absorption coefficients (simplified Sabine)
  static MATERIAL_ALPHA = {
    concrete: 0.02, wood: 0.10, carpet: 0.30, glass: 0.03,
    fabric: 0.20, metal: 0.01, plaster: 0.05, tile: 0.02,
    brick: 0.03, curtain: 0.35, foam: 0.80, audience: 0.50,
  };

  calculateRT60(sceneDimensions, materials = []) {
    const { width = 5, height = 3, depth = 5 } = sceneDimensions || {};
    const volume = width * height * depth;

    // Total surface area (6 faces of rectangular room)
    const surfaceArea = 2 * (width * height + height * depth + width * depth);

    // Average absorption coefficient
    const defaultAlpha = 0.05;
    let avgAlpha;
    if (materials.length > 0) {
      const totalAlpha = materials.reduce((sum, m) => {
        const alpha = SceneReverbManager.MATERIAL_ALPHA[m.type] || defaultAlpha;
        return sum + alpha * (m.area || surfaceArea / materials.length);
      }, 0);
      const totalArea = materials.reduce((sum, m) => sum + (m.area || surfaceArea / materials.length), 0);
      avgAlpha = totalAlpha / totalArea;
    } else {
      avgAlpha = defaultAlpha;
    }

    // Sabine equation: RT60 = 0.161 * V / A
    const A = surfaceArea * avgAlpha;
    const rt60 = A > 0 ? 0.161 * volume / A : 2.0;

    return Math.max(0.1, Math.min(5.0, rt60));
  }

  generateIRProfile(rt60, sceneType) {
    const profile = SceneReverbManager.REVERB_PROFILES[sceneType];
    if (profile) return { ...profile, calculated_rt60: rt60 };

    // Auto-generate from RT60 value
    let closestType = 'small_room_interior';
    let closestDiff = Infinity;
    for (const [type, p] of Object.entries(SceneReverbManager.REVERB_PROFILES)) {
      const diff = Math.abs(p.rt60 - rt60);
      if (diff < closestDiff) { closestDiff = diff; closestType = type; }
    }

    return {
      scene_type: closestType,
      ...SceneReverbManager.REVERB_PROFILES[closestType],
      calculated_rt60: rt60,
    };
  }

  planShotTransitions(shotList, sceneIRProfiles) {
    const transitions = [];
    for (let i = 1; i < shotList.length; i++) {
      const prev = shotList[i - 1];
      const curr = shotList[i];
      const sameScene = prev.scene_id === curr.scene_id;

      transitions.push({
        from_shot: prev.id || prev.shot_id || i - 1,
        to_shot: curr.id || curr.shot_id || i,
        same_scene: sameScene,
        transition_type: sameScene ? 'hard_cut' : 'crossfade',
        crossfade_duration: sameScene ? 0 : 0.5,
        reverb_from: sceneIRProfiles[prev.scene_id] || null,
        reverb_to: sceneIRProfiles[curr.scene_id] || null,
      });
    }
    return transitions;
  }

  async buildReverbPlan(shotList, scenes) {
    const sceneIRProfiles = {};
    for (const scene of scenes) {
      const rt60 = this.calculateRT60(scene.dimensions, scene.materials);
      sceneIRProfiles[scene.id] = this.generateIRProfile(rt60, scene.acoustic_profile || scene.type);
    }

    const shotTransitions = this.planShotTransitions(shotList, sceneIRProfiles);

    const reverbData = {
      scene_ir_profiles: sceneIRProfiles,
      shot_transitions: shotTransitions,
    };

    await this.bus.write('audio-reverb', reverbData);
    return reverbData;
  }

  // FFmpeg afir filter command for offline convolution
  buildFFmpegReverbCommand(inputAudio, irFile, wetMix = 0.3) {
    return {
      filter: `afir=dry=10:wet=${Math.round(wetMix * 10)}:g=1:irfile=${irFile}`,
      input: inputAudio,
      ir_file: irFile,
      wet_mix: wetMix,
    };
  }
}

export default SceneReverbManager;
