export class ApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
export const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUtc = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
export function validateRequest(x) {
  const keys = ['requestId', 'actionId', 'sourceInput', 'inputMethod', 'now', 'timeZone'];
  const invalid = () => { throw new ApiError(400, 'INVALID_INPUT', '입력 형식을 확인해 주세요.'); };
  if (!object(x) || Object.keys(x).length !== keys.length || keys.some(k => !(k in x))) invalid();
  if (typeof x.requestId !== 'string' || typeof x.actionId !== 'string' || !uuid.test(x.requestId) || !uuid.test(x.actionId)) invalid();
  if (typeof x.sourceInput !== 'string' || !x.sourceInput.trim() || x.sourceInput.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x.sourceInput)) invalid();
  if (!['TEXT', 'VOICE'].includes(x.inputMethod) || !isUtc(x.now)) invalid();
  if (typeof x.timeZone !== 'string' || x.timeZone.length > 80) invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: x.timeZone }).format(); } catch { invalid(); }
  return Object.fromEntries(keys.map(k => [k, x[k]]));
}

// An extraction result has no command, identity, SQL, or remote tool fields.
export const extractionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['PARSED', 'NEEDS_CLARIFICATION', 'UNSUPPORTED'] },
    message: { type: 'string' }, amount: { type: ['integer', 'null'] },
    currencyCode: { type: ['string', 'null'], enum: ['KRW', null] },
    category: { type: ['string', 'null'], enum: ['식비', '교통', '생활', '쇼핑', '의료', '문화', '기타', null] },
    memo: { type: ['string', 'null'] }, occurredAt: { type: ['string', 'null'] },
  },
  required: ['status', 'message', 'amount', 'currencyCode', 'category', 'memo', 'occurredAt'],
};
export function toProposal(result, input) {
  const bad = () => { throw new ApiError(502, 'INVALID_PROVIDER_OUTPUT', 'AI 결과를 검증하지 못했습니다. 문장을 수정하거나 직접 입력해 주세요.'); };
  if (!object(result) || Object.keys(result).length !== extractionSchema.required.length || extractionSchema.required.some(k => !(k in result))) bad();
  if (!extractionSchema.properties.status.enum.includes(result.status) || typeof result.message !== 'string' || result.message.length > 500) bad();
  if (result.amount !== null && (!Number.isSafeInteger(result.amount) || result.amount <= 0 || result.amount > 1000000000000)) bad();
  if (![null, 'KRW'].includes(result.currencyCode) || !extractionSchema.properties.category.enum.includes(result.category)) bad();
  if (result.memo !== null && (typeof result.memo !== 'string' || result.memo.length > 300)) bad();
  if (result.occurredAt !== null && !isUtc(result.occurredAt)) bad();
  if (result.status !== 'PARSED') {
    if (!result.message.trim()) bad();
    return { status: result.status, message: result.message };
  }
  if (result.amount === null || result.currencyCode !== 'KRW' || !isUtc(result.occurredAt)) bad();
  if (Date.parse(result.occurredAt) > Date.parse(input.now) + 60000) {
    return { status: 'NEEDS_CLARIFICATION', message: '미래의 지출은 아직 기록하지 않습니다. 실제로 지출한 날짜를 확인해 주세요.' };
  }
  // The trusted server, not the model, owns the action envelope.
  return { status: 'PARSED', proposal: {
    actionId: input.actionId, type: 'CREATE_TRANSACTION', sourceInput: input.sourceInput,
    inputMethod: input.inputMethod, dependsOnActionIds: [],
    payload: { transactionType: 'EXPENSE', amount: result.amount, currencyCode: 'KRW', category: result.category, memo: result.memo, occurredAt: result.occurredAt },
  } };
}

/** Explicitly ambiguous clock times must not depend on the model's guess. */
export function guardAmbiguousTime(input) {
  const text = input.sourceInput.normalize('NFKC');
  if (!/(?:오전|오후|새벽|아침|점심|낮|저녁|밤)/u.test(text) && /(?<![\d])(?:[1-9]|1[0-2])\s*시/u.test(text)) {
    return { status: 'NEEDS_CLARIFICATION', message: '오전인지 오후인지 알려 주세요. 예: 어제 오후 7시' };
  }
  return null;
}
