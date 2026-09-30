# Voice Life AI Gateway R1

An executable Node.js 24 server with no external runtime dependencies. It authenticates pilot users, bounds AI usage and calls OpenAI Responses with a strict extraction schema. It never opens the app's SQLite database or executes financial actions.

## Run locally

From this directory:

```sh
cp .env.example .env
# Edit .env: set OPENAI_API_KEY to your server-side project key.
npm start
```

In another terminal, from the same directory and environment:

```sh
npm run token -- issue pilot-001 7
# Returns token id, one personal access token and its expiry. Give it only to that user.
# Later, revoke by the returned token id:
npm run token -- revoke TOKEN_ID
```

Open the app, choose **AI 연결 설정**, enter `http://localhost:3001` and the issued `vlm_` token, then accept the stated transfer scope and connect. The app accepts HTTPS origins or HTTP loopback addresses only. On a physical phone, localhost points to the phone: use an HTTPS API endpoint reachable by that device. Do not enable cleartext traffic globally or embed a provider key in the app.

`GET /v1/session` checks authentication and configuration without making a paid model call. The first complex sentence is a real model request when the key is configured. No demo provider is selected by environment or production code; fake providers exist only in tests.

The default model snapshot is `gpt-4.1-mini-2025-04-14`; change `OPENAI_MODEL` only to a Responses/strict-JSON-schema compatible model and rerun the acceptance checks. The default uses a non-reasoning model with bounded output for a small extraction task, not a recommendation that it is the newest model.

## API contract v1

All protected requests use `Authorization: Bearer <personal vlm_ token>`. Provider credentials are separate. Tokens are 256-bit random values; only SHA-256 digests are stored. The operator assigns a stable pseudonymous user ID, so issuing another token for that user does not reset their quota. Tokens expire after 1–90 days (default 7), and revocation takes effect on the next request. This is pilot provisioning, not self-service account registration, OAuth, billing or a full account-recovery system.

| Endpoint | Meaning |
| --- | --- |
| `GET /healthz` | Process liveness, no authentication or provider call |
| `GET /v1/session` | Authentication, `aiAvailable`, `contractVersion: 1`, current user's usage and UTC reset time |
| `POST /v1/interpret` | Interpret one text/final voice transcript, return a validated proposal or a clarification/unsupported result |

Exact POST body (no additional properties):

```json
{
  "requestId": "4de0837a-2653-4a71-87e4-787f3c64b876",
  "actionId": "a5c403dc-5d23-4f9d-a402-e77e9c210a19",
  "sourceInput": "친구랑 커피 4500원 썼어",
  "inputMethod": "TEXT",
  "now": "2026-09-30T02:00:00.000Z",
  "timeZone": "Asia/Seoul"
}
```

`requestId` is an HTTP attempt ID. `actionId` is the stable local action ID. They serve different purposes. Text is limited to 1,000 UTF-16 code units and the JSON body to 8 KiB. `now` is the draft's capture reference time, not necessarily the server clock; dates use the IANA timezone. UTC timestamps must be canonical with milliseconds. Only TEXT/VOICE are accepted.

Success responses match the existing client interpretation contract:

- `PARSED` + `proposal`: CREATE_TRANSACTION, EXPENSE, one positive integer KRW amount, UTC occurrence, optional category/memo, exact sourceInput/actionId/inputMethod, no dependencies.
- `NEEDS_CLARIFICATION` + Korean `message`: the user edits the retained sentence and submits again.
- `UNSUPPORTED` + Korean `message`: use manual entry or split the request.

Errors use `{ "error": { "code", "message", "requestId" } }` with 400/401/403/409/413/415/429/500/502/503/504 status codes. Error request IDs are diagnostic trace IDs. Invalid input/auth never invokes the provider. 429 responses include `Retry-After`. An upstream provider throttle is surfaced as 503. No automatic retry occurs at either layer: the user explicitly requests another interpretation, which gets a new requestId and consumes another allowance. Saving a reviewed proposal reuses actionId and the existing local idempotent executor.

The server owns the envelope. The model supplies only extraction fields. Both server and client validate output. Ambiguous bare `7시` is clarified without asking the model to guess. Explicit dates without exact times are prompted for clarification by the model. Multiple expenses, mixed task/event commands, income, refunds and foreign currencies are outside this release. Model semantic accuracy still requires live Korean-language evaluation; structural validation cannot prove that every amount/date was understood correctly. Review remains mandatory in the UI.

## Limits, durability and retry behavior

- Default per user: 6 accepted AI attempts in a rolling minute, 30 per UTC day, 1 in progress.
- Default global: 4 in progress, 500 per UTC day, plus the cost allowance below.
- Default provider timeout: 20 seconds. Client timeout: 25 seconds. Output limit: 800 tokens.
- Daily cost allowance: 2,000,000 micro-USD units, with 50,000 units reserved per accepted attempt, including failures/timeouts. These defaults effectively allow at most 40 global attempts per day. This is an operator-defined conservative allowance, **not measured provider billing or a guaranteed currency cap**. Review the allowance for your selected model/pricing and configure provider-side project spending controls as well.
- A short synchronous SQLite `BEGIN IMMEDIATE` atomically checks and reserves rate/concurrency/daily/budget capacity before the network call. It never holds a SQL transaction across model latency. Reservations survive restart; a crash leaves a bounded lease (timeout + 10 seconds). Failed/uncertain provider calls are not refunded because they may already have incurred cost.
- Same user/requestId/body: replay RAM-cached success or failure (10-minute TTL, max 512 entries), no second model call. Same ID with changed body: 409. While pending, after a restart, cache eviction or expiry: 409 ALREADY_ATTEMPTED; no silent provider replay. The UI's explicit new attempt uses a new requestId.
- Metadata and request fingerprints are retained for 7 days and pruned during accepted request processing. Idempotency is bounded to that period. Quotas use server UTC time. Fingerprints are SHA-256 hashes of the canonical request, not encryption; treat the database as sensitive operational metadata.

## Privacy and deployment boundary

- App: core records, raw_input, drafts and ActionLog remain local. Tokens and connection state are RAM-only and reset on full app restart/web reload. No token goes into local drafts or EXPO_PUBLIC environment variables. The optional EXPO_PUBLIC_AI_SERVER_URL is a public origin only.
- Provider request: submitted sentence, reference timestamp, timezone and extraction instructions/schema. No app history, user/token identity, action ID or raw audio. `store: false` is set. This does not promise zero retention by OpenAI; provider data-processing and abuse-monitoring policies still apply.
- Gateway disk: token hashes, pseudonymous IDs, request hashes/status/timing and usage counters. No request/response text. RAM temporarily contains input/output and the replay cache.
- Logs: trace ID, status/code and latency only. Never log Authorization, request bodies, query strings or model output at the reverse proxy either.

Run one long-lived gateway instance on a private host/container with a persistent local SQLite volume. This release is not a serverless or multi-region design. SQLite is not suitable for a shared network filesystem. Requests/quotas coordinate across handles on the same local database, but replay cache lives in one process. For scale-out, migrate the ledger/leases to a shared transactional service first.

The included Dockerfile uses a non-root process:

```sh
docker build -t voice-life-ai .
docker run --rm --env-file .env -e HOST=0.0.0.0 -e DATABASE_PATH=/app/data/gateway.sqlite -p 127.0.0.1:3001:3001 -v voice-life-ai-data:/app/data voice-life-ai
```

Place an HTTPS reverse proxy in front for real users. Keep the API port private, configure exact HTTPS `ALLOWED_ORIGINS` (no wildcard), ingress connection/rate limits and a backup/restore policy. Do not include `.env` in images/backups shared with others. Provision individual tokens; do not put a shared secret into a public app build. No deployment, domain, TLS certificate or production credential is included in this ZIP.

## Verification

```sh
npm test
npm run check
```

Tests cover HTTP auth/revocation/expiry, strict inputs/CORS, quota/budget atomicity, concurrency, replay and conflict, restart behavior, provider request schema, malformed output, refusal, timeout, no automatic retries, and ambiguous time. They use disposable data and provider fixtures, not paid API calls. The root `pnpm test` also exercises the actual client HTTP adapter through the gateway and the real local SQLite execution/Undo path.

Sources checked on 2026-09-30:
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://nodejs.org/api/sqlite.html
- https://docs.expo.dev/versions/v57.0.0/
