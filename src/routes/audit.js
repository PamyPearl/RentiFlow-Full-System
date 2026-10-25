import { Router } from 'express';
import { getDatabasePool } from '../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

const router = Router();

router.get('/', requireAuth, requireRole('administrator'), async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 100);
    const before = typeof request.query.before === 'string' && /^\d{4}-\d\d-\d\dT/.test(request.query.before)
      ? request.query.before
      : null;
    const result = await getDatabasePool().query(
      `SELECT id, actor_id, action, target_type, target_id, metadata, request_id, created_at
       FROM audit_events
       WHERE ($1::timestamptz IS NULL OR created_at < $1::timestamptz)
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [before, limit]
    );
    return response.json({ events: result.rows, pagination: { limit, nextBefore: result.rows.at(-1)?.created_at || null } });
  } catch (error) { return next(error); }
});

export default router;
