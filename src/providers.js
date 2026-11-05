import { systemPrompt } from './prompt.js';
import { tools } from './schema.js';

// 离线替身：条件策略仅验证流程，不构成真实模型 ReAct 的证明。
export class MockProvider {
  info = { kind: 'mock', model: 'deterministic-fixture-policy' };
  async next({ request, observations }) {
    const action = (name, args, reason) => ({ name, arguments: { ...args, reason } });
    for (const material_id of request.material_ids) {
      const history = observations.filter(o => o.action.arguments.material_id === material_id);
      const latest = name => history.filter(o => o.action.name === name).at(-1)?.result;
      const read = latest('read_material'); const review = latest('check_rules'); const slots = latest('query_slots'); const save = latest('save_draft');
      if (!read) return action('read_material', { material_id }, '先核对素材元数据');
      if (!read.ok) {
        if (read.retryable && history.filter(o => o.action.name === 'read_material').length < 2) return action('read_material', { material_id }, '读取暂时失败，补查一次');
        continue;
      }
      if (!review || history.at(-1).action.name === 'read_material') return action('check_rules', { material_id }, '核对已读取资料是否符合规则');
      if (!review.ok) continue;
      if (review.audit_status === 'missing' && read.supplement_available && history.filter(o => o.action.name === 'read_material').length === 1)
        return action('read_material', { material_id }, '资料缺字段，读取已存在的补充资料');
      if (review.audit_status !== 'passed') continue;
      if (!slots || (!slots.ok && slots.retryable && history.filter(o => o.action.name === 'query_slots').length < 2)) return action('query_slots', { material_id }, '审核通过，核对可用时段');
      if (!slots.ok) continue;
      if (save?.ok) continue;
      if (save && (!save.retryable || history.filter(o => o.action.name === 'save_draft').length >= 2)) continue;
      const available = slots.slots.filter(s => s.available);
      const chosen = available.find(s => s.slot === (request.approved_slot ?? request.desired_slot)) ??
        available.sort((a, b) => Math.abs(Date.parse(a.slot) - Date.parse(request.desired_slot)) - Math.abs(Date.parse(b.slot) - Date.parse(request.desired_slot)))[0];
      if (!chosen) continue;
      return action('save_draft', { material_id, slot: chosen.slot }, chosen.slot === request.desired_slot ? '要求时段空闲，保存草稿' : '要求时段冲突，保存备选建议并保留确认边界');
    }
    return action('finish', {}, '已取得保存结果，或现有资料不足以继续');
  }
}

export class LiveProvider {
  constructor({ apiKey, baseUrl, model, thinking, timeoutMs = 60000, fetchImpl = fetch }) {
    if (!apiKey || !baseUrl || !model) throw new Error('真实模式需要 AGENT_API_KEY、AGENT_BASE_URL、AGENT_MODEL');
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('模型服务须使用 HTTPS');
    this.endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    this.apiKey = apiKey; this.model = model; this.timeoutMs = timeoutMs; this.fetchImpl = fetchImpl;
    if (thinking !== undefined && thinking !== 'disabled') throw new Error('AGENT_THINKING 仅支持 disabled 或留空');
    this.thinking = thinking;
    this.info = { kind: 'live', model, endpoint_host: url.host, protocol: 'chat-completions-tools', thinking: thinking ?? 'service-default' };
  }
  async next({ request, observations }) {
    const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify(request) }];
    observations.forEach((o, index) => {
      const id = `call_${index}`;
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: o.action.name, arguments: JSON.stringify(o.action.arguments) } }] });
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(o.result) });
    });
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, tools, tool_choice: 'auto', max_tokens: 1000,
          ...(this.thinking ? { thinking: { type: this.thinking } } : {}) })
      });
    } catch { throw new Error('MODEL_NETWORK_ERROR：网络失败或超时'); }
    // 不保存服务端错误正文，避免上游回显凭据。
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const body = await response.json();
    const calls = body.choices?.[0]?.message?.tool_calls;
    if (!calls || calls.length !== 1) throw new Error('MODEL_PROTOCOL_ERROR：须返回一个工具动作');
    let args;
    try { args = JSON.parse(calls[0].function.arguments); } catch { throw new Error('MODEL_PROTOCOL_ERROR：参数不是 JSON'); }
    return { name: calls[0].function.name, arguments: args, metadata: { response_id: body.id ?? null, model: body.model ?? this.model, usage: body.usage ?? null } };
  }
}

export function providerFromEnv(env = process.env) {
  return new LiveProvider({ apiKey: env.AGENT_API_KEY, baseUrl: env.AGENT_BASE_URL, model: env.AGENT_MODEL,
    thinking: env.AGENT_THINKING || undefined, timeoutMs: Number(env.AGENT_TIMEOUT_MS ?? 60000) });
}
