// Regression checks for recovery, review, edits and serialized web transactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(name => {
    assert(name.startsWith('.'), name);
    return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
  }, mod, mod.exports);
  return mod.exports;
}
const { migrateDatabase } = load('src/database/migrations/migrate.ts');
const { initialSchemaSql } = load('src/database/migrations/001-initial-schema.ts');
const { createSerializedWebDatabase } = load('src/database/serialized-web-database.ts');
const { createSqliteTransactionRepository } = load('src/database/repositories/sqlite-transaction-repository.ts');
const { createSqliteTransactionCreationUnitOfWork } = load('src/database/sqlite-transaction-creation-unit-of-work.ts');
const { createManualExpenses } = load('src/application/expenses/manual-expenses.ts');
const { createExpenseEditor } = load('src/application/expenses/expense-editor.ts');
const { createDrafts } = load('src/application/drafts/drafts.ts');
const { createSqliteDraftRepository } = load('src/database/repositories/sqlite-draft-repository.ts');
const { createDraftUnitOfWork, createExpenseEditUnitOfWork } = load('src/database/expense-workspaces.ts');
const { createVoiceExpenseCapture } = load('src/application/capture/voice-expense-capture.ts');
const { createCaptureInterpretationService } = load('src/application/proposals/interpret-capture-input.ts');
const { createCaptureParserInput, routeCaptureInput } = load('src/application/proposals/capture-parser-router.ts');
function rawDatabase(sql) {
  return { execAsync: async q => sql.exec(q), runAsync: async (q, ...p) => sql.prepare(q).run(...p),
    getFirstAsync: async (q, ...p) => sql.prepare(q).get(...p) ?? null, getAllAsync: async (q, ...p) => sql.prepare(q).all(...p),
    withTransactionAsync: async work => { sql.exec('BEGIN'); try { await work(); sql.exec('COMMIT'); } catch(e) { sql.exec('ROLLBACK'); throw e; } } };
}
const drain = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-life-hardening-'));
  const filename = path.join(directory, 'app.db');
  let sql = new DatabaseSync(filename);
  try {
    // Upgrade an existing database without rewriting V1 or losing data.
    sql.exec(initialSchemaSql); sql.exec('PRAGMA user_version=1');
    const port = createSerializedWebDatabase(rawDatabase(sql));
    await migrateDatabase(port); await migrateDatabase(port);
    assert.equal(sql.prepare('PRAGMA user_version').get().user_version, 2);
    let sequence = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const now = '2026-09-28T16:00:00.000Z';
    const transactions = createSqliteTransactionRepository(port);
    const expenses = createManualExpenses({ transactions, unitOfWork: createSqliteTransactionCreationUnitOfWork(port), nextActionId: nextId, nextLogId: nextId, idsForAction: id => ({ transactionId: id, undoId: id }), now: () => now, undoWindowMilliseconds: 60000 });
    function proposal(text, method='TEXT') { return routeCaptureInput(createCaptureParserInput(text, nextId(), method, now)); }
    for (const text of ['점심 7000원 안 썼어', '예산 7000원', '7000원 쓸 예정이야', '커피 4500원 결제할 거야', '점심 7000원 썼어?', '점심 7000원 썼다고 했어', '메모 7000원']) assert.notEqual(proposal(text).status, 'PARSED', text);
    const voiceSave = await expenses.save(proposal('점심 7000원 썼어', 'VOICE').proposal);
    assert.equal(voiceSave.outcome.result.status, 'SUCCESS');
    assert.equal((await expenses.undo(voiceSave.outcome.undoRecord.undoId)).status, 'SUCCESS');
    assert.equal(await transactions.findById(voiceSave.outcome.result.affectedEntityId), null);
    console.log('PASS: unsafe expense language is not locally parsed; real VOICE save/Undo works.');

    const save = await expenses.save(proposal('커피 4500원').proposal);
    let entity = await transactions.findById(save.outcome.result.affectedEntityId);
    const editor = createExpenseEditor({ unitOfWork: createExpenseEditUnitOfWork(port), now: () => now, newId: nextId });
    const edit = { actionId: nextId(), type: 'UPDATE_TRANSACTION', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [], payload: { targetId: entity.id, expectedUpdatedAt: entity.updatedAt, changes: { transactionType: 'EXPENSE', amount: 6500, currencyCode: 'KRW', category: '식비', memo: '수정', occurredAt: now } } };
    assert.equal((await editor.execute(edit)).status, 'SUCCESS');
    const edited = await transactions.findById(entity.id);
    assert.equal(edited.amount, 6500); assert.notEqual(edited.updatedAt, entity.updatedAt);
    assert.equal(edited.rawInput, entity.rawInput);
    assert.equal((await editor.execute(edit)).status, 'SUCCESS'); // Same stable ID replays safely.
    assert.equal((await editor.execute({ ...edit, payload: { ...edit.payload, changes: { ...edit.payload.changes, amount: 7000 } } })).status, 'FAILED');
    assert.equal((await editor.execute({ ...edit, actionId: nextId() })).status, 'FAILED'); // Stale editor.
    sql.exec("CREATE TRIGGER reject_edit_log BEFORE INSERT ON action_logs WHEN json_extract(NEW.proposal_json,'$.type')='UPDATE_TRANSACTION' BEGIN SELECT RAISE(ABORT,'injected log failure'); END;");
    assert.equal((await editor.execute({ ...edit, actionId: nextId(), payload: { ...edit.payload, expectedUpdatedAt: edited.updatedAt, changes: { ...edit.payload.changes, amount: 9999 } } })).status, 'FAILED');
    assert.equal((await transactions.findById(entity.id)).amount, 6500);
    sql.exec('DROP TRIGGER reject_edit_log');
    const deletion = { actionId: nextId(), type: 'DELETE_TRANSACTION', inputMethod: 'MANUAL', sourceInput: '', dependsOnActionIds: [], payload: { targetId: entity.id, expectedUpdatedAt: edited.updatedAt, confirmed: false } };
    assert.equal((await editor.execute(deletion)).status, 'FAILED');
    deletion.payload.confirmed = true;
    assert.equal((await editor.execute(deletion)).status, 'SUCCESS');
    assert.equal((await editor.execute(deletion)).status, 'SUCCESS');
    assert.equal(await transactions.findById(entity.id), null);
    console.log('PASS: edit/delete confirmation, stable retry, stale conflict and ActionLog rollback.');

    const drafts = createDrafts({ repository: createSqliteDraftRepository(port), unitOfWork: createDraftUnitOfWork(port), newId: nextId, now: () => now });
    const draft = { actionId: nextId(), capturedAt: now, inputMethod: 'TEXT', fields: { text: '복구할 초안' } };
    await drafts.save('capture', draft);
    assert.deepEqual(await drafts.read('capture'), draft);
    sql.exec("CREATE TRIGGER reject_draft_log BEFORE INSERT ON action_logs WHEN json_extract(NEW.proposal_json,'$.type')='SAVE_DRAFT' BEGIN SELECT RAISE(ABORT,'injected draft log failure'); END;");
    await assert.rejects(drafts.save('capture', { ...draft, fields: { text: '실패한 변경' } }));
    assert.deepEqual(await drafts.read('capture'), draft);
    sql.exec('DROP TRIGGER reject_draft_log');
    await Promise.all([drafts.save('capture', { ...draft, fields: { text: '이전' } }), drafts.save('capture', draft)]);
    assert.deepEqual(await drafts.read('capture'), draft);
    console.log('PASS: validated durable drafts, ordered edits, rollback and queue recovery.');

    // Browser-compatible transaction scope must exclude unrelated operations while awaiting.
    await port.execAsync('CREATE TABLE queue_probe(value TEXT)');
    const results = await Promise.allSettled([
      port.withExclusiveTransactionAsync(async tx => { await tx.runAsync('INSERT INTO queue_probe VALUES (?)', 'rolled-back'); await drain(); throw new Error('rollback'); }),
      port.runAsync('INSERT INTO queue_probe VALUES (?)', 'outside'),
    ]);
    assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
    assert.deepEqual((await port.getAllAsync('SELECT value FROM queue_probe')).map(r => r.value), ['outside']);
    console.log('PASS: serialized web transaction excludes outside writes and releases after rejection.');

    let handlers; let saves = 0, reviews = 0, transcript = '';
    const speech = { isAvailable: () => true, supportsOnDeviceRecognition: () => true, getPermissionStatus: async () => 'GRANTED', requestMicrophonePermission: async () => 'GRANTED', startListening: value => { handlers = value; }, stopListening() {}, cancelListening() {} };
    const capture = createVoiceExpenseCapture({ speech, interpret: createCaptureInterpretationService(), save: async () => { saves++; throw new Error('Review must prevent execution'); }, newActionId: nextId, now: () => now });
    await capture.start({ onTranscript: text => { transcript = text; }, onReview: async value => { reviews++; assert.equal(value.inputMethod, 'VOICE'); } });
    handlers.onFinal('점심 7000원 썼어'); handlers.onFinal('점심 7000원 썼어'); await drain();
    assert.equal(transcript, '점심 7000원 썼어'); assert.equal(reviews, 1); assert.equal(saves, 0);
    await capture.start({ onTranscript: text => { transcript = text; }, onReview: () => { reviews++; } });
    handlers.onFinal('예산 7000원'); await drain();
    assert.equal(transcript, '예산 7000원'); assert.equal(reviews, 1); assert.equal(saves, 0);
    console.log('PASS: final voice review runs once, does not auto-save, and preserves rejected transcript.');

    sql.close(); sql = new DatabaseSync(filename);
    const reopened = createSerializedWebDatabase(rawDatabase(sql)); await migrateDatabase(reopened);
    assert.deepEqual(await createSqliteDraftRepository(reopened).read('capture'), draft);
    await createDrafts({ repository: createSqliteDraftRepository(reopened), unitOfWork: createDraftUnitOfWork(reopened), newId: nextId, now: () => now }).remove('capture');
    assert.equal(await createSqliteDraftRepository(reopened).read('capture'), null);
    console.log('PASS: draft survives actual database close/reopen and explicit discard removes active draft.');
  } finally { if (sql.isOpen) sql.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
