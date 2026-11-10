import { openDatabaseAsync } from 'expo-sqlite';
import { CalendarRepository } from './repository';

let instance: Promise<CalendarRepository> | undefined;
export function getRepository() {
  instance ??= openDatabaseAsync('quick-time-table.db').then(async db => {
    await db.execAsync('PRAGMA journal_mode = WAL;');
    return new CalendarRepository(db);
  }).catch(error => { instance = undefined; throw error; });
  return instance;
}
