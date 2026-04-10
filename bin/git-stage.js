#!/usr/bin/env node
// git-stage — CLI for GitStageManager
// Usage:
//   git-stage log <workdir>
//   git-stage rollback <workdir> <stage>
//   git-stage diff <workdir> <stageA> <stageB>
//   git-stage current <workdir>

import { GitStageManager } from '../lib/git-stage-manager.js';

const [,, command, ...args] = process.argv;

function usage() {
  console.log(`
Usage: git-stage <command> [args]

Commands:
  log       <workdir>                   Show stage commit history
  current   <workdir>                   Show current stage
  rollback  <workdir> <stage>           Rollback to a stage checkpoint
  diff      <workdir> <stageA> <stageB> Diff two stages
`.trim());
  process.exit(1);
}

async function main() {
  if (!command || command === '-h' || command === '--help') {
    usage();
  }

  const workdir = args[0];
  if (!workdir) {
    console.error('Error: workdir is required');
    usage();
  }

  const mgr = new GitStageManager(workdir);

  switch (command) {
    case 'log': {
      const commits = await mgr.log();
      if (!commits.length) {
        console.log('No stage checkpoints found.');
        break;
      }
      for (const c of commits) {
        console.log(`[${c.stage || 'unknown'}] ${c.hash.slice(0, 8)} ${c.date}`);
        console.log(`  ${c.message}`);
        if (c.metadata.files) {
          console.log(`  files: ${c.metadata.files.join(', ')}`);
        }
        console.log();
      }
      break;
    }

    case 'current': {
      const cur = await mgr.getCurrentStage();
      if (!cur) {
        console.log('No stage checkpoints found.');
        break;
      }
      console.log(`Current: ${cur.label} (${cur.stage})`);
      console.log(`  hash: ${cur.hash.slice(0, 8)}`);
      console.log(`  date: ${cur.date}`);
      break;
    }

    case 'rollback': {
      const stage = args[1];
      if (!stage) {
        console.error('Error: target stage is required');
        usage();
      }
      const result = await mgr.rollback(undefined, stage);
      console.log(`Rolled back to: ${result.stage} (${result.hash.slice(0, 8)})`);
      if (result.stashed) {
        console.log('Note: uncommitted changes were stashed. Use "git stash pop" to restore.');
      }
      break;
    }

    case 'diff': {
      const [stageA, stageB] = args.slice(1);
      if (!stageA || !stageB) {
        console.error('Error: two stage names are required');
        usage();
      }
      const result = await mgr.diff(undefined, stageA, stageB);
      console.log(`Diff: ${result.stageA.name} (${result.stageA.hash.slice(0, 8)}) → ${result.stageB.name} (${result.stageB.hash.slice(0, 8)})`);
      console.log();
      console.log(result.stat);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
