const at = hour => `2026-11-06T${hour}:00:00+08:00`;
const request = (id = 'M01', slot = at('19'), extra = {}) => ({ material_ids: [id], desired_slot: slot, hard_time: true, ...extra });
export const cases = [
  { name: 'normal', request: request(), expected: 'completed' },
  { name: 'missing', request: request('M02'), expected: 'needs_input' },
  { name: 'risk', request: request('M03'), expected: 'blocked' },
  { name: 'conflict', request: request('M01', at('18')), expected: 'needs_confirmation' },
  { name: 'duplicate', request: request(), expected: 'completed', repeat: 2 },
  { name: 'save-failure', request: request(), faults: { save_draft: 'always' }, expected: 'incomplete' },
  { name: 'read-failure', request: request(), faults: { read_material: 'always' }, expected: 'incomplete' },
  { name: 'supplement', request: request('M04'), expected: 'completed' },
  { name: 'changed-occupancy', request: request('M01', at('18')), world_overrides: { occupied: [at('17'), at('19')] }, expected: 'completed' },
  { name: 'confirmed-change', request: request('M01', at('18'), { approved_slot: at('19') }), expected: 'completed' },
  { name: 'no-slots', request: request(), world_overrides: { occupied: [at('17'), at('18'), at('19'), at('20')] }, expected: 'incomplete' },
  { name: 'step-limit', request: request(), maxSteps: 2, expected: 'incomplete' }
];
