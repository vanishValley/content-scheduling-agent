import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
const files = readdirSync('tests').filter(file => file.endsWith('.test.js')).map(file => `tests/${file}`);
const started_at = new Date().toISOString();
const run = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8' });
await mkdir('examples/test-results', { recursive: true });
await writeFile('examples/test-results/node-test.tap', run.stdout + run.stderr);
const summary = { command: 'node scripts/run-tests.js', started_at, finished_at: new Date().toISOString(), node: process.version,
  exit_code: run.status, tests: Number(run.stdout.match(/# tests (\d+)/)?.[1]), passed: Number(run.stdout.match(/# pass (\d+)/)?.[1]),
  failed: Number(run.stdout.match(/# fail (\d+)/)?.[1]) };
await writeFile('examples/test-results/summary.json', JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(run.stdout + run.stderr);
process.exitCode = run.status ?? 1;
