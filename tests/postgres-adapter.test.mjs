import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openPostgres, postgresSql } from '../server/postgres.mjs';

const schemaPath = fileURLToPath(new URL('../deploy/render-supabase/schema.sql', import.meta.url));
const migrationsPath = fileURLToPath(new URL('../deploy/render-supabase/migrations/', import.meta.url));
const connectionString = 'postgresql://example:example@localhost:6543/postgres?sslmode=require';

test('PostgreSQL translation preserves the existing photo write and deduplication conditions', () => {
  assert.deepEqual(postgresSql('INSERT OR IGNORE INTO photos (id,object_key) SELECT ?,? WHERE (SELECT COUNT(*) FROM photos)<5000'), {
    text: 'INSERT INTO photos (id,object_key) SELECT $1,$2 WHERE (SELECT COUNT(*) FROM photos)<5000 ON CONFLICT DO NOTHING', parameters: 2,
  });
  assert.equal(postgresSql('UPDATE photos SET created_at=MIN(created_at,?) WHERE id=?').text,
    'UPDATE photos SET created_at=LEAST(created_at, $1) WHERE id=$2');
  assert.throws(() => postgresSql('SELECT changes()'), /explicit PostgreSQL transaction/);
  assert.equal(postgresSql('UPDATE room_state SET data=?,revision=? WHERE id=1').text,
    'UPDATE room_state SET data=CAST($1 AS JSONB),revision=$2 WHERE id=1');
  assert.equal(postgresSql('INSERT INTO room_state (id,data,revision,updated_at) VALUES (1,?,0,?)').text,
    'INSERT INTO room_state (id,data,revision,updated_at) VALUES (1, CAST($1 AS JSONB),0,$2)');
});

test('PostgreSQL photo detail and GPS statements bind every placeholder including nulls', async () => {
  const statements=[];
  class Pool {
    async connect() { return { query: (sql, values) => this.query(sql, values), release() {} }; }
    async query(sql, values) {
      statements.push({sql,values});
      if (sql.startsWith('SELECT sha256 FROM couple_home_schema_migrations')) return {rows:[],fields:[]};
      return {command:'SELECT',rowCount:0,rows:[],fields:[]};
    }
    async end() {}
  }
  const db=await openPostgres({connectionString,schemaPath,poolFactory:Pool});
  try {
    await db.prepare('SELECT object_key FROM photos WHERE id=?').bind('import-example').first();
    assert.equal(statements.at(-1).sql,'SELECT object_key FROM photos WHERE id=$1');
    assert.deepEqual(statements.at(-1).values,['import-example']);
    await db.prepare('UPDATE photos SET latitude=COALESCE(?,latitude),longitude=COALESCE(?,longitude),location_name=COALESCE(?,location_name) WHERE id=?')
      .bind(null,null,null,'import-example').run();
    assert.equal(statements.at(-1).sql,'UPDATE photos SET latitude=COALESCE($1,latitude),longitude=COALESCE($2,longitude),location_name=COALESCE($3,location_name) WHERE id=$4');
    assert.deepEqual(statements.at(-1).values,[null,null,null,'import-example']);
    const insertSql=`INSERT OR IGNORE INTO photos (id,object_key,caption,created_at,user_id,taken_at,latitude,longitude,location_name)
      SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM photos) < ?`;
    assert.equal(postgresSql(insertSql).parameters,10);
    await db.prepare(insertSql)
      .bind('import-example','object-key','caption',1,'user','2026-01-01T00:00:00.000Z',null,null,null,5000).run();
    assert.equal(statements.at(-1).values.length,10);
    assert.match(statements.at(-1).sql,/\$10/);
  } finally { await db.close(); }
});

test('PostgreSQL connection accepts Neon or Supabase poolers and requires TLS', async () => {
  class Pool {
    async connect() { return { query: (sql, values) => this.query(sql, values), release() {} }; }
    async query(sql) {
      if (sql.startsWith('SELECT sha256 FROM couple_home_schema_migrations')) return { rows: [], fields: [] };
      return { command: 'SELECT', rowCount: 0, rows: [], fields: [] };
    }
    async end() {}
  }
  const neon = await openPostgres({
    connectionString: 'postgresql://example:example@localhost:5432/postgres?sslmode=require', schemaPath,
    poolFactory: Pool,
  });
  await neon.close();
  await assert.rejects(openPostgres({
    connectionString: 'postgresql://example:example@localhost:6543/postgres', schemaPath,
    poolFactory: Pool,
  }), /sslmode/);
});

test('PostgreSQL applies immutable incremental photo caption migrations',async()=>{
  const statements=[];
  class Pool{
    async connect(){return{query:(sql,values)=>this.query(sql,values),release(){}}}
    async query(sql,values){statements.push({sql,values});if(sql.startsWith('SELECT sha256 FROM couple_home_schema_migrations'))return{rows:[],fields:[]};return{command:'SELECT',rowCount:0,rows:[],fields:[]}}
    async end(){}
  }
  const db=await openPostgres({connectionString,schemaPath,migrationsPath,poolFactory:Pool});await db.close();
  assert.ok(statements.some(item=>item.sql.includes('CREATE TABLE photo_captions')));
  assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO couple_home_schema_migrations')&&item.values?.[0]==='0002_photo_captions.sql'));
  assert.ok(statements.some(item=>item.sql.includes('ADD COLUMN taken_at TIMESTAMPTZ')));
  assert.ok(statements.some(item=>item.sql.includes('TO_TIMESTAMP(created_at / 1000.0)')));
  assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO couple_home_schema_migrations')&&item.values?.[0]==='0003_photo_taken_at.sql'));
  assert.ok(statements.some(item=>item.sql.includes('ADD COLUMN latitude NUMERIC')));
  assert.ok(statements.some(item=>item.sql.includes('ADD COLUMN longitude NUMERIC')));
  assert.ok(statements.some(item=>item.sql.includes('ADD COLUMN location_name VARCHAR(160)')));
  assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO couple_home_schema_migrations')&&item.values?.[0]==='0004_photo_gps.sql'));
});

test('a failed room compare-and-swap rolls back its event claim', async () => {
  const statements = [];
  class Pool {
    async connect() { return { query: (sql, values) => this.query(sql, values), release() {} }; }
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.startsWith('SELECT sha256 FROM couple_home_schema_migrations')) return { rows: [], fields: [] };
      if (sql.startsWith('INSERT INTO home_events')) return { command: 'INSERT', rowCount: 1, rows: [], fields: [] };
      if (sql.startsWith('UPDATE room_state')) return { command: 'UPDATE', rowCount: 0, rows: [], fields: [] };
      return { command: 'SELECT', rowCount: 0, rows: [], fields: [] };
    }
    async end() {}
  }
  const db = await openPostgres({ connectionString, schemaPath, poolFactory: Pool });
  try {
    const result = await db.updateRoomWithEvent({ opId: 'event', data: '{}', revision: 2, now: 1, priorRevision: 1 });
    assert.equal(result.meta.changes, 0);
    const claim = statements.findIndex(item => item.sql.startsWith('INSERT INTO home_events'));
    assert.equal(statements[claim - 1].sql, 'BEGIN');
    assert.equal(statements.at(-1).sql, 'ROLLBACK');
  } finally { await db.close(); }
});
