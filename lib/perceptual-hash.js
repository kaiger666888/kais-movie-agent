/**
 * perceptual-hash.js — DCT-II 8x8 pHash (Phase 24 B2-02)
 *
 * 零 npm 依赖的感知哈希实现。算法 (phash-paper standard):
 *   1. resize 到 32x32 灰度
 *   2. 计算 32x32 DCT-II
 *   3. 取 top-left 8x8 low-frequency coefficients
 *   4. 排除 DC term (coeff[0][0])，对剩下 63 个值求 median
 *   5. 每个系数与 median 比较 → 64-bit (实际 63+1) hash
 *
 * 输入策略:
 *   - 接受预 resize 的 32x32 灰度像素数组 (Uint8Array/number[], length=1024) — 测试可注入
 *   - 否则通过 gold-team image_resize 获取 (lib/character-asset-manager 调用方注入)
 *
 * 不直接依赖 sharp/jimp — 严格遵守"零 npm 依赖"原则 (24-CONTEXT.md L72)。
 *
 * 导出:
 *   computePHash(imagePath|pixels, opts) → Promise<string>  (16-char hex)
 *   computePHashFromPixels(pixels32x32) → string
 *   hammingDistance(hashA, hashB) → number (0-64)
 *   pHashSimilarity(hashA, hashB) → number (0-1)
 *   dct2d(matrix) → matrix          (导出便于单元测试)
 */

/**
 * 1D DCT-II on a length-N array. O(N^2), adequate for N<=32.
 * Pure JS, no deps.
 *
 * Formula: X[k] = sum_{n=0}^{N-1} x[n] * cos((pi/N) * (n+0.5) * k)
 * (Type-II orthogonal DCT without the orthonormal scaling — we only
 *  care about relative magnitudes for median threshold.)
 */
function dct1d(signal) {
  const N = signal.length;
  const out = new Array(N);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    out[k] = sum;
  }
  return out;
}

/**
 * 2D DCT-II via separable application of dct1d on rows then columns.
 * Input: NxN row-major array (array of arrays or flat length N*N).
 * Returns: NxN flat Float64Array.
 */
export function dct2d(matrix, size = 32) {
  // Normalize input to flat Float64Array
  let flat;
  if (Array.isArray(matrix) && Array.isArray(matrix[0])) {
    flat = new Float64Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        flat[r * size + c] = matrix[r][c];
      }
    }
  } else {
    // Already flat (Uint8Array/number[])
    flat = Float64Array.from(matrix);
  }

  // 1) Apply 1D DCT to each row
  const rowDct = new Float64Array(size * size);
  for (let r = 0; r < size; r++) {
    const row = Array.from(flat.slice(r * size, r * size + size));
    const transformed = dct1d(row);
    for (let c = 0; c < size; c++) {
      rowDct[r * size + c] = transformed[c];
    }
  }

  // 2) Apply 1D DCT to each column of the row-transformed matrix
  const result = new Float64Array(size * size);
  for (let c = 0; c < size; c++) {
    const col = new Array(size);
    for (let r = 0; r < size; r++) col[r] = rowDct[r * size + c];
    const transformed = dct1d(col);
    for (let r = 0; r < size; r++) {
      result[r * size + c] = transformed[r];
    }
  }

  return result;
}

/**
 * Extract top-left 8x8 (LOW frequencies) from a 32x32 DCT matrix.
 * Returns Float64Array of 64 coefficients (flat row-major).
 */
function extractTopLeft8x8(dctMatrix, srcSize = 32) {
  const out = new Float64Array(64);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      out[r * 8 + c] = dctMatrix[r * srcSize + c];
    }
  }
  return out;
}

/**
 * Compute median of a numeric array (excluding DC term per pHash paper).
 * Modifies the input array via sort — pass a copy if needed.
 */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Convert a 64-bit (16 hex char) pHash string to a 64-element boolean array.
 */
function hashToBits(hashHex) {
  if (typeof hashHex !== 'string' || hashHex.length !== 16) {
    throw new Error(`pHash must be 16 hex chars, got: ${hashHex}`);
  }
  const bits = new Array(64);
  for (let i = 0; i < 16; i++) {
    const nibble = parseInt(hashHex[i], 16);
    if (Number.isNaN(nibble)) {
      throw new Error(`invalid hex char at pos ${i}: ${hashHex[i]}`);
    }
    // Most-significant bit first within nibble
    bits[i * 4 + 0] = (nibble >> 3) & 1;
    bits[i * 4 + 1] = (nibble >> 2) & 1;
    bits[i * 4 + 2] = (nibble >> 1) & 1;
    bits[i * 4 + 3] = nibble & 1;
  }
  return bits;
}

/**
 * Convert 64 boolean bits to 16 hex chars (MSB-first within each nibble).
 */
function bitsToHash(bits) {
  if (bits.length !== 64) {
    throw new Error(`bits must be length 64, got ${bits.length}`);
  }
  let hex = '';
  for (let i = 0; i < 16; i++) {
    const nibble =
      (bits[i * 4 + 0] << 3) |
      (bits[i * 4 + 1] << 2) |
      (bits[i * 4 + 2] << 1) |
      bits[i * 4 + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Compute pHash from a pre-resized 32x32 grayscale pixel array.
 * This is the pure-math core — no I/O, no image processing deps.
 *
 * @param {Uint8Array|number[]} pixels — 1024 values (32x32 grayscale 0-255)
 * @returns {string} 16-char hex hash
 */
export function computePHashFromPixels(pixels) {
  if (!pixels || pixels.length !== 1024) {
    throw new Error(`pixels must have length 1024 (32x32), got ${pixels?.length}`);
  }

  // Step 1: 2D DCT
  const dct = dct2d(pixels, 32);

  // Step 2: Extract top-left 8x8 low frequencies
  const topLeft = extractTopLeft8x8(dct, 32);

  // Step 3: Compute median EXCLUDING DC (coeff[0][0]) — standard pHash
  const withoutDc = Array.from(topLeft).slice(1);
  const med = median(withoutDc);

  // Step 4: Threshold → bits (bit=1 if coeff > median)
  const bits = new Array(64);
  for (let i = 0; i < 64; i++) {
    bits[i] = topLeft[i] > med ? 1 : 0;
  }

  return bitsToHash(bits);
}

/**
 * Compute pHash for an image file or pre-resized pixels.
 *
 * Accepts:
 *   - Uint8Array/number[] length 1024 → use directly (testing / pre-resized)
 *   - string path → defer to opts.fetchPixels callback (caller injects gold-team)
 *
 * @param {string|Uint8Array|number[]} input
 * @param {object} [opts]
 * @param {function(string): Promise<Uint8Array|number[]>} [opts.fetchPixels]
 *        Resize+grayscale provider. Given an image path, returns 32x32 grayscale
 *        pixels (length 1024). Typically wraps gold-team image_resize + a small
 *        decoder. If absent and input is a string, throws (callers must inject).
 * @returns {Promise<string>} 16-char hex hash
 */
export async function computePHash(input, opts = {}) {
  // Direct pixel path — pure math, no async needed
  if (Array.isArray(input) || (input && input.buffer) || input instanceof Uint8Array) {
    return computePHashFromPixels(input);
  }

  if (typeof input === 'string') {
    if (typeof opts.fetchPixels !== 'function') {
      throw new Error(
        'computePHash(string) requires opts.fetchPixels — inject a resize+grayscale provider (gold-team)',
      );
    }
    const pixels = await opts.fetchPixels(input);
    if (!pixels || pixels.length !== 1024) {
      throw new Error(`fetchPixels returned ${pixels?.length} pixels, expected 1024`);
    }
    return computePHashFromPixels(pixels);
  }

  throw new Error(`computePHash: unsupported input type ${typeof input}`);
}

/**
 * Hamming distance between two pHash hex strings.
 *
 * @param {string} hashA — 16 hex chars
 * @param {string} hashB — 16 hex chars
 * @returns {number} 0-64 (0=identical, 64=opposite)
 */
export function hammingDistance(hashA, hashB) {
  if (typeof hashA !== 'string' || typeof hashB !== 'string') {
    throw new Error('hammingDistance: both args must be hex strings');
  }
  if (hashA.length !== hashB.length) {
    throw new Error(`hammingDistance: length mismatch ${hashA.length} vs ${hashB.length}`);
  }
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const x = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    // popcount for a nibble
    dist += ((x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1));
  }
  return dist;
}

/**
 * Convert hamming distance to 0-1 similarity (1=identical, 0=totally different).
 *
 * @param {string} hashA
 * @param {string} hashB
 * @returns {number} similarity in [0, 1]
 */
export function pHashSimilarity(hashA, hashB) {
  const dist = hammingDistance(hashA, hashB);
  return 1 - dist / 64;
}

// Internal helpers exported for unit testing
export const _internals = {
  dct1d,
  extractTopLeft8x8,
  median,
  hashToBits,
  bitsToHash,
};

export default {
  computePHash,
  computePHashFromPixels,
  hammingDistance,
  pHashSimilarity,
  dct2d,
};
