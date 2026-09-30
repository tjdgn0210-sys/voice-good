// End-to-end transport + application + actual disposable SQLite. No paid API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'); const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative); if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText;
  const mod = { exports: {} }; cache.set(file, mod);
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(name => {
    assert(name.startsWith('.'), name); let resolved = path.resolve(path.dirname(file), name); if (!path.extname(resolved)) resolved += '.ts'; return load(path.relative(root, resolved));
  }, mod, mod.exports); return mod.exports;
}
async function main() {
  const { readConfig } = await import('../server/src/config.mjs');
  const { openStore } = await import('../server/src/store.mjs');
  const { createGateway } = await import('../server/src/server.mjs');
  const { toProposal, ApiError } = await import('../server/src/contracts.mjs');
  const config = readConfig({ OPENAI_API_KEY: 'test-only' }); const store = openStore(':memory:', config); const token = store.issue('integration');
  let calls = 0; let mode = 'success';
  const server = createGateway({ config, store, logger() {}, provider: async input => {
    calls++;
    if (mode === 'failure') throw new ApiError(504, 'AI_TIMEOUT', 'AI 응답 시간이 초과됐습니다.');
    const result = toProposal({ status: 'PARSED', message: '', amount: 4500, currencyCode: 'KRW', category: '식비', memo: '친구랑 커피', occurredAt: input.now }, input);
    if (mode === 'tampered') result.proposal.actionId = randomUUID();
    return result;
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const db = new DatabaseSync(':memory:');
  try {
    const { createHttpCaptureAiClient, validateServerUrl } = load('src/adapters/ai/http-capture-ai-interpreter.ts');
    const { createCaptureInterpretationService } = load('src/application/proposals/interpret-capture-input.ts');
    const { createCaptureParserInput } = load('src/application/proposals/capture-parser-router.ts');
    const client = createHttpCaptureAiClient({ newRequestId: randomUUID }); const interpret = createCaptureInterpretationService(client.interpreter);
    const now = '2026-09-30T02:00:00.000Z'; const input = createCaptureParserInput('친구랑 커피 4500원 썼어', randomUUID(), 'TEXT', now);
    assert.equal((await interpret(input)).status, 'FAILED'); assert.equal(calls, 0);
    assert.throws(() => validateServerUrl('http://example.com'));
    assert.throws(() => validateServerUrl('https://user:pass@example.com'));
    await client.connect(`http://127.0.0.1:${server.address().port}`, token.token);
    assert.equal((await interpret(createCaptureParserInput('커피 4500원', randomUUID(), 'TEXT', now))).source, 'LOCAL'); assert.equal(calls, 0);
    const result = await interpret(input); assert.equal(result.source, 'AI'); assert.equal(calls, 1);
    const api = { execAsync: async sql => db.exec(sql), runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
      getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null, getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
      withExclusiveTransactionAsync: async fn => { db.exec('BEGIN'); try { await fn(api); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
    await load('src/database/migrations/migrate.ts').migrateDatabase(api);
    const transactions = load('src/database/repositories/sqlite-transaction-repository.ts').createSqliteTransactionRepository(api);
    const expenses = load('src/application/expenses/manual-expenses.ts').createManualExpenses({ transactions,
      unitOfWork: load('src/database/sqlite-transaction-creation-unit-of-work.ts').createSqliteTransactionCreationUnitOfWork(api),
      nextActionId: randomUUID, nextLogId: randomUUID, idsForAction: actionId => ({ transactionId: actionId, undoId: actionId }), now: () => now, undoWindowMilliseconds: 60000 });
    assert.equal((await transactions.listRecent(30)).length, 0);
    const saved = await expenses.save(result.proposal); assert.equal(saved.outcome.result.status, 'SUCCESS');
    assert.equal((await transactions.findById(input.actionId)).rawInput, input.sourceInput);
    await expenses.save(result.proposal); assert.equal((await transactions.listRecent(30)).length, 1);
    assert.equal((await expenses.undo(saved.outcome.undoRecord.undoId)).status, 'SUCCESS');
    mode = 'tampered'; assert.equal((await interpret(input)).reason, 'INVALID_PROPOSAL');
    mode = 'failure'; assert.equal((await interpret(input)).status, 'FAILED');
    assert.equal((await transactions.listRecent(30)).length, 0);
    client.disconnect(); assert.equal((await interpret(input)).reason, 'PROVIDER_UNAVAILABLE');
    let handlers, resolveInterpret; let delayedSaves = 0, delayedReviews = 0;
    const speech = { isAvailable: () => true, supportsOnDeviceRecognition: () => true, getPermissionStatus: async () => 'GRANTED', startListening: value => { handlers = value; }, cancelListening() {} };
    const delayed = load('src/application/capture/voice-expense-capture.ts').createVoiceExpenseCapture({ speech,
      interpret: () => new Promise(resolve => { resolveInterpret = resolve; }), save: async () => { delayedSaves++; }, newActionId: randomUUID, now: () => now });
    await delayed.start({ onReview: () => { delayedReviews++; } }); handlers.onFinal(input.sourceInput);
    await new Promise(resolve => setImmediate(resolve)); delayed.cancel(false); resolveInterpret(result);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delayedSaves, 0); assert.equal(delayedReviews, 0); assert.equal(delayed.state, 'IDLE');

    console.log('PASS: session auth → real HTTP AI adapter → envelope validation → local SQLite/ActionLog → duplicate-safe save and Undo; local bypass, tamper, timeout and disconnect gates.');
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); store.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
