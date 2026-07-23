/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { scoreCase, type CaseScore, type EvalCase } from '../src/eval/match';
import { costForUsage, formatTokens, formatUsd } from '../src/vision/cost';
import { createClaudeProvider } from '../src/vision/claudeProvider';
import { createFixtureProvider } from '../src/vision/fixtureProvider';
import { createOpenAiProvider } from '../src/vision/openaiProvider';
import type { VisionProvider, VisionUsage } from '../src/vision/provider';

/**
 * Ground-truth eval harness (dogfood #2, POLISH.md pass 5):
 *
 *   npm run eval                     # fixture engine (free, proves the harness)
 *   npm run eval -- --engine openai  # needs OPENAI_API_KEY in the env
 *   npm run eval -- --engine claude  # needs ANTHROPIC_API_KEY in the env
 *   npm run eval -- --case handtools-box
 *
 * Keys come from YOUR shell environment at run time — they are never
 * stored, logged, or committed. The local (ML Kit) engine can't run in
 * node; it's evaluated on-device instead.
 */
const ROOT = path.resolve(__dirname, '..');

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}

function resolveEngine(engine: string): VisionProvider {
  if (engine === 'fixture') return createFixtureProvider({ delayMs: 0 });
  if (engine === 'openai') {
    return createOpenAiProvider(async () => process.env.OPENAI_API_KEY ?? null);
  }
  if (engine === 'claude') {
    return createClaudeProvider(async () => process.env.ANTHROPIC_API_KEY ?? null);
  }
  if (engine === 'local') {
    console.error('The local engine needs the on-device ML Kit module — run it via the app.');
    process.exit(2);
  }
  console.error(`Unknown engine "${engine}" — use fixture | openai | claude.`);
  process.exit(2);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

async function main() {
  const engine = arg('engine') ?? 'fixture';
  const onlyCase = arg('case');
  const provider = resolveEngine(engine);

  const labels = JSON.parse(readFileSync(path.join(ROOT, 'eval', 'labels.json'), 'utf8')) as {
    cases: EvalCase[];
  };
  const cases = labels.cases.filter((c) => !onlyCase || c.id === onlyCase);
  if (cases.length === 0) {
    console.error(`No cases matched "${onlyCase ?? ''}".`);
    process.exit(2);
  }

  console.log(`\nBinocular eval — engine: ${engine}, cases: ${cases.length}\n`);
  const scores: CaseScore[] = [];
  let totalUsage: VisionUsage | null = null;

  for (const evalCase of cases) {
    const photoBase64 = readFileSync(path.join(ROOT, evalCase.photo)).toString('base64');
    const started = Date.now();
    const { result, usage } = await provider.recognize([photoBase64], {
      mode: 'bin_audit',
      binName: evalCase.binName,
    });
    const elapsed = Date.now() - started;
    const score = scoreCase(evalCase, result);
    scores.push(score);
    if (usage) {
      totalUsage = totalUsage
        ? {
            inputTokens: totalUsage.inputTokens + usage.inputTokens,
            outputTokens: totalUsage.outputTokens + usage.outputTokens,
            model: usage.model,
          }
        : usage;
    }

    console.log(`▪ ${evalCase.id}  (${elapsed}ms)`);
    console.log(`  recall ${pct(score.recall)}  precision ${pct(score.precision)}`);
    if (score.matchedExpected.length > 0) console.log(`  found:   ${score.matchedExpected.join(', ')}`);
    if (score.missedExpected.length > 0) console.log(`  missed:  ${score.missedExpected.join(', ')}`);
    if (score.unmatchedDetected.length > 0) {
      console.log(`  extra:   ${score.unmatchedDetected.join(', ')}`);
    }
    console.log('');
  }

  const recall = scores.reduce((s, c) => s + c.recall, 0) / scores.length;
  const precision = scores.reduce((s, c) => s + c.precision, 0) / scores.length;
  console.log('── totals ──────────────────────────────');
  console.log(`recall ${pct(recall)}   precision ${pct(precision)}   (macro-averaged)`);
  if (totalUsage && (engine === 'openai' || engine === 'claude')) {
    const usd = costForUsage(engine, totalUsage);
    console.log(
      `measured usage: ${formatTokens(totalUsage.inputTokens)} in / ` +
        `${formatTokens(totalUsage.outputTokens)} out` +
        (usd !== null ? ` · ${formatUsd(usd)}` : ''),
    );
  }
  if (engine === 'fixture') {
    console.log('(fixture returns canned data unrelated to the photos — low scores here');
    console.log(' are expected; this run proves the harness plumbing, not accuracy.)');
  }
}

void main();
