import { EndpointError } from 'sdk';
import { withRoom, userFrom } from '../lib/store.js';
import { applyAction, playMove, seatOfId } from '../lib/room.js';

/**
 * POST /api/roomAction { code, action, ... }
 * action: move | ready | sit | fillBots | settings | chat | resign | rematch
 */
export default async function (input, ctx) {
  const user = userFrom(ctx);
  const action = String(input?.action || '');
  if (!action) throw new EndpointError('Не указано действие', { code: 'NO_ACTION' });

  const { state, result } = await withRoom(input?.code, user, (room) => {
    const now = Date.now();
    const seat = seatOfId(room, user.id);
    if (action === 'move') {
      if (seat < 0) return { ok: false, error: 'Вы зритель' };
      return playMove(room, seat, input, now);
    }
    return applyAction(room, user, action, input, now);
  }, action === 'move' ? { bots: false } : {});

  if (result && result.ok === false) {
    throw new EndpointError(result.error || 'Не получилось', { code: 'ACTION_FAILED', action });
  }
  return { ...state, lastAction: result || null };
}
