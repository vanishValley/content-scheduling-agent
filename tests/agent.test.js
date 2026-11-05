import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/agent.js';
import { MockProvider } from '../src/providers.js';
import { DraftStore } from '../src/store.js';
import { BusinessTools } from '../src/business-tools.js';
import { cases } from '../scripts/cases.js';

const world = JSON.parse(await readFile(new URL('../data/world.json', import.meta.url), 'utf8'));
async function context(t, fixture = cases[0]) {
  const directory = await mkdtemp(join(tmpdir(), 'schedule-agent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { request: fixture.request, world: structuredClone({ ...world, ...fixture.world_overrides }), store: new DraftStore(directory),
    provider: new MockProvider(), faults: fixture.faults, maxSteps: fixture.maxSteps ?? 12 };
}
for (const fixture of cases) {
  test(`验收：${fixture.name}`, async t => {
    const ctx = await context(t, fixture);
    const result = await runAgent(ctx);
    assert.equal(result.status, fixture.expected);
    assert.ok(result.trace.length <= ctx.maxSteps);
    if (fixture.expected === 'needs_confirmation') {
      assert.equal(result.items[0].suggested_slot, '2026-11-06T19:00:00+08:00');
      assert.equal((await ctx.store.list())[0].effective_slot, null);
    }
    if (['missing', 'risk', 'save-failure', 'read-failure', 'no-slots'].includes(fixture.name)) assert.equal((await ctx.store.list()).length, 0);
    if (fixture.name === 'duplicate') {
      const repeated = await runAgent(ctx);
      assert.equal(repeated.items[0].save_status, 'duplicate');
      assert.equal((await ctx.store.list()).length, 1);
    }
    if (fixture.name === 'supplement') assert.equal(result.trace.filter(t => t.action?.name === 'read_material').length, 2);
  });
}
test('保存失败不能被模型的结束文案改成成功', async t => {
  const ctx = await context(t, cases.find(c => c.name === 'save-failure'));
  const provider = new MockProvider();
  const original = provider.next.bind(provider);
  provider.next = async state => { const action = await original(state); if (action.name === 'finish') action.arguments.reason = '已全部发布且保存成功'; return action; };
  const result = await runAgent({ ...ctx, provider });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.items[0].save_status, 'failed');
  // 模型的未核实结束文案不会成为最终结果。
  assert.ok(!result.reason.includes('已全部发布'));
});
test('未审核、未查询、越范围操作都无法保存', async t => {
  const ctx = await context(t);
  const business = new BusinessTools(ctx);
  const args = { material_id: 'M01', slot: ctx.request.desired_slot };
  assert.equal((await business.execute('save_draft', args)).code, 'READ_REQUIRED');
  await business.execute('read_material', args);
  assert.equal((await business.execute('save_draft', args)).code, 'REVIEW_REQUIRED');
  await business.execute('check_rules', args);
  assert.equal((await business.execute('save_draft', args)).code, 'AVAILABLE_SLOT_REQUIRED');
  assert.equal((await business.execute('save_draft', { ...args, material_id: 'M05' })).code, 'UNKNOWN_MATERIAL_SCOPE');
});
test('模型不能通过工具参数自行批准改期', async t => {
  const ctx = await context(t);
  const provider = { info: { kind: 'test' }, next: async () => ({ name: 'save_draft', arguments: { material_id: 'M01', slot: ctx.request.desired_slot, approved_slot: ctx.request.desired_slot, reason: '自批' } }) };
  const result = await runAgent({ ...ctx, provider });
  assert.equal(result.status, 'incomplete');
  assert.equal((await ctx.store.list()).length, 0);
});
test('保存时再次检查冲突；查询后被占用也不能写入', async t => {
  const ctx = await context(t);
  const business = new BusinessTools(ctx);
  const args = { material_id: 'M01', slot: ctx.request.desired_slot };
  for (const name of ['read_material', 'check_rules', 'query_slots']) await business.execute(name, args);
  ctx.world.occupied.push(ctx.request.desired_slot);
  assert.equal((await business.execute('save_draft', args)).code, 'SLOT_CONFLICT');
  assert.equal((await ctx.store.list()).length, 0);
});
test('不同素材不能生成两个已确认的同槽位草稿', async t => {
  const ctx = await context(t);
  await runAgent(ctx);
  const other = await runAgent({ ...ctx, request: { ...ctx.request, material_ids: ['M05'] } });
  assert.equal(other.status, 'needs_confirmation');
  const rows = await ctx.store.list();
  assert.equal(rows.filter(row => !row.pending_confirmation).length, 1);
});
test('待确认建议不占用可用时段', async t => {
  const ctx = await context(t, cases.find(c => c.name === 'conflict'));
  await runAgent(ctx);
  const normal = await runAgent({ ...ctx, request: { ...cases[0].request, material_ids: ['M05'] } });
  assert.equal(normal.status, 'completed');
});
test('多素材保留已成功结果', async t => {
  const ctx = await context(t);
  const result = await runAgent({ ...ctx, request: { ...ctx.request, material_ids: ['M01', 'M03'] } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.items[0].save_status, 'saved');
  assert.equal(result.items[1].audit_status, 'blocked');
});
test('模型网络失败保留未完成状态', async t => {
  const ctx = await context(t);
  const result = await runAgent({ ...ctx, provider: { info: { kind: 'test' }, next: async () => { throw new Error('MODEL_HTTP_503'); } } });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.trace[0].type, 'model_error');
});
test('固定循环到达上限后停止', async t => {
  const ctx = await context(t);
  const provider = { info: { kind: 'test' }, next: async () => ({ name: 'read_material', arguments: { material_id: 'M01', reason: '重复读取' } }) };
  const result = await runAgent({ ...ctx, provider, maxSteps: 3 });
  assert.equal(result.trace.length, 3);
  assert.equal(result.status, 'incomplete');
  assert.match(result.reason, /STEP_LIMIT/);
});
test('缺时间、无效日期、重复素材不调用模型', async t => {
  const ctx = await context(t);
  for (const changed of [{ desired_slot: undefined }, { desired_slot: '2026-02-30T18:00:00+08:00' }, { material_ids: ['M01', 'M01'] }, { hard_time: 'true' }]) {
    const result = await runAgent({ ...ctx, request: { ...ctx.request, ...changed }, provider: { info: {}, next: () => assert.fail('不应调用模型') } });
    assert.equal(result.status, 'needs_input');
    assert.equal(result.trace.length, 0);
  }
});
test('存储损坏时明确失败，不覆盖原数据', async t => {
  const ctx = await context(t);
  const path = join(ctx.store.directory, 'drafts.json');
  await writeFile(path, 'broken');
  const result = await runAgent(ctx);
  assert.equal(result.status, 'incomplete');
  assert.equal(await readFile(path, 'utf8'), 'broken');
});
test('真实保存抛异常也必须记为保存失败', async t => {
  const ctx = await context(t);
  ctx.store.save = async () => { throw new Error('磁盘写入失败'); };
  const result = await runAgent(ctx);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.items[0].save_status, 'failed');
  assert.equal(result.items[0].draft_id, null);
  assert.match(result.items[0].last_error, /SAVE_EXCEPTION/);
});
test('同一请求再次选择不同备选时段仍复用原草稿', async t => {
  const ctx = await context(t, cases.find(c => c.name === 'conflict'));
  const first = await runAgent(ctx);
  const policy = new MockProvider();
  const provider = { info: { kind: 'test' }, next: async state => {
    const action = await policy.next(state);
    if (action.name === 'save_draft') action.arguments.slot = '2026-11-06T20:00:00+08:00';
    return action;
  } };
  const second = await runAgent({ ...ctx, provider });
  assert.equal((await ctx.store.list()).length, 1);
  assert.equal(second.items[0].save_status, 'duplicate');
  assert.equal(second.items[0].draft_id, first.items[0].draft_id);
  assert.equal(second.items[0].suggested_slot, '2026-11-06T19:00:00+08:00');
  assert.match(second.items[0].pending_confirmation[0], /19:00/);
});
