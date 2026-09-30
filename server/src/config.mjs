import { resolve } from 'node:path';

export function readConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const origins = (env.ALLOWED_ORIGINS ?? 'http://localhost:8081,http://localhost:8082').split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of origins) {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact origins');
    if (env.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error('Production origins must use HTTPS');
  }
  return {
    port: integer('PORT', 3001, 1, 65535), host: env.HOST ?? '127.0.0.1',
    dbPath: resolve(env.DATABASE_PATH ?? './data/gateway.sqlite'), origins,
    apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_MODEL ?? 'gpt-4.1-mini-2025-04-14',
    timeoutMs: integer('AI_TIMEOUT_MS', 20000, 1000, 30000),
    maxOutputTokens: integer('MAX_OUTPUT_TOKENS', 800, 256, 2000),
    perUserDaily: integer('USER_DAILY_REQUESTS', 30, 1, 10000),
    globalDaily: integer('GLOBAL_DAILY_REQUESTS', 500, 1, 100000),
    perMinute: integer('USER_REQUESTS_PER_MINUTE', 6, 1, 60),
    maxConcurrent: integer('GLOBAL_CONCURRENCY', 4, 1, 32),
    // Conservative operator-defined cost allowance, NOT a provider billing quote.
    reserveMicroUsd: integer('RESERVE_MICRO_USD_PER_CALL', 50000, 1, 100000000),
    dailyBudgetMicroUsd: integer('DAILY_BUDGET_MICRO_USD', 2000000, 1, 1000000000),
  };
}
