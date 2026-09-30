import { Platform } from 'react-native';
import { createSerializedWebDatabase, type DatabasePort } from './serialized-web-database';
import { openDatabaseAsync } from 'expo-sqlite';

import { migrateDatabase } from './migrations/migrate';

const DATABASE_NAME = 'voice-life-manager.db';

/** Infrastructure API for future repository implementations, not feature/UI queries. */
export type ApplicationDatabase = DatabasePort;

let initialization: Promise<ApplicationDatabase> | undefined;

async function openAndInitialize(): Promise<ApplicationDatabase> {
  const database = await openDatabaseAsync(DATABASE_NAME);
  try {
    const connection: DatabasePort = Platform.OS === 'web' ? createSerializedWebDatabase(database) : database;
    await connection.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrateDatabase(connection);
    return connection;
  } catch (error) {
    try {
      await database.closeAsync();
    } catch {
      // Preserve the original initialization error; never delete the database to recover.
      console.error('Failed to close the database after initialization failure.');
    }
    throw error;
  }
}

/** One shared initialized connection per module lifetime. Concurrent callers share startup.
 * Failed initialization rejects all callers and permits a later explicit retry.
 * The successful connection stays open for the application lifetime.
 */
export function getDatabase(): Promise<ApplicationDatabase> {
  if (!initialization) {
    initialization = openAndInitialize().catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}
