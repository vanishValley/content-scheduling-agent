import { BusinessTools } from './business-tools.js';
import { validateAction, validateRequest } from './schema.js';

export async function runAgent({ request, world, store, provider, faults = {}, maxSteps = 12 }) {
  const started_at = new Date().toISOString();
  const trace = [];
  const base = { started_at, provider: provider.info, request, max_steps: maxSteps };
  const error = validateRequest(request);
  if (error) return { ...base, status: 'needs_input', reason: error, items: [], trace };
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error('maxSteps 须为 1 至 100 的整数');
  const business = new BusinessTools({ request, world, store, faults });
  const observations = [];
  const finish = (status, reason) => ({ ...base, finished_at: new Date().toISOString(), status, reason, items: business.results(), trace });
  for (let step = 1; step <= maxSteps; step++) {
    let action;
    try { action = validateAction(await provider.next({ request, observations })); }
    catch (error) {
      trace.push({ step, type: 'model_error', error: error.message });
      return finish('incomplete', error.message);
    }
    const { metadata, ...call } = action;
    if (call.name === 'finish') {
      const items = business.results();
      trace.push({ step, action: call, result: { ok: true, code: 'FINISHED' }, model: metadata });
      const statuses = new Set(items.map(i => i.status));
      const status = statuses.has('incomplete') ? 'incomplete' : statuses.has('blocked') ? 'blocked'
        : statuses.has('needs_input') ? 'needs_input' : statuses.has('needs_confirmation') ? 'needs_confirmation' : 'completed';
      const reasons = { completed: '草稿已保存，可供人工查看；未执行发布', needs_confirmation: '建议草稿已保存，改期仍需用户确认',
        needs_input: '资料不足，请补充每项素材的待确认信息', blocked: '存在审核风险，相关素材已阻断', incomplete: '部分素材尚未完成，请检查工具结果与错误记录' };
      return finish(status, reasons[status]);
    }
    let result;
    try { result = await business.execute(call.name, call.arguments); }
    catch { result = { ok: false, code: 'TOOL_EXCEPTION', retryable: false }; }
    observations.push({ action: call, result });
    trace.push({ step, action: call, result, model: metadata });
  }
  return finish('incomplete', 'STEP_LIMIT：达到执行上限，任务未完成；已成功保存的草稿保留');
}
