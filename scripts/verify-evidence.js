import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { root: { type: 'string', default: 'examples/mock' } } });
const summary = JSON.parse(await readFile(join(values.root, 'summary.json'), 'utf8'));
assert.ok(summary.cases.length >= 3);
for (const test of summary.cases) {
  const directory = join(values.root, test.name);
  const drafts = JSON.parse(await readFile(join(directory, 'drafts.json'), 'utf8'));
  assert.equal(new Set(drafts.map(d => d.id)).size, drafts.length, '草稿 ID 不得重复');
  drafts.forEach(d => {
    assert.equal(d.status, 'draft'); assert.equal(d.published, false);
    if (d.hard_time && d.suggested_slot !== d.requested_slot && d.approved_slot !== d.suggested_slot) {
      assert.equal(d.pending_confirmation, true); assert.equal(d.effective_slot, null);
    }
  });
  for (const entry of test.runs) {
    const run = JSON.parse(await readFile(join(directory, entry.file), 'utf8'));
    const jsonl = (await readFile(join(directory, entry.file.replace('run-', 'trace-').replace('.json', '.jsonl')), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.deepEqual(jsonl, run.trace);
    assert.equal(run.provider.kind, summary.provider.kind);
    assert.equal(run.status, test.expected);
    assert.ok(run.trace.length <= run.max_steps);
    for (const item of run.items) {
      if (['saved', 'duplicate'].includes(item.save_status)) {
        assert.ok(drafts.some(d => d.id === item.draft_id));
        assert.ok(run.trace.some(t => t.action?.name === 'save_draft' && t.action.arguments.material_id === item.material_id && t.result.ok));
      }
      if (['blocked', 'missing'].includes(item.audit_status)) assert.equal(item.save_status, 'not_attempted');
    }
    if (run.provider.kind === 'live') {
      for (const step of run.trace.filter(s => s.action)) assert.ok(step.model?.response_id, '真实动作须保留模型响应 ID');
    }
  }
  if (test.name === 'duplicate') {
    assert.equal(drafts.length, 1);
    const second = JSON.parse(await readFile(join(directory, 'run-2.json'), 'utf8'));
    assert.equal(second.items[0].save_status, 'duplicate');
  }
}
process.stdout.write(`证据核对通过：${summary.cases.length} 组 ${summary.provider.kind} 用例。\n`);
