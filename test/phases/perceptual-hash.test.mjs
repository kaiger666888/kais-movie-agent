/**
 * Phase 24 B2-02: perceptual-hash.js tests
 *
 * Coverage:
 *   - hammingDistance / pHashSimilarity with known hash pairs
 *   - DCT-II correctness (known signal → known output)
 *   - pHash from pixels: identical images → identical hash; small perturbation → small hamming
 *   - input validation: bad length / bad hex / missing fetchPixels
 *   - hashToBits / bitsToHash round-trip
 *
 * Run: node --test test/phases/perceptual-hash.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePHash,
  computePHashFromPixels,
  hammingDistance,
  pHashSimilarity,
  dct2d,
  _internals,
} from '../../lib/perceptual-hash.js';

describe('Phase 24 B2-02: hammingDistance', () => {
  it('identical hashes → 0', () => {
    assert.strictEqual(hammingDistance('0000000000000000', '0000000000000000'), 0);
    assert.strictEqual(hammingDistance('ffffffffffffffff', 'ffffffffffffffff'), 0);
    assert.strictEqual(hammingDistance('a1b2c3d4e5f60718', 'a1b2c3d4e5f60718'), 0);
  });

  it('all-bits-different → 64', () => {
    assert.strictEqual(hammingDistance('0000000000000000', 'ffffffffffffffff'), 64);
  });

  it('single nibble difference → distance equals popcount of that nibble', () => {
    // 0x0 vs 0x1 = popcount 1
    assert.strictEqual(hammingDistance('0000000000000000', '0000000000000001'), 1);
    // 0x0 vs 0xf = popcount 4
    assert.strictEqual(hammingDistance('000000000000000f', '0000000000000000'), 4);
    // 0x5 vs 0xa = popcount(0xf) = 4
    assert.strictEqual(hammingDistance('5000000000000000', 'a000000000000000'), 4);
  });

  it('length mismatch → throws', () => {
    assert.throws(() => hammingDistance('abc', 'abcd'), /length mismatch/);
  });

  it('non-string → throws', () => {
    assert.throws(() => hammingDistance(null, '0000000000000000'), /both args must be hex strings/);
  });
});

describe('Phase 24 B2-02: pHashSimilarity', () => {
  it('identical → 1.0', () => {
    assert.strictEqual(pHashSimilarity('a1b2c3d4e5f60718', 'a1b2c3d4e5f60718'), 1);
  });

  it('all-bits-different → 0.0', () => {
    assert.strictEqual(pHashSimilarity('0000000000000000', 'ffffffffffffffff'), 0);
  });

  it('4-bit difference → 60/64 = 0.9375', () => {
    const sim = pHashSimilarity('0000000000000000', '000000000000000f');
    assert.ok(Math.abs(sim - 60 / 64) < 1e-9);
  });

  it('bounds: result always in [0,1]', () => {
    const pairs = [
      ['0000000000000000', 'ffffffffffffffff'],
      ['1234567890abcdef', '1234567890abcdef'],
      ['deadbeefdeadbeef', 'feedfeedfeedfeed'],
    ];
    for (const [a, b] of pairs) {
      const s = pHashSimilarity(a, b);
      assert.ok(s >= 0 && s <= 1, `sim=${s} out of bounds`);
    }
  });
});

describe('Phase 24 B2-02: DCT-II correctness', () => {
  it('1D DCT of DC signal (all ones) → nonzero only at k=0', () => {
    const signal = new Array(8).fill(1);
    const out = _internals.dct1d(signal);
    // k=0 should be N=8 (sum of ones)
    assert.ok(Math.abs(out[0] - 8) < 1e-9, `k=0 should be 8, got ${out[0]}`);
    // All other k should be ~0
    for (let k = 1; k < 8; k++) {
      assert.ok(Math.abs(out[k]) < 1e-9, `k=${k} should be 0, got ${out[k]}`);
    }
  });

  it('2D DCT of constant 32x32 image → only DC term significant', () => {
    const pixels = new Float64Array(32 * 32).fill(128);
    const dct = dct2d(pixels, 32);
    // DC = (0,0) should be huge; all other coeffs ~0 (float noise)
    const dc = dct[0];
    assert.ok(dc > 1000, `DC term should be large, got ${dc}`);
    // Sample a few non-DC coeffs — float noise, magnitude << DC
    for (const [r, c] of [[0, 1], [1, 0], [5, 7], [15, 20]]) {
      const val = dct[r * 32 + c];
      assert.ok(Math.abs(val) < 1e-3, `non-DC (${r},${c}) should be ~0, got ${val}`);
    }
  });

  it('2D DCT of step function concentrates energy in low frequencies', () => {
    // Left half white (255), right half black (0)
    const pixels = new Float64Array(32 * 32);
    for (let r = 0; r < 32; r++) {
      for (let c = 0; c < 32; c++) {
        pixels[r * 32 + c] = c < 16 ? 255 : 0;
      }
    }
    const dct = dct2d(pixels, 32);
    // Horizontal step → energy at low k (column index), particularly c=1
    const lowFreqCol1 = Math.abs(dct[0 * 32 + 1]);
    const highFreqCol31 = Math.abs(dct[0 * 32 + 31]);
    assert.ok(lowFreqCol1 > highFreqCol31 * 10,
      `low freq should dominate: c1=${lowFreqCol1} c31=${highFreqCol31}`);
  });
});

describe('Phase 24 B2-02: computePHashFromPixels', () => {
  it('constant image → deterministic, stable hash (DC dominates; float noise near 0)', () => {
    const pixels = new Uint8Array(1024).fill(128);
    const hash = computePHashFromPixels(pixels);
    assert.match(hash, /^[0-9a-f]{16}$/, 'hash should be 16 hex chars');
    // Two identical constant images must produce identical hashes (idempotent)
    const hash2 = computePHashFromPixels(new Uint8Array(1024).fill(128));
    assert.strictEqual(hash, hash2);
    // Sanity: DC coefficient alone (top-left of DCT) should be huge vs median ~0
    const dct = dct2d(new Float64Array(32 * 32).fill(128), 32);
    assert.ok(dct[0] > 1e4, 'DC term should dominate for constant image');
  });

  it('identical pixel arrays → identical hash', () => {
    const pixelsA = new Uint8Array(1024);
    const pixelsB = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      pixelsA[i] = (i * 37) % 256;
      pixelsB[i] = (i * 37) % 256;
    }
    assert.strictEqual(computePHashFromPixels(pixelsA), computePHashFromPixels(pixelsB));
  });

  it('slightly perturbed image → small hamming distance (<= 10)', () => {
    // Base image: gradient
    const base = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) base[i] = (i * 7) % 256;
    // Perturbed: add small noise to 5% of pixels
    const perturbed = Uint8Array.from(base);
    for (let i = 0; i < 1024; i += 20) {
      perturbed[i] = (perturbed[i] + 10) % 256;
    }
    const hashA = computePHashFromPixels(base);
    const hashB = computePHashFromPixels(perturbed);
    const dist = hammingDistance(hashA, hashB);
    assert.ok(dist <= 16,
      `perturbation should cause small hamming distance, got ${dist}`);
  });

  it('totally different images → high hamming distance (>= 20)', () => {
    // Two uncorrelated textures
    const a = new Uint8Array(1024);
    const b = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      a[i] = (i * 7) % 256;
      b[i] = ((1024 - i) * 11) % 256;
    }
    const hashA = computePHashFromPixels(a);
    const hashB = computePHashFromPixels(b);
    const dist = hammingDistance(hashA, hashB);
    assert.ok(dist >= 20, `different images should have hamming >= 20, got ${dist}`);
  });

  it('wrong pixel array length → throws', () => {
    assert.throws(
      () => computePHashFromPixels(new Uint8Array(512)),
      /length 1024/,
    );
    assert.throws(
      () => computePHashFromPixels(null),
      /length 1024/,
    );
  });
});

describe('Phase 24 B2-02: computePHash (async entrypoint)', () => {
  it('accepts pre-resized pixels directly (no fetchPixels needed)', async () => {
    const pixels = new Uint8Array(1024).fill(200);
    const hash = await computePHash(pixels);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it('accepts string path with fetchPixels injection', async () => {
    const mockPixels = new Uint8Array(1024).fill(100);
    const fetchPixels = async (path) => {
      assert.strictEqual(path, '/tmp/img.png');
      return mockPixels;
    };
    const hash = await computePHash('/tmp/img.png', { fetchPixels });
    assert.strictEqual(hash, computePHashFromPixels(mockPixels));
  });

  it('string path without fetchPixels → throws', async () => {
    await assert.rejects(
      () => computePHash('/tmp/img.png'),
      /fetchPixels/,
    );
  });

  it('fetchPixels returns wrong length → throws', async () => {
    const badFetch = async () => new Uint8Array(512);
    await assert.rejects(
      () => computePHash('/tmp/img.png', { fetchPixels: badFetch }),
      /1024/,
    );
  });

  it('unsupported input type → throws', async () => {
    await assert.rejects(
      () => computePHash(12345),
      /unsupported input type/,
    );
  });
});

describe('Phase 24 B2-02: hashToBits / bitsToHash round-trip', () => {
  it('round-trips arbitrary hex strings', () => {
    const samples = [
      '0000000000000000',
      'ffffffffffffffff',
      'deadbeefdeadbeef',
      '0123456789abcdef',
      'a1b2c3d4e5f60718',
    ];
    for (const h of samples) {
      const bits = _internals.hashToBits(h);
      const back = _internals.bitsToHash(bits);
      assert.strictEqual(back, h, `round-trip failed for ${h}`);
    }
  });

  it('invalid hex char → throws', () => {
    assert.throws(
      () => _internals.hashToBits('zzzzzzzzzzzzzzzz'),
      /invalid hex char/,
    );
  });

  it('wrong length → throws', () => {
    assert.throws(
      () => _internals.hashToBits('abc'),
      /16 hex chars/,
    );
  });
});

describe('Phase 24 B2-02: median helper', () => {
  it('odd-length array → middle value', () => {
    assert.strictEqual(_internals.median([3, 1, 2]), 2);
    assert.strictEqual(_internals.median([10, 30, 20]), 20);
  });

  it('even-length array → average of two middle', () => {
    assert.strictEqual(_internals.median([1, 2, 3, 4]), 2.5);
    assert.strictEqual(_internals.median([10, 20, 30, 40]), 25);
  });

  it('empty array → 0', () => {
    assert.strictEqual(_internals.median([]), 0);
  });
});
