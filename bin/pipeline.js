#!/usr/bin/env node
/**
 * pipeline.js — CLI for Pipeline run / resume / status
 *
 * Usage:
 *   node bin/pipeline.js run [--workdir <dir>] [--episode <id>]
 *   node bin/pipeline.js resume [--phase <phaseId>] [--workdir <dir>] [--episode <id>]
 *   node bin/pipeline.js status [--workdir <dir>]
 *
 * Options:
 *   --workdir <dir>     Project working directory (default: cwd)
 *   --episode <id>      Episode identifier (default: EP01)
 *   --phase <phaseId>   Phase to resume from (default: auto-detect)
 */

import { Pipeline } from '../lib/pipeline.js';

const [,, command, ...args] = process.argv;

// ─── Argument Parsing ─────────────────────────────────────────

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      opts[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

function usage() {
  console.log(`
Usage: node bin/pipeline.js <command> [options]

Commands:
  run       Run the full pipeline (skips already completed phases)
  resume    Resume pipeline from a specific phase or auto-detect
  status    Show current pipeline state and phase statuses

Options:
  --workdir <dir>     Project working directory (default: cwd)
  --episode <id>      Episode identifier (default: EP01)
  --phase <phaseId>   Phase to resume from (only for resume, default: auto-detect)

Available phases:
  requirement, art-direction, character, scenario, voice,
  scene, storyboard, camera, post-production, quality-gate
`.trim());
  process.exit(1);
}

// ─── Commands ──────────────────────────────────────────────────

async function runCommand(opts) {
  const pipeline = new Pipeline({
    workdir: opts.workdir || process.cwd(),
    episode: opts.episode || 'EP01',
    onProgress(phaseId, phaseName, status) {
      console.log(`[pipeline] ${phaseName} (${phaseId}): ${status}`);
    },
  });

  console.log(`[pipeline] Starting full pipeline in ${pipeline.workdir}`);
  const result = await pipeline.run();
  console.log('\n[pipeline] Pipeline finished.');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

async function resumeCommand(opts) {
  const pipeline = new Pipeline({
    workdir: opts.workdir || process.cwd(),
    episode: opts.episode || 'EP01',
    onProgress(phaseId, phaseName, status) {
      console.log(`[pipeline] ${phaseName} (${phaseId}): ${status}`);
    },
  });

  const fromPhase = opts.phase || null;
  console.log(`[pipeline] Resuming pipeline in ${pipeline.workdir}${fromPhase ? ` from phase=${fromPhase}` : ' (auto-detect)'}`);

  try {
    const result = await pipeline.resume(fromPhase);
    console.log('\n[pipeline] Resume finished.');
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`[pipeline] Resume failed: ${err.message}`);
    process.exit(1);
  }
}

async function statusCommand(opts) {
  const pipeline = new Pipeline({
    workdir: opts.workdir || process.cwd(),
    episode: opts.episode || 'EP01',
  });

  const status = await pipeline.getStatus();
  console.log(`Episode: ${status.episode}`);
  console.log(`Started: ${status.startedAt || 'not started'}`);
  console.log(`Completed: ${status.completedAt || 'not completed'}`);
  console.log('\nPhases:');

  for (const phase of status.phases) {
    const icon = phase.status === 'completed' ? '[done]'
      : phase.status === 'approved' ? '[approved]'
      : phase.status === 'awaiting_review' ? '[review]'
      : phase.status === 'failed' ? '[failed]'
      : '[ ]';
    console.log(`  ${icon} ${String(phase.order).padEnd(4)} ${phase.id.padEnd(18)} ${phase.name}`);
  }

  const completed = status.phases.filter(p => ['completed', 'approved'].includes(p.status)).length;
  const total = status.phases.length;
  console.log(`\nProgress: ${completed}/${total} phases completed`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  if (!command || command === '-h' || command === '--help') {
    usage();
  }

  const opts = parseArgs(args);

  switch (command) {
    case 'run':
      await runCommand(opts);
      break;
    case 'resume':
      await resumeCommand(opts);
      break;
    case 'status':
      await statusCommand(opts);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
