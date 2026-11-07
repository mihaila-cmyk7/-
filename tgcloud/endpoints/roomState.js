import { withRoom, userFrom } from '../lib/store.js';

/**
 * POST /api/roomState { code } → текущее состояние стола.
 * Здесь же «тикают» боты и просрочка времени: отдельного планировщика
 * на платформе нет, поэтому опрос клиента и есть heartbeat.
 */
export default async function (input, ctx) {
  const user = userFrom(ctx);
  const { state } = await withRoom(input?.code, user);
  return state;
}
