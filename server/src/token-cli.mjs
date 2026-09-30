import { readConfig } from './config.mjs';
import { openStore } from './store.mjs';
process.umask(0o077);
const [command, userOrId, days = '7'] = process.argv.slice(2);
if (!['issue', 'revoke'].includes(command) || !userOrId) { console.error('Usage: npm run token -- issue USER_ID [DAYS] | revoke TOKEN_ID'); process.exit(1); }
const config = readConfig(); const store = openStore(config.dbPath, config);
try {
  // Token output is deliberate: show it once to the operator for delivery to that user.
  if (command === 'issue') console.log(JSON.stringify(store.issue(userOrId, Number(days)), null, 2));
  else console.log(JSON.stringify({ revoked: store.revoke(userOrId) }));
} finally { store.close(); }
