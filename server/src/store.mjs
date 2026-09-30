import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiError } from './contracts.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

export function openStore(path, config) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  // Independent gateway DB; never opens the mobile app database.
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS access_tokens(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, started_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(user_id, request_id));
    CREATE INDEX IF NOT EXISTS requests_started ON requests(started_at);
    CREATE INDEX IF NOT EXISTS requests_user_started ON requests(user_id, started_at);
    CREATE TABLE IF NOT EXISTS daily_usage(day TEXT NOT NULL, subject TEXT NOT NULL, calls INTEGER NOT NULL, reserved_micro_usd INTEGER NOT NULL, PRIMARY KEY(day,subject));
    INSERT OR IGNORE INTO schema_migrations VALUES(1);
    COMMIT;`);
  return {
    db,
    issue(userId, days = 7, now = Date.now()) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId) || !Number.isInteger(days) || days < 1 || days > 90) throw new Error('Use a pseudonymous user ID (1–64 letters/digits/_/-) and validity 1–90 days');
      const token = 'vlm_' + randomBytes(32).toString('base64url'); const id = randomUUID();
      db.prepare('INSERT INTO access_tokens VALUES(?,?,?,?,0)').run(id, userId, hash(token), now + days * 86400000);
      return { id, token, expiresAt: new Date(now + days * 86400000).toISOString() };
    },
    revoke(id) { return db.prepare('UPDATE access_tokens SET revoked=1 WHERE id=?').run(id).changes; },
    authenticate(header, now = Date.now()) {
      if (typeof header !== 'string' || !/^Bearer vlm_[A-Za-z0-9_-]{43}$/.test(header)) throw new ApiError(401, 'UNAUTHORIZED', '접속 토큰을 확인해 주세요.');
      const row = db.prepare('SELECT user_id FROM access_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?').get(hash(header.slice(7)), now);
      if (!row) throw new ApiError(401, 'UNAUTHORIZED', '접속 토큰이 만료되었거나 유효하지 않습니다.');
      return row.user_id;
    },
    usage(userId, now = Date.now()) {
      const day = new Date(now).toISOString().slice(0, 10);
      const row = db.prepare('SELECT calls FROM daily_usage WHERE day=? AND subject=?').get(day, 'user:' + userId);
      return { used: row?.calls ?? 0, limit: config.perUserDaily, resetsAt: new Date(Date.parse(day) + 86400000).toISOString() };
    },
    reserve(userId, input, now = Date.now()) {
      const fingerprint = hash(JSON.stringify(input));
      const day = new Date(now).toISOString().slice(0, 10);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM requests WHERE started_at<?').run(now - 7 * 86400000);
        db.prepare('DELETE FROM daily_usage WHERE day<?').run(new Date(now - 7 * 86400000).toISOString().slice(0,10));
        const existing = db.prepare('SELECT * FROM requests WHERE user_id=? AND request_id=?').get(userId, input.requestId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '같은 요청 번호로 다른 내용을 보낼 수 없습니다.');
          db.exec('COMMIT'); return { duplicate: true, state: existing.state };
        }
        const recent = db.prepare('SELECT count(*) AS n FROM requests WHERE user_id=? AND started_at>?').get(userId, now - 60000).n;
        if (recent >= config.perMinute) throw new ApiError(429, 'RATE_LIMITED', '요청이 잦습니다. 1분 후 다시 시도해 주세요.', 60);
        const activeUser = db.prepare("SELECT count(*) AS n FROM requests WHERE user_id=? AND state='PENDING' AND lease_until>?").get(userId, now).n;
        const activeGlobal = db.prepare("SELECT count(*) AS n FROM requests WHERE state='PENDING' AND lease_until>?").get(now).n;
        if (activeUser || activeGlobal >= config.maxConcurrent) throw new ApiError(429, 'BUSY', '이미 처리 중인 요청이 있습니다. 잠시 후 다시 시도해 주세요.', 5);
        for (const [subject, limit] of [['user:' + userId, config.perUserDaily], ['global', config.globalDaily]]) {
          const usage = db.prepare('SELECT * FROM daily_usage WHERE day=? AND subject=?').get(day, subject);
          if ((usage?.calls ?? 0) >= limit || (subject === 'global' && (usage?.reserved_micro_usd ?? 0) + config.reserveMicroUsd > config.dailyBudgetMicroUsd)) {
            throw new ApiError(429, 'DAILY_LIMIT', '오늘의 AI 사용 한도에 도달했습니다. 직접 입력은 계속 사용할 수 있습니다.', Math.ceil((Date.parse(day) + 86400000 - now) / 1000));
          }
          db.prepare('INSERT INTO daily_usage VALUES(?,?,1,?) ON CONFLICT(day,subject) DO UPDATE SET calls=calls+1,reserved_micro_usd=reserved_micro_usd+excluded.reserved_micro_usd').run(day, subject, config.reserveMicroUsd);
        }
        db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(userId, input.requestId, fingerprint, now, now + config.timeoutMs + 10000, 'PENDING');
        db.exec('COMMIT'); return { duplicate: false };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    finish(userId, requestId, success) {
      db.prepare('UPDATE requests SET state=?,lease_until=0 WHERE user_id=? AND request_id=?').run(success ? 'COMPLETED' : 'FAILED', userId, requestId);
    },
    close() { db.close(); },
  };
}
