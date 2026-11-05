import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveProvider } from '../src/providers.js';
const request = { material_ids: ['M01'], desired_slot: '2026-11-06T18:00:00+08:00', hard_time: true };
test('真实适配器把前一轮工具结果送回模型', async () => {
  let sent;
  const provider = new LiveProvider({ apiKey: 'test-only', baseUrl: 'https://example.invalid/v1', model: 'test', thinking: 'disabled', fetchImpl: async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ id: 'response-test', model: 'test', choices: [{ message: { tool_calls: [{ function: { name: 'query_slots', arguments: '{"material_id":"M01","reason":"已通过审核"}' } }] } }] }) };
  } });
  const result = await provider.next({ request, observations: [{ action: { name: 'check_rules', arguments: { material_id: 'M01', reason: '核对' } }, result: { ok: true, audit_status: 'passed' } }] });
  assert.equal(sent.messages.at(-1).role, 'tool');
  assert.equal(JSON.parse(sent.messages.at(-1).content).audit_status, 'passed');
  assert.equal(result.name, 'query_slots');
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.ok(!JSON.stringify(provider.info).includes('test-only'));
});
test('上游错误不记录含密钥的服务端正文', async () => {
  const provider = new LiveProvider({ apiKey: 'test-only', baseUrl: 'https://example.invalid/v1', model: 'test', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'secret' }) });
  await assert.rejects(provider.next({ request, observations: [] }), /^Error: MODEL_HTTP_401$/);
});
test('模型输出多个动作或非 JSON 时拒绝执行', async () => {
  for (const tool_calls of [[], [{ function: { name: 'finish', arguments: 'broken' } }], [{}, {}]]) {
    const provider = new LiveProvider({ apiKey: 'test-only', baseUrl: 'https://example.invalid/v1', model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls } }] }) }) });
    await assert.rejects(provider.next({ request, observations: [] }), /MODEL_PROTOCOL_ERROR/);
  }
});
