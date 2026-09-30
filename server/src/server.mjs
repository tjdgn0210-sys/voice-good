import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError, validateRequest } from './contracts.mjs';

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'CONTENT_TYPE', 'JSON 입력이 필요합니다.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'CONTENT_ENCODING', '압축 입력은 지원하지 않습니다.');
  if (Number(req.headers['content-length'] ?? 0) > 8192) throw new ApiError(413, 'INPUT_TOO_LARGE', '입력이 너무 깁니다.');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new ApiError(413, 'INPUT_TOO_LARGE', '입력이 너무 깁니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', '입력 형식을 확인해 주세요.'); }
}

export function createGateway({ config, store, provider, logger = event => console.log(JSON.stringify(event)) }) {
  // Responses exist only in RAM for 10 minutes. No input/output text is written to gateway storage/logs.
  const cache = new Map();
  const sweep = setInterval(() => { for (const [key, value] of cache) if (value.until < Date.now()) cache.delete(key); }, 60000);
  sweep.unref();
  const server = createServer({ requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 8192 }, async (req, res) => {
    const traceId = randomUUID(); const started = Date.now(); let status = 500; let code = 'INTERNAL_ERROR';
    const send = (s, value, extra = {}) => { status = s; res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Request-Id', traceId);
    try {
      const origin = req.headers.origin;
      if (origin && !config.origins.includes(origin)) throw new ApiError(403, 'ORIGIN_DENIED', '허용되지 않은 웹 주소입니다.');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      const path = new URL(req.url ?? '/', 'http://gateway').pathname;
      if (req.method === 'OPTIONS' && ['/v1/session', '/v1/interpret'].includes(path)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        code = 'PREFLIGHT'; send(204, {}); return;
      }
      if (req.method === 'GET' && path === '/healthz') { code = 'HEALTHY'; send(200, { status: 'ok' }); return; }
      if (!((req.method === 'GET' && path === '/v1/session') || (req.method === 'POST' && path === '/v1/interpret'))) throw new ApiError(404, 'NOT_FOUND', '지원하지 않는 요청입니다.');
      const user = store.authenticate(req.headers.authorization);
      if (req.method === 'GET') { code = 'SESSION'; send(200, { aiAvailable: Boolean(config.apiKey), usage: store.usage(user), contractVersion: 1 }); return; }
      const input = validateRequest(await readJson(req));
      if (!config.apiKey) throw new ApiError(503, 'AI_NOT_CONFIGURED', '서버의 AI 연결이 아직 설정되지 않았습니다.');
      const key = user + ':' + input.requestId;
      const reservation = store.reserve(user, input);
      if (reservation.duplicate) {
        const prior = cache.get(key);
        if (prior && prior.until > Date.now()) { code = 'REPLAY'; send(prior.status, prior.body); return; }
        throw new ApiError(409, 'ALREADY_ATTEMPTED', '이미 접수한 요청입니다. 결과가 없다면 직접 확인 후 다시 해석해 주세요.');
      }
      let body; let replyStatus = 200;
      try {
        body = await provider(input); code = body.status;
        store.finish(user, input.requestId, true);
      } catch (error) {
        const known = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '요청을 완료하지 못했습니다.');
        replyStatus = known.status; code = known.code;
        body = { error: { code, message: known.message, requestId: traceId } };
        store.finish(user, input.requestId, false);
      }
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(key, { status: replyStatus, body, until: Date.now() + 600000 });
      send(replyStatus, body);
    } catch (error) {
      const known = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', '요청을 완료하지 못했습니다.');
      code = known.code;
      send(known.status, { error: { code, message: known.message, requestId: traceId } }, known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : {});
    } finally {
      // Excludes URLs/query strings, credentials, user IDs, input text and model output.
      logger({ requestId: traceId, status, code, durationMs: Date.now() - started });
    }
  });
  server.maxRequestsPerSocket = 100;
  server.keepAliveTimeout = 5000;
  server.on('close', () => { clearInterval(sweep); cache.clear(); });
  return server;
}
