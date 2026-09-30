import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { readConfig } from '../src/config.mjs';
import { openStore } from '../src/store.mjs';
import { ApiError, validateRequest, toProposal } from '../src/contracts.mjs';
import { createOpenAiProvider } from '../src/provider.mjs';
import { createGateway } from '../src/server.mjs';
const input = () => ({ requestId: randomUUID(), actionId: randomUUID(), sourceInput: '친구랑 커피 4500원 썼어', inputMethod: 'TEXT', now: '2026-09-30T02:00:00.000Z', timeZone: 'Asia/Seoul' });
const extracted = { status: 'PARSED', message: '', amount: 4500, currencyCode: 'KRW', category: '식비', memo: '친구랑 커피', occurredAt: '2026-09-30T02:00:00.000Z' };
const config = extra => ({ ...readConfig({ OPENAI_API_KEY: 'test-only', USER_DAILY_REQUESTS: '3', GLOBAL_DAILY_REQUESTS: '5' }), ...extra });
async function fixture(t, cfg = config(), provider = async x => toProposal(extracted, x)) {
  const store = openStore(':memory:', cfg); const token = store.issue('person-a'); const logs = [];
  const server = createGateway({ config: cfg, store, provider, logger: x => logs.push(x) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const request = (body, headers = {}) => fetch(url + '/v1/interpret', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.token}`, ...headers }, body: JSON.stringify(body) });
  return { store, token, logs, server, url, request };
}

test('HTTP auth, strict input, CORS and missing provider fail before quota use', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(input(), { authorization: 'Bearer bogus' })).status, 401);
  assert.equal((await f.request({ ...input(), extra: true })).status, 400);
  assert.equal((await f.request({ ...input(), requestId: [randomUUID()] })).status, 400);
  assert.equal((await f.request({ ...input(), timeZone: 'invalid/zone' })).status, 400);
  assert.equal((await f.request({ ...input(), sourceInput: 'x'.repeat(1001) })).status, 400);
  assert.equal((await f.request(input(), { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.request(input(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await f.request({ ...input(), sourceInput: 'x'.repeat(9000) })).status, 413);
  assert.equal(f.store.usage('person-a').used, 0);
  const session = await fetch(f.url + '/v1/session', { headers: { authorization: `Bearer ${f.token.token}`, origin: 'http://localhost:8081' } });
  assert.equal(session.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal((await session.json()).contractVersion, 1);
  f.store.revoke(f.token.id); assert.equal((await f.request(input())).status, 401);
  const unavailable = await fixture(t, config({ apiKey: '' }));
  assert.equal((await unavailable.request(input())).status, 503);
  assert.equal(unavailable.store.usage('person-a').used, 0);
});

test('real HTTP replay, identity isolation, quota and privacy', async t => {
  let calls = 0; const f = await fixture(t, config(), async x => { calls++; return toProposal(extracted, x); });
  const a = input(); const response = await f.request(a); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.proposal.sourceInput, a.sourceInput); assert.equal(result.proposal.actionId, a.actionId);
  assert.deepEqual(await (await f.request(a)).json(), result); assert.equal(calls, 1);
  assert.equal((await f.request({ ...a, sourceInput: 'different' })).status, 409);
  const other = f.store.issue('person-b');
  assert.equal((await f.request(a, { authorization: `Bearer ${other.token}` })).status, 200); assert.equal(calls, 2);
  assert.equal((await f.request(input())).status, 200); assert.equal((await f.request(input())).status, 200);
  assert.equal((await f.request(input())).status, 429); assert.equal(f.store.usage('person-a').used, 3);
  assert(!JSON.stringify(f.logs).includes(a.sourceInput)); assert(!JSON.stringify(f.logs).includes(f.token.token));
  assert(!JSON.stringify(f.store.db.prepare('SELECT * FROM requests').all()).includes(a.sourceInput));
  assert(!JSON.stringify(f.store.db.prepare('SELECT * FROM access_tokens').all()).includes(f.token.token));
});

test('concurrent duplicate and per-user/global concurrency gates', async t => {
  let release; let called; const began = new Promise(r => called = r); const wait = new Promise(r => release = r);
  let calls = 0; const f = await fixture(t, config({ maxConcurrent: 1 }), async x => { calls++; called(); await wait; return toProposal(extracted, x); });
  const body = input(); const first = f.request(body); await began;
  assert.equal((await f.request(body)).status, 409);
  assert.equal((await f.request(input())).status, 429);
  const other = f.store.issue('person-b'); assert.equal((await f.request(input(), { authorization: `Bearer ${other.token}` })).status, 429);
  release(); assert.equal((await first).status, 200); assert.equal(calls, 1);
});

test('durable budget, rate window, token expiry and restart receipt prevent extra spend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vlm-test-')); const path = join(dir, 'gateway.sqlite');
  const cfg = config({ dailyBudgetMicroUsd: 50000 }); const now = Date.parse('2026-09-30T12:00:00.000Z');
  let store = openStore(path, cfg); const access = store.issue('person-a', 1, now); const a = input();
  try {
    assert.throws(() => store.authenticate(`Bearer ${access.token}`, now + 86400000), /만료/);
    store.reserve('person-a', a, now); store.close(); store = openStore(path, cfg);
    assert.equal(store.reserve('person-a', a, now + 50000).duplicate, true);
    assert.throws(() => store.reserve('person-a', input(), now + 50000), e => e.code === 'DAILY_LIMIT');
    assert.equal(store.usage('person-a', now).used, 1);
    assert.equal(store.reserve('person-a', input(), now + 86400000).duplicate, false);
    store.close();
    assert(!readFileSync(path).includes(Buffer.from(a.sourceInput)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const rate = openStore(':memory:', config({ perMinute: 1 })); const a2 = input(); rate.reserve('u', a2, now); rate.finish('u', a2.requestId, true);
  assert.throws(() => rate.reserve('u', input(), now + 1), e => e.code === 'RATE_LIMITED');
  assert.equal(rate.reserve('u', input(), now + 60001).duplicate, false); rate.close();
});

test('atomic budget reservation across independent DB handles; failure consumes allowance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vlm-ledger-')); const path = join(dir, 'gateway.sqlite');
  const cfg = config({ globalDaily: 1 }); const a = openStore(path, cfg); const b = openStore(path, cfg);
  try { const r = input(); a.reserve('a', r); a.finish('a', r.requestId, false); assert.throws(() => b.reserve('b', input()), e => e.code === 'DAILY_LIMIT'); assert.equal(b.usage('b').used, 0); }
  finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('OpenAI adapter sends exact schema, no history/identity, and builds trusted envelope', async () => {
  const a = input(); let request;
  const provider = createOpenAiProvider(config(), async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); request = JSON.parse(options.body);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(extracted) }] }] });
  });
  const result = await provider(a);
  assert.equal(request.store, false); assert.equal(request.text.format.strict, true); assert.equal(request.max_output_tokens, 800);
  assert(!JSON.stringify(request).includes(a.actionId)); assert(!JSON.stringify(request).includes(a.requestId));
  assert.equal(result.proposal.actionId, a.actionId); assert.equal(result.proposal.payload.transactionType, 'EXPENSE');
  assert.throws(() => toProposal({ ...extracted, actionId: 'injected' }, a), ApiError);
  assert.throws(() => toProposal({ ...extracted, amount: -1 }, a), ApiError);
  assert.throws(() => toProposal({ ...extracted, occurredAt: '2026-02-30T02:00:00.000Z' }, a), ApiError);
  assert.equal(toProposal({ ...extracted, occurredAt: '2026-10-01T02:00:00.000Z' }, a).status, 'NEEDS_CLARIFICATION');
  assert.throws(() => validateRequest({ ...a, inputMethod: 'MANUAL' }), ApiError);
});

test('upstream refusal, incomplete/malformed output, failure and timeout never fabricate success/retry', async () => {
  let calls = 0;
  const refusal = createOpenAiProvider(config(), async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }));
  assert.equal((await refusal(input())).status, 'UNSUPPORTED');
  for (const value of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [] }]) {
    await assert.rejects(createOpenAiProvider(config(), async () => Response.json(value))(input()), ApiError);
  }
  const unavailable = createOpenAiProvider(config(), async () => { calls++; return new Response('', { status: 429 }); });
  await assert.rejects(unavailable(input()), e => e.code === 'PROVIDER_UNAVAILABLE'); assert.equal(calls, 1);
  const timed = createOpenAiProvider(config({ timeoutMs: 10 }), async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))));
  await assert.rejects(timed(input()), e => e.code === 'AI_TIMEOUT');
});

test('ambiguous 7시 is clarified without any model call', async () => {
  const provider = createOpenAiProvider(config(), async () => { throw new Error('must not call'); });
  const result = await provider({ ...input(), sourceInput: '어제 7시 커피 4500원 썼어' });
  assert.equal(result.status, 'NEEDS_CLARIFICATION');
});
