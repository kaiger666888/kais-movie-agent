import { JimengClient } from './lib/jimeng-client.js';
import { CameraOperator } from './lib/camera.js';

const client = new JimengClient();
const camera = new CameraOperator(client, {
  outputDir: '/tmp/output',
  maxRetries: 3,
});

const result = await camera.executeAll(shootingScript, {
  concurrency: 1,
  onProgress: (current, total, shotId) => {
    console.log(`[${current}/${total}] ${shotId}`);
  },
  onShotComplete: (clip) => {
    console.log(`✅ ${clip.shot_id} → ${clip.url}`);
  },
});

console.log(camera.getCostReport());
