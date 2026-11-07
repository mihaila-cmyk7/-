import { table, text, integer, json, index, sql } from 'sdk/db';

/**
 * Стол = одна строка. Партия и места лежат в JSON-колонках: так проще
 * атомарно обновлять стол одним UPDATE, а миграции остаются маленькими.
 */
export const rooms = table(
  'rooms',
  {
    code: text('code').primaryKey(),
    status: text('status').notNull().default('lobby'), // lobby | playing | finished
    hostId: text('host_id'),
    seats: json('seats').notNull(),
    settings: json('settings').notNull(),
    game: json('game'),
    clocks: json('clocks').notNull(),
    turnStart: integer('turn_start').notNull().default(0),
    pendingBot: integer('pending_bot', { mode: 'boolean' }).notNull().default(false),
    chat: json('chat'),
    version: integer('version').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index('idx_rooms_status').on(t.status),
  }),
);
