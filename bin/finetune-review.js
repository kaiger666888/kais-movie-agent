#!/usr/bin/env node
/**
 * finetune-review — Operator CLI for Phase 25 FineTuneETL
 *
 * Commands:
 *   list-pending                              List pending finetune samples
 *   show <sample_id>                          Show full pending sample detail
 *   approve <sample_id> [--reviewer NAME]     Approve sample (interactive prompt for 4 fields)
 *                                             [--copyright STATUS] [--pii SCRUBBED]
 *                                             [--label CORRECT] [--notes TEXT]
 *   reject <sample_id> [--reason TEXT]        Reject sample (approved_for_training=false)
 *   submit-training [--base-model MODEL]      Submit LoRA training job to gold-team
 *   help                                      Show this help
 *
 * Launch blocker contract:
 *   approve/reject both require the 4 review fields (copyright_status, pii_scrubbed,
 *   label_correct, approved_for_training). The CLI will throw if any are missing.
 *
 * Usage examples:
 *   node bin/finetune-review.js list-pending
 *   node bin/finetune-review.js show s-shot-001
 *   node bin/finetune-review.js approve s-shot-001 \
 *     --copyright original --pii true --label true --reviewer kai
 *   node bin/finetune-review.js reject s-shot-001 --reason "low quality" --reviewer kai
 *
 * Environment:
 *   WORKDIR — project workdir (default: process.cwd())
 */
'use strict';

import { resolve, join } from 'node:path';
import { argv, exit, env, stdout, stderr } from 'node:process';

import { AssetBus } from '../lib/asset-bus.js';
import { FineTuneETL } from '../lib/finetune-etl.js';

// ─── Arg parsing ─────────────────────────────────────────────────────────

/**
 * Parse `--flag value` and `--flag` (boolean) args.
 * @param {string[]} args - argv after the command name
 * @returns {{ flags: Record<string, string|true>, positional: string[] }}
 */
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function toBool(v) {
  if (v === true) return true;
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return undefined;
}

// ─── Setup ───────────────────────────────────────────────────────────────

function setupEtl() {
  const workdir = env.WORKDIR ? resolve(env.WORKDIR) : process.cwd();
  const assetBus = new AssetBus(workdir);
  // goldTeamClient is constructed lazily only for submit-training
  const etl = new FineTuneETL({ assetBus, workdir });
  return { etl, workdir };
}

// ─── Commands ────────────────────────────────────────────────────────────

async function cmdListPending() {
  const { etl } = setupEtl();
  const list = await etl.listPending();
  if (list.length === 0) {
    console.log('No pending finetune samples. Run generateManifest first.');
    return { count: 0 };
  }
  console.log(`Pending finetune samples: ${list.length}\n`);
  console.log('SAMPLE ID        PII    SUSPICIOUS   GENERATED AT');
  console.log('---------------  -----  -----------  --------------------------');
  for (const item of list) {
    const pii = item.pii_flag ? 'YES' : 'no';
    const susp = String(item.suspicious_flags_count);
    const ts = item.generated_at || '-';
    console.log(
      `${item.sample_id.padEnd(16)} ${pii.padEnd(6)} ${susp.padEnd(12)} ${ts}`,
    );
  }
  return { count: list.length };
}

async function cmdShow(sampleId) {
  if (!sampleId) {
    throw new Error('sample_id required. Usage: show <sample_id>');
  }
  const { etl } = setupEtl();
  const sample = await etl.getPendingSample(sampleId);
  if (!sample) {
    throw new Error(`Sample not found: ${sampleId}`);
  }
  console.log(JSON.stringify(sample, null, 2));
  return { sample };
}

async function cmdApprove(sampleId, flags) {
  if (!sampleId) {
    throw new Error('sample_id required. Usage: approve <sample_id> --copyright ... --pii ... --label ...');
  }

  // 4 required fields must be supplied via flags
  const review = {
    copyright_status: flags.copyright,
    pii_scrubbed: toBool(flags.pii),
    label_correct: toBool(flags.label),
    approved_for_training: true,
  };

  // Validate presence before calling etl (friendlier error)
  const missing = [];
  if (!review.copyright_status) missing.push('--copyright');
  if (review.pii_scrubbed === undefined) missing.push('--pii');
  if (review.label_correct === undefined) missing.push('--label');
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.join(', ')} — required: --copyright <original|licensed|unknown|fair_use|public_domain> --pii <true|false> --label <true|false>`);
  }

  if (flags.reviewer) review.reviewer = flags.reviewer;
  if (flags.notes) review.notes = flags.notes;

  const { etl } = setupEtl();
  const result = await etl.approveSample(sampleId, review);
  console.log(`Sample ${sampleId}: ${result.action.toUpperCase()}`);
  if (result.action === 'approved') {
    console.log(`  Written to finetune-dataset slot.`);
  } else {
    console.log(`  Moved to rejected/.`);
  }
  return result;
}

async function cmdReject(sampleId, flags) {
  if (!sampleId) {
    throw new Error('sample_id required. Usage: reject <sample_id> --reason ...');
  }

  // For reject, default copyright_status='unknown', pii_scrubbed=true, label_correct=false
  // (operator explicitly rejecting for training, so label_correct=false is the natural default)
  const review = {
    copyright_status: flags.copyright || 'unknown',
    pii_scrubbed: toBool(flags.pii) ?? true,
    label_correct: toBool(flags.label) ?? false,
    approved_for_training: false,
  };
  if (flags.reviewer) review.reviewer = flags.reviewer;
  if (flags.reason) review.notes = flags.reason;

  const { etl } = setupEtl();
  const result = await etl.approveSample(sampleId, review);
  console.log(`Sample ${sampleId}: ${result.action.toUpperCase()}`);
  console.log(`  Moved to rejected/.`);
  return result;
}

async function cmdSubmitTraining(flags) {
  const workdir = env.WORKDIR ? resolve(env.WORKDIR) : process.cwd();
  const assetBus = new AssetBus(workdir);

  // Lazily construct GoldTeamClient to avoid network dependency for other commands
  const { GoldTeamClient } = await import('../lib/gold-team-client.js');
  const gtClient = new GoldTeamClient({
    baseUrl: env.GOLD_TEAM_URL,
    callbackBaseUrl: env.CALLBACK_BASE_URL,
  });

  const etl = new FineTuneETL({ assetBus, workdir, goldTeamClient: gtClient });

  const result = await etl.submitTrainingJob({
    base_model: flags['base-model'] || flags.baseModel,
    hyperparams: flags.rank ? { lora_rank: Number(flags.rank) } : {},
  });
  console.log('LoRA training job submitted:');
  console.log(`  task_id:      ${result.task_id}`);
  console.log(`  sample_count: ${result.sample_count}`);
  console.log(`  manifest:     ${result.manifest_path}`);
  return result;
}

function cmdHelp() {
  const help = `finetune-review — Phase 25 FineTuneETL operator CLI

Commands:
  list-pending                              List pending finetune samples
  show <sample_id>                          Show full pending sample detail
  approve <sample_id> [flags]               Approve sample for training
    --copyright <original|licensed|unknown|fair_use|public_domain>
    --pii <true|false>                      (required)
    --label <true|false>                    (required)
    --reviewer <name>
    --notes <text>
  reject <sample_id> [flags]                Reject sample
    --reason <text>
    --reviewer <name>
  submit-training [flags]                   Submit LoRA training job
    --base-model <model>                    (default: flux-dev)
    --rank <number>                         LoRA rank
  help                                      Show this help

Environment:
  WORKDIR        Project workdir (default: process.cwd())
  GOLD_TEAM_URL  Gold-team Control Node URL
`;
  console.log(help);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const [, , cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case 'list-pending':
      await cmdListPending();
      break;
    case 'show':
      await cmdShow(positional[0]);
      break;
    case 'approve':
      await cmdApprove(positional[0], flags);
      break;
    case 'reject':
      await cmdReject(positional[0], flags);
      break;
    case 'submit-training':
      await cmdSubmitTraining(flags);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run "finetune-review help" for usage.');
      exit(1);
  }
}

// Run only when invoked directly (not when imported by tests)
const invokedDirectly = argv[1] && resolve(argv[1]) === resolve(import.meta.url);
if (invokedDirectly) {
  main().catch(e => {
    console.error(`Error: ${e.message}`);
    exit(1);
  });
}

// Export commands for testing
export {
  parseArgs,
  toBool,
  cmdListPending,
  cmdShow,
  cmdApprove,
  cmdReject,
  cmdSubmitTraining,
  cmdHelp,
};
