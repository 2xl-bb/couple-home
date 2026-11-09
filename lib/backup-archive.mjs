import { HomeError } from './home-domain.mjs';

// 这些表不存放在 room_state 里，网页端完整备份必须单独带走。
// 列名和表名只能来自这份服务端白名单，绝不取自用户上传的 JSON。
export const ARCHIVE_TABLES = Object.freeze({
  travel_footprints: {
    id: 'id',
    maxRows: 5000,
    columns: ['id', 'user_id', 'city_name', 'name', 'lat', 'lng', 'photos', 'visit_date', 'note', 'color', 'created_at'],
  },
  truth_dare_games: {
    id: 'id',
    maxRows: 5000,
    columns: ['id', 'creator_id', 'partner_id', 'p1_roll', 'p2_roll', 'status', 'loser_id',
      'choice_type', 'question_text', 'answer_text', 'created_at', 'chat_messages',
      'todo_created_at', 'todo_completed_at'],
  },
  photo_ai: {
    id: 'photo_id',
    maxRows: 5000,
    columns: ['photo_id', 'description', 'tags', 'category', 'embedding', 'embedding_model', 'updated_at'],
    requiresPhoto: true,
  },
  videos: {
    id: 'id',
    maxRows: 5000,
    columns: ['id', 'object_key', 'caption', 'content_type', 'size_bytes', 'created_at', 'user_id', 'owner_slot', 'status'],
  },
});

export const ARCHIVE_VERSION = 1;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_CELL_CHARS = 200000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function archiveByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// SELECT * 让新增列自动进入备份，不必每次改迁移都同步改这里。
export async function collectArchivedTables(db) {
  const tables = {}, counts = {};
  for (const name of Object.keys(ARCHIVE_TABLES)) {
    const result = await db.prepare(`SELECT * FROM ${name}`).all();
    tables[name] = Array.isArray(result.results) ? result.results : [];
    counts[name] = tables[name].length;
  }
  return { version: ARCHIVE_VERSION, tables, counts };
}

// 上传的备份不可信：只保留白名单列，丢弃其余字段，限制规模与单元格长度。
export function validateArchive(raw) {
  if (raw === undefined || raw === null) return { version: ARCHIVE_VERSION, tables: {} };
  if (typeof raw !== 'object' || Array.isArray(raw) || raw.version !== ARCHIVE_VERSION ||
      !raw.tables || typeof raw.tables !== 'object' || Array.isArray(raw.tables)) {
    throw new HomeError('备份中的附加数据格式无效。');
  }
  if (archiveByteLength(raw) > MAX_ARCHIVE_BYTES) throw new HomeError('备份中的附加数据过大。', 413);
  const tables = {};
  for (const [name, definition] of Object.entries(ARCHIVE_TABLES)) {
    const rows = raw.tables[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > definition.maxRows) {
      throw new HomeError('备份中的附加数据格式无效。');
    }
    tables[name] = rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new HomeError('备份中的附加数据格式无效。');
      }
      const clean = {};
      for (const column of definition.columns) {
        const value = row[column] === undefined ? null : row[column];
        if (value !== null && typeof value === 'number' && !Number.isFinite(value)) {
          throw new HomeError('备份中的附加数据格式无效。');
        }
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
          throw new HomeError('备份中的附加数据格式无效。');
        }
        if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
          throw new HomeError('备份中的附加数据过大。', 413);
        }
        clean[column] = value;
      }
      if (typeof clean[definition.id] !== 'string' || !ID_PATTERN.test(clean[definition.id])) {
        throw new HomeError('备份中的记录编号无效。');
      }
      return clean;
    });
  }
  return { version: ARCHIVE_VERSION, tables };
}

// 合并式恢复：按主键 INSERT OR IGNORE，不删除现有记录，重复导入幂等。
// postgres.mjs 会把 INSERT OR IGNORE 转成 ON CONFLICT DO NOTHING，D1/SQLite 原生支持。
export function archiveStatements(db, archive, photoIds = null) {
  const statements = [];
  for (const [name, rows] of Object.entries(archive.tables || {})) {
    const definition = ARCHIVE_TABLES[name];
    if (!definition) continue;
    const placeholders = definition.columns.map(() => '?').join(',');
    const sql = `INSERT OR IGNORE INTO ${name} (${definition.columns.join(',')}) VALUES (${placeholders})`;
    for (const row of rows) {
      if (definition.requiresPhoto && photoIds && !photoIds.has(row[definition.id])) continue;
      statements.push(db.prepare(sql).bind(...definition.columns.map(column => row[column] ?? null)));
    }
  }
  return statements;
}

export async function restoreArchivedTables(db, archive) {
  let photoIds = null;
  if (archive.tables?.photo_ai?.length) {
    const result = await db.prepare('SELECT id FROM photos').all();
    photoIds = new Set((result.results || []).map(row => row.id));
  }
  const statements = archiveStatements(db, archive, photoIds);
  if (statements.length) await db.batch(statements);
  return statements.length;
}
