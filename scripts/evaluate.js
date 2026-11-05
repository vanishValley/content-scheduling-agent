import { readFile, writeFile, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { runAgent } from '../src/agent.js';
import { DraftStore } from '../src/store.js';
import { MockProvider, providerFromEnv } from '../src/providers.js';
import { cases } from './cases.js';
import { auditRun } from '../src/evaluation.js';

const { values } = parseArgs({ options: { provider: { type: 'string', default: 'mock' }, only: { type: 'string' }, output: { type: 'string' } } });
if (!['mock', 'live'].includes(values.provider)) throw new Error('provider 只支持 mock 或 live');
const provider = values.provider === 'mock' ? new MockProvider() : providerFromEnv();
const root = resolve(values.output ?? `examples/${values.provider}`);
await mkdir(root, { recursive: true });
await mkdir('.runtime', { recursive: true });
const runtime = await mkdtemp(resolve('.runtime', `evaluation-${values.provider}-`));
const selected = values.only ? cases.filter(c => values.only.split(',').includes(c.name)) : cases;
if (!selected.length) throw new Error('没有选中任何用例');
const summary = { provider: provider.info, generated_at: new Date().toISOString(), cases: [] };
for (const test of selected) {
  await mkdir('examples/inputs', { recursive: true });
  await writeFile(`examples/inputs/${test.name}.json`, JSON.stringify({ request: test.request, world_overrides: test.world_overrides, faults: test.faults, max_steps: test.maxSteps }, null, 2) + '\n');
  const directory = join(root, test.name);
  await mkdir(directory, { recursive: true });
  await cp(`examples/inputs/${test.name}.json`, join(directory, 'input.json'));
  const world = { ...JSON.parse(await readFile('data/world.json', 'utf8')), ...test.world_overrides };
  const store = new DraftStore(join(runtime, test.name));
  const runs = [];
  for (let i = 1; i <= (test.repeat ?? 1); i++) {
    const output = await runAgent({ request: test.request, world, store, provider, faults: test.faults, maxSteps: test.maxSteps ?? 12 });
    await writeFile(join(directory, `run-${i}.json`), JSON.stringify(output, null, 2) + '\n');
    const lines = output.trace.map(t => JSON.stringify(t)).join('\n');
    await writeFile(join(directory, `trace-${i}.jsonl`), lines + (lines ? '\n' : ''));
    runs.push({ status: output.status, steps: output.trace.length, file: `run-${i}.json` });
  }
  const drafts = await store.list();
  await writeFile(join(directory, 'drafts.json'), JSON.stringify(drafts, null, 2) + '\n');
  const outputs = await Promise.all(runs.map(r => readFile(join(directory, r.file), 'utf8').then(JSON.parse)));
  const duplicateOk = test.repeat !== 2 || (drafts.length === 1 && outputs[1].items[0].save_status === 'duplicate');
  const policyViolations = outputs.flatMap((output, index) => auditRun(output).map(v => ({ run: index + 1, ...v })));
  const pass = runs.every(r => r.status === test.expected) && duplicateOk && policyViolations.length === 0;
  summary.cases.push({ name: test.name, expected: test.expected, runs, draft_count: drafts.length, policy_violations: policyViolations, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${test.name}: ${runs.map(r => r.status).join(' / ')}; drafts=${drafts.length}\n`);
}
summary.passed = summary.cases.filter(c => c.pass).length;
summary.total = summary.cases.length;
await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (summary.passed !== summary.total) process.exitCode = 2;
