import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_TABLES, collectArchivedTables, validateArchive,
  archiveStatements, restoreArchivedTables,
} from '../lib/backup-archive.mjs';

function fixture(source = {}) {
  const tables = Object.fromEntries(
    Object.keys(ARCHIVE_TABLES).map(name => [name, (source[name] || []).map(row => ({ ...row }))]),
  );
  const photos = (source.photos || []).map(row => ({ ...row }));
  const executions = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql, values: [],
        bind(...values) {
          return {
            sql, values,
            execute() { executions.push({ sql, values }); return { meta: { changes: 1 } }; },
          };
        },
        async all() {
          const match = /^SELECT \* FROM ([a-z_]+)$/.exec(sql);
          if (match) return { results: (tables[match[1]] || []).map(row => ({ ...row })) };
          if (sql === 'SELECT id FROM photos') return { results: photos.map(p => ({ id: p.id })) };
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        const insert = /^INSERT OR IGNORE INTO ([a-z_]+) \(([^)]+)\) VALUES \((.*)\)$/.exec(s.sql);
        if (insert) {
          const name = insert[1], columns = insert[2].split(',').map(x => x.trim());
          const row = Object.fromEntries(columns.map((column, i) => [column, s.values[i]]));
          const key = ARCHIVE_TABLES[name].id;
          if (!tables[name].some(existing => existing[key] === row[key])) tables[name].push(row);
        }
        results.push(s.execute());
      }
      return results;
    },
  };
  return { db, tables, photos, executions };
}

const sample = {
  photos: [{ id: 'p1' }],
  travel_footprints: [{ id: 'f1', user_id: 'u1', city_name: '杭州', name: '西湖', lat: 30.2, lng: 120.1, photos: '[]', visit_date: '2026-10-01', note: '', color: '#e8823c', created_at: 1 }],
  truth_dare_games: [{ id: 'g1', creator_id: 'u1', partner_id: 'u2', p1_roll: 3, p2_roll: 5, status: 'finished', loser_id: 'u1', choice_type: 'truth', question_text: '问题', answer_text: '回答', created_at: 2, chat_messages: '[]', todo_created_at: null, todo_completed_at: null }],
  photo_ai: [{ photo_id: 'p1', description: '海边', tags: '[]', category: '旅行', embedding: '[0.1]', embedding_model: 'm1', updated_at: 3 }],
  videos: [{ id: 'v1', object_key: 'videos/v1', caption: '', content_type: 'video/mp4', size_bytes: 10, created_at: 4, user_id: 'u1', owner_slot: 1, status: 'ready' }],
};

test('完整备份会收集所有独立表的数据与计数', async () => {
  const f = fixture(sample);
  const archive = await collectArchivedTables(f.db);
  assert.equal(archive.version, 1);
  assert.deepEqual(archive.counts, { travel_footprints: 1, truth_dare_games: 1, photo_ai: 1, videos: 1 });
  assert.equal(archive.tables.travel_footprints[0].city_name, '杭州');
  assert.equal(archive.tables.truth_dare_games[0].answer_text, '回答');
  assert.equal(archive.tables.truth_dare_games[0].chat_messages, '[]');
});

test('恢复到空库能带回足迹、对局、AI 结果与视频索引', async () => {
  const source = fixture(sample);
  const archive = validateArchive(await collectArchivedTables(source.db));
  const target = fixture({ photos: [{ id: 'p1' }] });
  const statements = archiveStatements(target.db, archive, new Set(['p1']));
  assert.equal(statements.length, 4);
  await target.db.batch(statements);
  assert.deepEqual(target.tables.travel_footprints, sample.travel_footprints);
  assert.deepEqual(target.tables.truth_dare_games, sample.truth_dare_games);
  assert.deepEqual(target.tables.photo_ai, sample.photo_ai);
  assert.deepEqual(target.tables.videos, sample.videos);
});

test('恢复按主键合并，重复导入不会新增记录，也不会删除现有记录', async () => {
  const source = fixture(sample);
  const archive = validateArchive(await collectArchivedTables(source.db));
  const existing = { id: 'local', user_id: 'u2', city_name: '成都', name: '宽窄巷子', lat: 30.6, lng: 104.0, photos: '[]', visit_date: '2026-10-02', note: '', color: '#e8823c', created_at: 9 };
  const target = fixture({ photos: [{ id: 'p1' }], travel_footprints: [existing] });
  await restoreArchivedTables(target.db, archive);
  await restoreArchivedTables(target.db, archive);
  assert.equal(target.tables.travel_footprints.length, 2);
  assert.ok(target.tables.travel_footprints.some(row => row.id === 'local'));
  assert.ok(target.tables.travel_footprints.some(row => row.id === 'f1'));
});

test('photo_ai 只恢复仍然存在的照片，避免外键冲突', async () => {
  const archive = validateArchive({ version: 1, tables: { photo_ai: sample.photo_ai } });
  const target = fixture({ photos: [] });
  await restoreArchivedTables(target.db, archive);
  assert.equal(target.tables.photo_ai.length, 0);
  assert.equal(target.executions.length, 0);
});

test('旧备份没有附加数据时保持兼容，不生成任何语句', async () => {
  const archive = validateArchive(null);
  assert.deepEqual(archive.tables, {});
  assert.equal(archiveStatements(fixture().db, archive, null).length, 0);
  assert.equal(await restoreArchivedTables(fixture().db, archive), 0);
});

test('上传数据只保留白名单列，非法结构一律拒绝', () => {
  const cleaned = validateArchive({
    version: 1,
    tables: { travel_footprints: [{ ...sample.travel_footprints[0], injected: 'evil' }] },
  });
  assert.equal('injected' in cleaned.tables.travel_footprints[0], false);
  assert.equal(cleaned.tables.travel_footprints[0].city_name, '杭州');
  assert.throws(() => validateArchive({ version: 2, tables: {} }), /格式无效/);
  assert.throws(() => validateArchive({ version: 1, tables: { travel_footprints: 'x' } }), /格式无效/);
  assert.deepEqual(validateArchive({ version: 1, tables: { unknown_table: [] } }).tables, {});
  assert.throws(() => validateArchive({ version: 1, tables: { travel_footprints: [{ ...sample.travel_footprints[0], id: 'bad id!' }] } }), /编号无效/);
  assert.throws(() => validateArchive({ version: 1, tables: { travel_footprints: [{ ...sample.travel_footprints[0], lat: { a: 1 } }] } }), /格式无效/);
  assert.throws(() => validateArchive({ version: 1, tables: { travel_footprints: [{ ...sample.travel_footprints[0], note: 'x'.repeat(200001) }] } }), /过大/);
});

test('真实 SQLite 适配器下，恢复流程能写回独立表且重复执行幂等', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const { openDatabase } = await import('../server/storage.mjs');
  const dir = await mkdtemp(resolve(tmpdir(), 'couple-home-archive-'));
  try {
    const db = openDatabase(dir, 'drizzle');
    const now = Date.now();
    await db.prepare('INSERT OR IGNORE INTO room_state (id,data,revision,updated_at) VALUES (1,?,0,?)').bind('{}', now).run();
    const archive = validateArchive({ version: 1, tables: {
      travel_footprints: sample.travel_footprints,
      truth_dare_games: sample.truth_dare_games,
      videos: sample.videos,
    } });
    const update = await db.prepare('UPDATE room_state SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?')
      .bind('{"v":2}', now, 0).run();
    assert.equal(update.meta.changes, 1);
    assert.ok(await restoreArchivedTables(db, archive) > 0);
    const collected = await collectArchivedTables(db);
    assert.deepEqual(collected.counts, { travel_footprints: 1, truth_dare_games: 1, photo_ai: 0, videos: 1 });
    assert.equal(collected.tables.travel_footprints[0].city_name, '杭州');
    assert.equal(collected.tables.truth_dare_games[0].chat_messages, '[]');
    await restoreArchivedTables(db, archive);
    assert.equal((await collectArchivedTables(db)).counts.travel_footprints, 1);
    const conflict = await db.prepare('UPDATE room_state SET data=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?')
      .bind('{}', now, 0).run();
    assert.equal(conflict.meta.changes, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
