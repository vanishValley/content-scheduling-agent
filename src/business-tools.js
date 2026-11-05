import { createHash } from 'node:crypto';

export class BusinessTools {
  constructor({ request, world, store, faults = {} }) {
    this.request = request; this.world = world; this.store = store; this.faults = faults;
    this.calls = {}; this.items = Object.fromEntries(request.material_ids.map(id => [id, {
      material_id: id, audit_status: 'unchecked', risks: [], missing_fields: [], suggested_slot: null,
      pending_confirmation: [], save_status: 'not_attempted', draft_id: null
    }]));
  }
  async execute(name, args) {
    const id = args.material_id;
    if (!this.items[id]) return { ok: false, code: 'UNKNOWN_MATERIAL_SCOPE' };
    const state = this.items[id];
    const key = `${name}:${id}`;
    this.calls[key] = (this.calls[key] ?? 0) + 1;
    const fail = this.faults[name];
    if (name !== 'save_draft' && (fail === 'always' || fail === this.calls[key])) {
      state.last_error = `${name}:TOOL_UNAVAILABLE`;
      return { ok: false, code: 'TOOL_UNAVAILABLE', retryable: fail !== 'always' };
    }
    if (name === 'read_material') {
      const material = this.world.materials[id];
      if (!material) { state.audit_status = 'missing'; state.missing_fields = ['material']; return { ok: false, code: 'NOT_FOUND' }; }
      // 第二次读取用于模拟补查资料，不凭空填字段。
      const supplement = this.calls[key] > 1 ? this.world.supplements?.[id] : undefined;
      state.material = { ...material, ...supplement };
      delete state.last_error;
      return { ok: true, material: state.material, supplement_available: Boolean(this.world.supplements?.[id]) };
    }
    if (!state.material) return { ok: false, code: 'READ_REQUIRED' };
    if (name === 'check_rules') {
      state.missing_fields = this.world.rules.required_fields.filter(field => state.material[field] === undefined || state.material[field] === null || String(state.material[field]).trim() === '');
      state.risks = [];
      if (state.material.rights === 'unknown') state.risks.push('版权归属未确认');
      if (state.material.rights && !['owned', 'licensed', 'unknown'].includes(state.material.rights)) state.risks.push('版权字段值无法识别');
      for (const claim of this.world.rules.banned_claims) {
        if (String(state.material.description ?? '').includes(claim)) state.risks.push(`命中禁用声明：${claim}`);
      }
      state.audit_status = state.missing_fields.length ? 'missing' : state.risks.length ? 'blocked' : 'passed';
      state.reviewed_material = JSON.stringify(state.material);
      delete state.last_error;
      return { ok: true, audit_status: state.audit_status, missing_fields: state.missing_fields, risks: state.risks };
    }
    if (name === 'query_slots') {
      const rows = await this.store.list();
      const occupied = new Set([...this.world.occupied, ...rows.filter(row => !row.pending_confirmation &&
        !this.sameRequest(row, id)).map(row => row.suggested_slot)]);
      const slots = this.world.slots.filter(slot => slot.slice(0, 10) === this.request.desired_slot.slice(0, 10))
        .map(slot => ({ slot, available: !occupied.has(slot) }));
      state.slot_observation = slots;
      delete state.last_error;
      if (!slots.some(slot => slot.available)) state.last_error = 'query_slots:NO_AVAILABLE_SLOT';
      return { ok: true, desired_slot: this.request.desired_slot, slots };
    }
    if (name === 'save_draft') {
      if (state.audit_status !== 'passed' || state.reviewed_material !== JSON.stringify(state.material)) return { ok: false, code: 'REVIEW_REQUIRED' };
      if (!state.slot_observation?.some(row => row.slot === args.slot && row.available)) return { ok: false, code: 'AVAILABLE_SLOT_REQUIRED' };
      const changed = args.slot !== this.request.desired_slot;
      const pending = changed && this.request.hard_time && this.request.approved_slot !== args.slot;
      const draft = {
        id: this.draftId(id, args.slot), material_id: id, requested_slot: this.request.desired_slot,
        hard_time: this.request.hard_time, approved_slot: this.request.approved_slot ?? null,
        suggested_slot: args.slot, effective_slot: pending ? null : args.slot,
        pending_confirmation: pending, status: 'draft', published: false,
        material_fingerprint: createHash('sha256').update(JSON.stringify(state.material)).digest('hex')
      };
      state.suggested_slot = args.slot;
      state.pending_confirmation = pending ? [`原要求 ${this.request.desired_slot}；建议 ${args.slot}，请用户确认改期`] : [];
      let result;
      try { result = await this.store.save(draft, this.world.occupied, fail === 'always' || fail === this.calls[key]); }
      catch { result = { ok: false, code: 'SAVE_EXCEPTION', retryable: false }; }
      state.save_status = result.ok ? result.duplicate ? 'duplicate' : 'saved' : 'failed';
      state.draft_id = result.ok ? result.draft.id : null;
      if (!result.ok) state.last_error = `save_draft:${result.code}`;
      else delete state.last_error;
      return result;
    }
    return { ok: false, code: 'UNKNOWN_TOOL' };
  }
  draftId(id, slot) {
    const canonical = [id, this.request.desired_slot, this.request.hard_time, this.request.approved_slot ?? null, slot, this.items[id].material];
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
  }
  sameRequest(row, id) {
    return row.material_id === id && row.requested_slot === this.request.desired_slot && row.hard_time === this.request.hard_time &&
      row.approved_slot === (this.request.approved_slot ?? null) && row.material_fingerprint ===
      createHash('sha256').update(JSON.stringify(this.items[id].material)).digest('hex');
  }
  results() {
    return Object.values(this.items).map(state => {
      const { material, reviewed_material, slot_observation, ...result } = state;
      result.pending_confirmation = [...result.pending_confirmation];
      if (result.audit_status === 'missing') result.pending_confirmation.push(`请补充：${result.missing_fields.join('、')}`);
      if (result.audit_status === 'blocked') result.pending_confirmation.push('请处理审核风险后重新提交');
      result.status = ['saved', 'duplicate'].includes(result.save_status) ? result.pending_confirmation.length ? 'needs_confirmation' : 'completed'
        : result.audit_status === 'blocked' ? 'blocked' : result.audit_status === 'missing' ? 'needs_input' : 'incomplete';
      return result;
    });
  }
}
