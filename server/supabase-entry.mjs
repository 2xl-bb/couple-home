import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createPassword } from './password.mjs';
import { requireNativeOwner } from './auth.mjs';
import { initialState, HomeError } from '../lib/home-domain.mjs';

// Render's filesystem is temporary. The one-time setup code must come from a
// private environment variable until the durable database has been initialized.
export function createSupabaseEntry({ db, origin, setupCode }) {
  const local = new URL(origin).protocol === 'http:';
  if (!local && (typeof setupCode !== 'string' || setupCode.length < 24 || setupCode.length > 128)) {
    throw new Error('公网首次设置需要 24 至 128 字符的私有 SETUP_CODE。');
  }
  let busy = false;
  const names = async () => (await db.prepare('SELECT name FROM identity_names ORDER BY slot').all()).results.map(row => row.name);
  const empty = async query => {
    const [members, room] = await Promise.all([
      query.prepare('SELECT 1 FROM members LIMIT 1').first(),
      query.prepare('SELECT 1 FROM room_state LIMIT 1').first(),
    ]);
    return !members && !room;
  };
  const sameOrigin = request => {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new HomeError('请从小屋页面执行这个操作。', 403);
  };
  const readInput = async request => {
    try {
      const value = await request.json();
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Return the same bounded user-facing error below. */ }
    throw new HomeError('请填写完整的设置内容。');
  };
  return {
    code: setupCode || '',
    names,
    async status() {
      const setupRequired = await empty(db);
      return { setupRequired, requiresSetupCode: !local && setupRequired, identityNames: await names() };
    },
    async setup(request) {
      sameOrigin(request);
      if (busy || !(await empty(db))) throw new HomeError('小屋已经创建，请使用已有密码登录。', 409);
      const input = await readInput(request);
      if (!local) {
        const supplied = Buffer.from(typeof input.code === 'string' ? input.code.trim() : '');
        const expected = Buffer.from(setupCode);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          throw new HomeError('小屋初始化码不正确，请向部署者确认。', 403);
        }
      }
      if (!Array.isArray(input.passwords) || !Array.isArray(input.confirmations) ||
          input.passwords.length !== 2 || input.confirmations.length !== 2 ||
          input.passwords.some((value, index) => value !== input.confirmations[index])) {
        throw new HomeError('请分别确认两位成员的密码，两次输入需要一致。');
      }
      busy = true;
      try {
        const hashes = await Promise.all(input.passwords.map(createPassword));
        const state = initialState();
        state.names = ['成员一', '成员二'];
        await db.transaction(async tx => {
          // The transaction-scoped lock also closes the race between Render
          // instances that do not share this process's busy flag.
          await tx.prepare('SELECT pg_advisory_xact_lock(742631809)').first();
          if (!(await empty(tx))) throw new HomeError('小屋已经创建，请使用已有密码登录。', 409);
          for (let index = 0; index < 2; index++) {
            const userId = randomUUID(), slot = index + 1, password = hashes[index];
            await tx.prepare('INSERT INTO members (user_id,slot,display_name,last_seen) VALUES (?,?,?,0)')
              .bind(userId, slot, state.names[index]).run();
            await tx.prepare('INSERT INTO member_passwords (slot,user_id,salt,password_hash,version,created_at) VALUES (?,?,?,?,?,?)')
              .bind(slot, userId, password.salt, password.passwordHash, password.version, Date.now()).run();
          }
          await tx.prepare('INSERT INTO room_state (id,data,revision,updated_at) VALUES (1,?,0,?)')
            .bind(JSON.stringify(state), Date.now()).run();
        });
        return input.passwords[0];
      } finally { busy = false; }
    },
    async rename(request) {
      sameOrigin(request);
      await requireNativeOwner();
      const input = await readInput(request), supplied = input.identityNames;
      if (!Array.isArray(supplied) || supplied.length !== 2 || supplied.some(value =>
        typeof value !== 'string' || !value.trim() || value.trim().length > 20 || /[\u0000-\u001f\u007f]/.test(value))) {
        throw new HomeError('请填写两种身份的名称，每个名称为 1 至 20 个字符。');
      }
      const normalized = supplied.map(value => value.trim());
      if (normalized[0] === normalized[1]) throw new HomeError('两种身份请使用不同的名称，方便登录时区分。');
      await db.transaction(async tx => {
        for (let index = 0; index < 2; index++) {
          await tx.prepare('UPDATE identity_names SET name=? WHERE slot=?').bind(normalized[index], index + 1).run();
        }
        await tx.prepare('UPDATE room_state SET revision=revision+1,updated_at=? WHERE id=1').bind(Date.now()).run();
      });
      return { identityNames: normalized };
    },
  };
}
