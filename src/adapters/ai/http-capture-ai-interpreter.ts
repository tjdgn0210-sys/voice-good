import type { CaptureAiInterpreter, CaptureAiInterpreterResult } from '../../application/proposals/capture-ai-interpreter';

export interface AiSession {
  serverUrl: string;
  usage: { used: number; limit: number; resetsAt: string };
}
const failed = (reason: 'PROVIDER_UNAVAILABLE' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'TIMEOUT', message: string): CaptureAiInterpreterResult => ({ status: 'FAILED', reason, message });
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
export function validateServerUrl(value: string): string {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('HTTPS 서버 주소를 입력해 주세요. 로컬 개발은 localhost HTTP를 사용할 수 있습니다.');
  }
  return url.origin;
}

/** Credentials live in RAM for this app session; never in SQLite, drafts, logs or the bundle. */
export function createHttpCaptureAiClient({ newRequestId, fetchImpl = fetch, timeoutMs = 25000 }: {
  newRequestId(): string; fetchImpl?: typeof fetch; timeoutMs?: number;
}) {
  let connection: { serverUrl: string; token: string } | null = null;
  let epoch = 0;
  const pending = new Set<AbortController>();
  async function request(serverUrl: string, token: string, path: string, body?: unknown) {
    const controller = new AbortController(); pending.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(serverUrl + path, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (text.length > 32000) throw new Error('서버 응답이 너무 큽니다.');
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new Error('서버 응답을 확인할 수 없습니다.'); }
      if (!response.ok) {
        const message = object(data) && object(data.error) && typeof data.error.message === 'string' && data.error.message.length <= 500 ? data.error.message : '서버 연결을 완료하지 못했습니다.';
        throw new Error(message);
      }
      return data;
    } catch (error) {
      if (timedOut) throw new Error('응답 시간이 초과됐습니다. 초안은 남아 있습니다.');
      if (controller.signal.aborted) throw new Error('AI 연결이 해제되어 처리를 취소했습니다.');
      throw error;
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  const disconnect = () => { epoch++; connection = null; for (const controller of pending) controller.abort(); };
  const interpreter: CaptureAiInterpreter = {
    async interpret(input) {
      const current = connection; const revision = epoch;
      if (!current) return failed('PROVIDER_UNAVAILABLE', '복잡한 문장을 해석하려면 AI 연결 설정에서 서버를 연결해 주세요.');
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await request(current.serverUrl, current.token, '/v1/interpret', {
          requestId: newRequestId(), actionId: input.actionId, sourceInput: input.sourceInput,
          inputMethod: input.inputMethod, now: input.now, timeZone,
        });
        if (revision !== epoch) return failed('PROVIDER_UNAVAILABLE', '연결이 변경되어 결과를 사용하지 않았습니다.');
        // The application service performs full envelope/domain validation before review.
        if (!object(result) || !['PARSED', 'NEEDS_CLARIFICATION', 'UNSUPPORTED'].includes(String(result.status))) return failed('MALFORMED_RESPONSE', '해석 결과의 형식이 올바르지 않습니다.');
        return result as CaptureAiInterpreterResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 서버에 연결하지 못했습니다.';
        return failed(message.includes('시간') ? 'TIMEOUT' : 'NETWORK_ERROR', message);
      }
    },
  };
  return {
    interpreter, disconnect,
    async connect(url: string, token: string): Promise<AiSession> {
      disconnect(); const revision = epoch;
      const serverUrl = validateServerUrl(url);
      if (!/^vlm_[A-Za-z0-9_-]{43}$/.test(token.trim())) throw new Error('운영자가 발급한 접속 토큰을 입력해 주세요.');
      const cleanToken = token.trim();
      const result = await request(serverUrl, cleanToken, '/v1/session');
      if (revision !== epoch) throw new Error('연결을 취소했습니다.');
      if (!object(result) || result.contractVersion !== 1 || !object(result.usage) || typeof result.usage.used !== 'number' || typeof result.usage.limit !== 'number' || typeof result.usage.resetsAt !== 'string') throw new Error('호환되지 않는 서버 응답입니다.');
      if (result.aiAvailable !== true) throw new Error('서버는 응답했지만 AI 키가 아직 설정되지 않았습니다.');
      connection = { serverUrl, token: cleanToken };
      return { serverUrl, usage: result.usage as AiSession['usage'] };
    },
  };
}
