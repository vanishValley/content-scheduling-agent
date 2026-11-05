import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// 同一存储目录采用排他锁。锁冲突明确失败，不悄悄覆盖其他进程。
export class DraftStore {
  constructor(directory) { this.directory = directory; }
  async list() {
    try { return JSON.parse(await readFile(join(this.directory, 'drafts.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async save(draft, occupied, fail = false) {
    await mkdir(this.directory, { recursive: true });
    const lock = join(this.directory, 'drafts.lock');
    try { await writeFile(lock, '', { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return { ok: false, code: 'STORE_BUSY' }; throw error; }
    try {
      const rows = await this.list();
      const existing = rows.find(row => row.id === draft.id);
      if (existing) return { ok: true, duplicate: true, draft: existing };
      // 待确认草稿不预约时段；已确认草稿之间按北京时间槽位互斥。
      if (occupied.includes(draft.suggested_slot) || rows.some(row =>
        !row.pending_confirmation && row.suggested_slot === draft.suggested_slot)) {
        return { ok: false, code: 'SLOT_CONFLICT' };
      }
      if (fail) return { ok: false, code: 'SAVE_FAILED' };
      rows.push(draft);
      const temp = join(this.directory, 'drafts.json.tmp');
      await writeFile(temp, JSON.stringify(rows, null, 2) + '\n', 'utf8');
      await rename(temp, join(this.directory, 'drafts.json'));
      return { ok: true, duplicate: false, draft };
    } finally { await unlink(lock); }
  }
}
