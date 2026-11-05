const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const item = { material_id: str, reason: { type: 'string', description: '一句可核对的动作依据，不要输出内部思维过程。' } };
export const tools = [
  ['read_material', '读取素材元数据；资料缺失时可补查一次。', object(item, ['material_id', 'reason'])],
  ['check_rules', '检查已读取素材的必填项、版权和禁用声明。未通过不得保存。', object(item, ['material_id', 'reason'])],
  ['query_slots', '查询期望时段及同日备选时段。工具只返回空闲状态，不替用户批准改期。', object(item, ['material_id', 'reason'])],
  ['save_draft', '仅当最近审核 audit_status 为 passed 时保存草稿；missing 或 blocked 不得调用。偏离硬性要求且无用户批准时自动待确认，不占用排期。', object({ ...item, slot: str }, ['material_id', 'slot', 'reason'])],
  ['finish', '结束本次处理。结果由已观察到的审核与保存记录生成；没有成功记录不能声称保存成功。', object({ reason: str }, ['reason'])]
].map(([name, description, parameters]) => ({ type: 'function', function: { name, description, parameters } }));

export function validateAction(action) {
  if (!action || typeof action !== 'object') throw new Error('动作必须是对象');
  const spec = tools.find(t => t.function.name === action.name)?.function.parameters;
  if (!spec) throw new Error('未知动作');
  const args = action.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
  if (Object.keys(args).some(k => !(k in spec.properties))) throw new Error('工具参数含未定义字段');
  for (const key of spec.required) {
    if (typeof args[key] !== 'string' || !args[key].trim()) throw new Error(`工具参数 ${key} 必须是非空字符串`);
  }
  return action;
}

export function validateRequest(request) {
  if (!request || typeof request !== 'object') return 'request 必须是对象';
  if (!Array.isArray(request.material_ids) || !request.material_ids.length || request.material_ids.length > 10 ||
      request.material_ids.some(id => typeof id !== 'string' || !id.trim())) return 'material_ids 须包含 1 至 10 个素材 ID';
  if (new Set(request.material_ids).size !== request.material_ids.length) return 'material_ids 不能重复';
  const validSlot = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(x) &&
    !Number.isNaN(Date.parse(x)) && new Date(Date.parse(x) + 8 * 3600000).toISOString().slice(0, 19) === x.slice(0, 19);
  if (!validSlot(request.desired_slot)) return 'desired_slot 须为有效的北京时间，如 2026-11-06T18:00:00+08:00';
  if (typeof request.hard_time !== 'boolean') return 'hard_time 须明确为 true 或 false';
  if (request.approved_slot !== undefined && !validSlot(request.approved_slot)) return 'approved_slot 格式不正确';
  return null;
}
