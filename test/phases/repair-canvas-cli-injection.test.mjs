/**
 * Phase 28 28-02: repair-canvas-truncated-scenes CLI SQL injection regression test
 *
 * 验证 D-PIPE-INTEGRITY-02: --projectId / --episodesId 必须通过 \d+ + Number.isInteger
 * 校验后才进入 SQL 字符串。拒绝时 stderr 输出 "Invalid --<label>: must be positive
 * integer (got: <value>)" + exit code 1。
 *
 * 6 路径:
 *   1. 正常正整数 — 通过校验 (stderr 不含 Invalid, 而含 Screenplay file not found)
 *   2. 负数 — 拒绝 (exit 1 + stderr "got: -1")
 *   3. 字符串 — 拒绝 (exit 1 + stderr "got: abc")
 *   4. 注入串 "1; DROP TABLE x" — 拒绝 (exit 1 + stderr "got: 1; DROP TABLE x")
 *   5. 浮点 5.5 — 拒绝 (exit 1 + stderr "got: 5.5")
 *   6. 对称 --episodesId 注入 — 拒绝
 *
 * 使用 child_process.spawnSync 调用真实 CLI 入口 (D-PIPE-INTEGRITY-02 锁定的测试策略)。
 *
 * Run: node --test test/phases/repair-canvas-cli-injection.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', '..', 'bin', 'repair-canvas-truncated-scenes.js');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

describe('repair-canvas-truncated-scenes CLI integer validation (PIPE-INTEGRITY-02)', () => {
  it('accepts normal positive integer projectId+episodesId (validation passes, fails later on missing screenplay)', () => {
    const result = run([
      '--projectId', '1800',
      '--episodesId', '2',
      '--dry-run',
      '--screenplay', '/nonexistent.json',
    ]);
    assert.equal(result.status, 1, 'exit 1 from missing screenplay, not from validation');
    assert.doesNotMatch(result.stderr, /Invalid --(projectId|episodesId)/,
      'validation must NOT fire for valid integers');
    assert.match(result.stderr, /Screenplay file not found/,
      'execution must advance past validation to the screenplay-existence check');
  });

  it('rejects negative projectId (exit 1, stderr names the bad value)', () => {
    const result = run(['--projectId', '-1', '--episodesId', '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --projectId: must be positive integer \(got: -1\)/);
  });

  it('rejects non-numeric string projectId', () => {
    const result = run(['--projectId', 'abc', '--episodesId', '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --projectId.*got: abc/);
  });

  it('rejects SQL injection payload "1; DROP TABLE x" (PIPE-INTEGRITY-02 primary vector)', () => {
    const result = run(['--projectId', '1; DROP TABLE x', '--episodesId', '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --projectId.*got: 1; DROP TABLE x/);
  });

  it('rejects float projectId 5.5', () => {
    const result = run(['--projectId', '5.5', '--episodesId', '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --projectId.*got: 5\.5/);
  });

  it('symmetrically rejects injection on --episodesId', () => {
    const result = run([
      '--projectId', '1800',
      '--episodesId', '2; DROP TABLE y',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --episodesId.*got: 2; DROP TABLE y/);
  });
});
