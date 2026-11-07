import { withRoom, userFrom } from '../lib/store.js';

/** POST /api/joinRoom { code } → сажает зрителя за стол и отдаёт состояние. */
export default async function (input, ctx) {
  const user = userFrom(ctx);
  const { state } = await withRoom(input?.code, user);
  return state;
}
