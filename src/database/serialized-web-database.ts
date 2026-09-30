import type { SQLiteDatabase } from 'expo-sqlite';
type Raw = Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'withTransactionAsync'>;
export type DatabasePort = Pick<Raw, 'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync'> & {
  withExclusiveTransactionAsync(work: (transaction: DatabasePort) => Promise<void>): Promise<void>;
};
/** All access to the shared web connection joins one queue, including reads.
 * Transaction callbacks receive an unqueued scope. Never expose the raw connection.
 * A rejected operation releases the queue; native builds retain Expo's exclusive API.
 */
export function createSerializedWebDatabase(raw: Raw): DatabasePort {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  }
  const scoped: DatabasePort = {
    execAsync: raw.execAsync.bind(raw), runAsync: raw.runAsync.bind(raw),
    getFirstAsync: raw.getFirstAsync.bind(raw), getAllAsync: raw.getAllAsync.bind(raw),
    withExclusiveTransactionAsync: async () => { throw new Error('Nested transactions are not supported'); },
  };
  // Preserve Expo's overloads for named and positional bindings without altering arguments.
  const queueMethod = <T extends (...args: never[]) => Promise<unknown>>(method: T): T =>
    ((...args: Parameters<T>) => enqueue(() => method(...args))) as T;
  return {
    execAsync: queueMethod(scoped.execAsync), runAsync: queueMethod(scoped.runAsync),
    getFirstAsync: queueMethod(scoped.getFirstAsync), getAllAsync: queueMethod(scoped.getAllAsync),
    withExclusiveTransactionAsync: work => enqueue(() => raw.withTransactionAsync(() => work(scoped))),
  };
}
