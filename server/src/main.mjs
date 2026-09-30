import { readConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createOpenAiProvider } from './provider.mjs';
import { createGateway } from './server.mjs';
process.umask(0o077);
const config = readConfig();
const store = openStore(config.dbPath, config);
const server = createGateway({ config, store, provider: createOpenAiProvider(config) });
server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'listening', port: config.port, aiConfigured: Boolean(config.apiKey) })));
function shutdown() { server.close(() => { store.close(); process.exit(0); }); setTimeout(() => process.exit(1), 35000).unref(); }
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
