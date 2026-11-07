import { db } from 'sdk';
import { eq } from 'sdk/db';
import { rooms } from '../schema.js';
import { newRoom, maybeStart } from '../lib/room.js';
import { insertRoom, publicState, userFrom, saveRoom } from '../lib/store.js';
import { makeCode } from '../lib/room.js';

/** POST /api/createRoom → новый стол, зовущий сразу садится за него. */
export default async function (input, ctx) {
  const user = userFrom(ctx);
  const settings = {};
  if (Number.isFinite(Number(input?.clock))) settings.clock = Math.min(3600, Math.max(60, Number(input.clock)));
  if (Number.isFinite(Number(input?.inc))) settings.inc = Math.min(30, Math.max(0, Number(input.inc)));
  if (['easy', 'normal', 'hard'].includes(input?.level)) settings.level = input.level;

  // код должен быть свободен — пробуем несколько раз
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeCode(5);
    const busy = await db.select({ code: rooms.code }).from(rooms).where(eq(rooms.code, code)).get();
    if (busy) continue;

    const room = newRoom(code);
    Object.assign(room.settings, settings);
    room.hostId = user.id;
    room.seats[0] = { id: user.id, name: user.name, photo: user.photo, ready: false, bot: false };
    await insertRoom(room);
    return publicState(room, user.id, Date.now());
  }
  throw new Error('не удалось выделить код стола');
}

export { maybeStart, saveRoom };
