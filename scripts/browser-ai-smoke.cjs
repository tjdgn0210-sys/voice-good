// Optional browser check: requires Playwright and an installed Chromium headless shell.
// Run from the project root after `pnpm build:web`. All data/credentials are disposable.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { readFile, stat, mkdir } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const { readConfig } = await import('../server/src/config.mjs');
  const { openStore } = await import('../server/src/store.mjs');
  const { createGateway } = await import('../server/src/server.mjs');
  const { toProposal, ApiError } = await import('../server/src/contracts.mjs');
  const root = path.resolve(__dirname, '../dist');
  const web = createServer(async (req, res) => {
    try {
      let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://local').pathname));
      if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
      try { if (!(await stat(file)).isFile()) file = path.join(root, 'index.html'); } catch { file = path.join(root, 'index.html'); }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }); res.end(await readFile(file));
    } catch { res.writeHead(500); res.end(); }
  });
  web.listen(0, '127.0.0.1'); await once(web, 'listening'); const origin = `http://127.0.0.1:${web.address().port}`;
  const config = { ...readConfig({ OPENAI_API_KEY: 'fixture-only' }), origins: [origin] };
  const store = openStore(':memory:', config); const token = store.issue('browser-test');
  let calls = 0, mode = 'success';
  const gateway = createGateway({ config, store, logger() {}, provider: async input => {
    calls++;
    if (mode === 'failure') throw new ApiError(504, 'AI_TIMEOUT', 'AI 응답 시간이 초과됐습니다. 초안은 남아 있습니다.');
    return toProposal({ status: 'PARSED', message: '', amount: 4500, currencyCode: 'KRW', category: '식비', memo: '친구랑 커피', occurredAt: input.now }, input);
  } });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const button = name => page.getByRole('button', { name, exact: true });
  try {
    await page.goto(origin); await button('입력 내용 확인').waitFor();
    await button('AI 연결 설정').click();
    await page.getByLabel('AI 서버 주소', { exact: true }).fill(`http://127.0.0.1:${gateway.address().port}`);
    await page.getByLabel('개인 접속 토큰', { exact: true }).fill(token.token);
    assert.equal(await button('AI 연결하기').isDisabled(), true);
    await page.getByRole('checkbox').click(); await button('AI 연결하기').click();
    await page.getByText('AI가 연결되어 있습니다.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('개인 접속 토큰', { exact: true }).inputValue(), '');
    await mkdir(path.resolve(__dirname, '../docs/previews'), { recursive: true });
    await page.screenshot({ path: path.resolve(__dirname, '../docs/previews/ai-connection-mobile.png') });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goBack(); await page.getByLabel('지출 문장 입력', { exact: true }).fill('친구랑 커피 4500원 썼어');
    await button('입력 내용 확인').click(); await button('이 내용으로 저장').waitFor();
    assert.equal(calls, 1); assert.equal(await page.getByRole('button', { name: '식비 4,500원, 상세 보기', exact: true }).count(), 0);
    await button('이 내용으로 저장').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.resolve(__dirname, '../docs/previews/ai-review-mobile.png') });
    await button('이 내용으로 저장').click(); await page.getByRole('button', { name: '식비 4,500원, 상세 보기', exact: true }).waitFor();
    mode = 'failure';
    await page.getByLabel('지출 문장 입력', { exact: true }).fill('친구랑 택시 12000원 썼어');
    await button('입력 내용 확인').click(); await page.getByText(/AI 응답 시간이 초과됐습니다/).waitFor();
    assert.equal(await button('이 내용으로 저장').count(), 0);
    assert.equal(await page.getByLabel('지출 문장 입력', { exact: true }).inputValue(), '친구랑 택시 12000원 썼어');
    await page.reload(); await page.getByRole('button', { name: '식비 4,500원, 상세 보기', exact: true }).waitFor();
    assert.equal(await page.getByLabel('지출 문장 입력', { exact: true }).inputValue(), '친구랑 택시 12000원 썼어');
    const previous = calls; await button('입력 내용 확인').click(); await page.getByText(/복잡한 문장을 해석하려면/).waitFor(); assert.equal(calls, previous);
    await page.getByLabel('지출 문장 입력', { exact: true }).fill('점심 7000원'); await button('입력 내용 확인').click(); await button('이 내용으로 저장').waitFor(); assert.equal(calls, previous);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: browser consent → auth → real gateway HTTP → review/no pre-save → SQLite save → AI failure/draft retention → reload/local history and session reset → offline local parse. Settings widths 320/390/768/1440: no horizontal overflow; no runtime errors. AI responses are fixtures, not live model calls.');
  } catch (e) { console.error((await page.locator('body').innerText()).slice(-5000)); throw e; }
  finally { await browser.close(); await Promise.all([new Promise(r => web.close(r)), new Promise(r => gateway.close(r))]); store.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
