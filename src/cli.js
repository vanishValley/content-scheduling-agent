import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { runAgent } from './agent.js';
import { DraftStore } from './store.js';
import { MockProvider, providerFromEnv } from './providers.js';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, provider: { type: 'string', default: 'mock' },
    store: { type: 'string', default: '.runtime/default' }, output: { type: 'string' },
    'max-steps': { type: 'string' }
  } });
  if (!values.input) throw new Error('用法：node src/cli.js --input examples/inputs/normal.json --provider mock');
  if (!['mock', 'live'].includes(values.provider)) throw new Error('provider 只支持 mock 或 live');
  const fixture = JSON.parse(await readFile(resolve(values.input), 'utf8'));
  const world = JSON.parse(await readFile(new URL('../data/world.json', import.meta.url), 'utf8'));
  Object.assign(world, fixture.world_overrides ?? {});
  const output = await runAgent({ request: fixture.request, world, faults: fixture.faults,
    store: new DraftStore(resolve(values.store)), provider: values.provider === 'live' ? providerFromEnv() : new MockProvider(),
    maxSteps: Number(values['max-steps'] ?? fixture.max_steps ?? 12) });
  const json = JSON.stringify(output, null, 2) + '\n';
  if (values.output) { await mkdir(dirname(resolve(values.output)), { recursive: true }); await writeFile(resolve(values.output), json, 'utf8'); }
  process.stdout.write(json);
  process.exitCode = output.status === 'incomplete' ? 2 : 0;
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
