import jwt from 'jsonwebtoken';
import { getDatabasePool } from '../db/pool.js';

export async function requireAuth(request, response, next) {
  const header = request.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return response.status(401).json({ error: 'Authentication required' });

  let claims;
  try {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    claims = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.message === 'JWT_SECRET is not configured') return next(error);
    return response.status(401).json({ error: 'Invalid or expired session' });
  }

  try {
    // Resolve current account state and role on every request so a suspended
    // account or changed role cannot keep using stale JWT claims.
    const result = await getDatabasePool().query(
      'SELECT id, role, status FROM users WHERE id = $1', [claims.sub]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') return response.status(401).json({ error: 'Invalid or expired session' });
    request.user = { ...claims, sub: user.id, role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!allowedRoles.includes(request.user?.role)) return response.status(403).json({ error: 'You do not have permission for this action' });
    return next();
  };
}
