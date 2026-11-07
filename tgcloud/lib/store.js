/**
 * Мостик между доменом стола и таблицей rooms.
 * Каждый запрос: загрузить строку → посадить зрителя → применить изменение →
 * дотюнить ботов и время → сохранить → вернуть состояние.
 */
import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { rooms } from '../schema.js';
import { hydrate, dehydrate, newRoom, joinRoom, tick, publicState } from './room.js';

export function userFrom(ctx) {
  const u = ctx?.initData?.user;
  if (!u || !u.id) throw new EndpointError('Нужен вход через Telegram', { code: 'NO_USER' });
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Игрок';
  return { id: String(u.id), name, photo: u.photo_url || null };
}

export const normalizeCode = (code) => String(code || '').trim().toUpperCase().slice(0, 8);

export async function loadRoom(code) {
  const row = await db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!row) throw new EndpointError('Стол не найден', { code: 'NO_ROOM' });
  return hydrate(row);
}

export async function saveRoom(room) {
  const patch = dehydrate(room);
  await db.update(rooms).set(patch).where(eq(rooms.code, room.code)).run();
  return patch.version;
}

export async function insertRoom(room) {
  const patch = dehydrate(room);
  await db.insert(rooms).values({ code: room.code, ...patch }).run();
  return patch.version;
}

/**
 * Загрузить стол, применить изменение, дотюнить ботов/время, сохранить.
 * @param {string} code
 * @param {{id: string, name: string, photo?: string|null}} user
 * @param {(room) => any} [mutate]
 */
export async function withRoom(code, user, mutate, opts = {}) {
  const room = await loadRoom(normalizeCode(code));
  joinRoom(room, user);
  const result = mutate ? mutate(room) : undefined;
  const now = Date.now();
  tick(room, now, opts);
  await saveRoom(room);
  return { room, result, state: publicState(room, user.id, now) };
}

export { newRoom, joinRoom, tick, publicState, hydrate, dehydrate };
