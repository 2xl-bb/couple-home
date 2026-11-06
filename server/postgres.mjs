import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// The application uses a small D1-shaped query interface. Keep SQLite-only SQL
// changes explicit, so a new query cannot silently acquire different semantics.
export function postgresSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL is required');
  if (/\bchanges\s*\(/i.test(sql)) throw new Error('SQLite changes() requires an explicit PostgreSQL transaction');
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);
  let converted = sql.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, '$1INSERT INTO')
    .replace(/\bMIN\s*\(\s*created_at\s*,\s*\?\s*\)/gi, 'LEAST(created_at, ?)')
    // Keep the D1-facing API text-shaped while storing room state as JSONB.
    .replace(/(UPDATE\s+room_state\s+SET\s+data\s*=)\s*\?/i, '$1CAST(? AS JSONB)')
    .replace(/(INSERT\s+(?:INTO\s+)?room_state\s*\([^)]*\bdata\b[^)]*\)\s*VALUES\s*\(\s*1\s*,)\s*\?/i,
      '$1 CAST(? AS JSONB)');
  let index = 0;
  // Placeholder replacement must leave quoted text and SQL comments intact.
  converted = converted.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\?/g,
    match => match === '?' ? `$${++index}` : match);
  if (ignore) converted += ' ON CONFLICT DO NOTHING';
  return { text: converted, parameters: index };
}

function normalizeRows(result) {
  const largeIntegers = (result.fields || []).filter(field => field.dataTypeID === 20).map(field => field.name);
  const jsonFields = (result.fields || []).filter(field => [114, 3802].includes(field.dataTypeID)).map(field => field.name);
  if (!largeIntegers.length && !jsonFields.length) return result.rows || [];
  return (result.rows || []).map(row => {
    const converted = { ...row };
    for (const name of largeIntegers) {
      if (converted[name] == null) continue;
      const value = Number(converted[name]);
      if (!Number.isSafeInteger(value)) throw new RangeError(`PostgreSQL value for ${name} exceeds JavaScript's safe integer range`);
      converted[name] = value;
    }
    for (const name of jsonFields) {
      if (converted[name] != null && typeof converted[name] !== 'string') converted[name] = JSON.stringify(converted[name]);
    }
    return converted;
  });
}

function resultShape(result) {
  return {
    results: normalizeRows(result), success: true,
    meta: { changes: result.command === 'SELECT' ? 0 : Number(result.rowCount || 0) },
  };
}

function queryInterface(query) {
  function prepare(sql, values = []) {
    const compiled = postgresSql(sql);
    if (compiled.parameters !== values.length && values.length) throw new Error('SQL parameter count does not match bound values');
    const statement = {
      sql,
      values,
      bind: (...parameters) => prepare(sql, parameters),
      async execute() {
        if (compiled.parameters !== values.length) throw new Error('SQL parameter count does not match bound values');
        return resultShape(await query(compiled.text, values));
      },
      async first(column) {
        const row = (await statement.execute()).results[0] || null;
        return row && column ? row[column] : row;
      },
      async all() { return statement.execute(); },
      async run() { return statement.execute(); },
    };
    return statement;
  }
  return { prepare };
}

async function inTransaction(pool, action) {
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN'); begun = true;
    const result = await action(client);
    await client.query('COMMIT'); begun = false;
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { error.cause ??= rollbackError; }
    }
    throw error;
  } finally { client.release(); }
}

async function installSchema(pool, schemaPath) {
  const schema = await readFile(schemaPath, 'utf8');
  const digest = createHash('sha256').update(schema.replaceAll('\r\n', '\n')).digest('hex');
  await inTransaction(pool, async client => {
    // Two Render instances must not both initialize the schema concurrently.
    await client.query('SELECT pg_advisory_xact_lock(53734827235393821)');
    await client.query('CREATE TABLE IF NOT EXISTS public.couple_home_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
    // Keep the migration ledger private. Supabase-specific API roles are
    // revoked when present; Neon and ordinary PostgreSQL do not define them.
    await client.query('ALTER TABLE public.couple_home_schema_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON TABLE public.couple_home_schema_migrations FROM PUBLIC');
    await client.query(`DO $roles$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.couple_home_schema_migrations FROM %I', role_name);
          END IF;
        END LOOP;
      END
    $roles$`);
    const prior = await client.query('SELECT sha256 FROM couple_home_schema_migrations WHERE name=$1', ['0001_initial']);
    if (prior.rows.length) {
      if (prior.rows[0].sha256 !== digest) throw new Error('PostgreSQL schema changed after deployment; add a new migration');
      return;
    }
    await client.query(schema);
    await client.query('INSERT INTO couple_home_schema_migrations (name,sha256) VALUES ($1,$2)', ['0001_initial', digest]);
  });
}

/**
 * Open the durable database used by the Render deployment. The injected pool
 * factory permits isolated tests without a live Supabase account.
 */
export async function openPostgres({ connectionString, schemaPath, poolFactory } = {}) {
  if (!connectionString || !schemaPath) throw new Error('DATABASE_URL and PostgreSQL schema path are required');
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL TLS connection string'); }
  const port = url.port || '5432';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !/^\d+$/.test(port) ||
      Number(port) < 1 || Number(port) > 65535 ||
      !['require', 'verify-full'].includes(url.searchParams.get('sslmode')) ||
      url.searchParams.get('uselibpqcompat') === 'true' ||
      ['0', 'false'].includes(url.searchParams.get('ssl'))) {
    throw new Error('DATABASE_URL must use a PostgreSQL TLS connection string with sslmode=require or verify-full');
  }
  const driver = poolFactory ? null : await import('pg');
  const Pool = poolFactory || driver.Pool || driver.default?.Pool;
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  try { await installSchema(pool, schemaPath); }
  catch (error) { await pool.end(); throw error; }
  const direct = queryInterface((text, values) => pool.query(text, values));
  return {
    ...direct,
    async batch(statements) {
      return inTransaction(pool, async client => {
        const results = [];
        for (const statement of statements) {
          // Statements are declarative; execute them on the checked-out client.
          const compiled = postgresSql(statement.sql);
          if (compiled.parameters !== statement.values.length) throw new Error('SQL parameter count does not match bound values');
          results.push(resultShape(await client.query(compiled.text, statement.values)));
        }
        return results;
      });
    },
    transaction(action) {
      return inTransaction(pool, async client => action(queryInterface((text, values) => client.query(text, values))));
    },
    async updateRoomWithEvent({ opId, data, revision, now, priorRevision }) {
      return inTransaction(pool, async client => {
        // Claim the event first. The unique key serializes concurrent retries.
        const claim = await client.query('INSERT INTO home_events (id,revision,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [opId, revision, now]);
        if (claim.rowCount !== 1) return { meta: { changes: 0 } };
        const update = await client.query('UPDATE room_state SET data=$1::jsonb,revision=$2,updated_at=$3 WHERE id=1 AND revision=$4', [data, revision, now, priorRevision]);
        if (update.rowCount !== 1) throw new RetryRoomUpdate();
        return { meta: { changes: 1 } };
      }).catch(error => {
        if (error instanceof RetryRoomUpdate) return { meta: { changes: 0 } };
        throw error;
      });
    },
    async health() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); },
  };
}

class RetryRoomUpdate extends Error {}
