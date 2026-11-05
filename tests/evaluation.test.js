import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditRun } from '../src/evaluation.js';

test('真实回归记录：最终需补资料也不能掩盖违规保存尝试', async () => {
  const run = JSON.parse(await readFile(new URL('../examples/regressions/missing-before-clarification/run-1.json', import.meta.url), 'utf8'));
  assert.equal(run.status, 'needs_input');
  assert.deepEqual(auditRun(run), [{ step: 4, material_id: 'M02', code: 'SAVE_WITHOUT_PASSED_REVIEW' }]);
});
