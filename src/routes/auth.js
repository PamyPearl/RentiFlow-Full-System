import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { getDatabasePool } from '../db/pool.js';
import { validateLogin, validateRegistration } from '../auth/validation.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();
const attempts = new Map();

function limitAuthAttempts(request, response, next) {
  const now = Date.now();
  const key = `${request.ip}:${request.path}`;
  const current = attempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
  entry.count += 1;
  attempts.set(key, entry);
  if (attempts.size > 5000) {
    for (const [attemptKey, value] of attempts) if (value.resetAt <= now) attempts.delete(attemptKey);
  }
  if (entry.count > 10) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    return response.status(429).json({ error: 'Too many authentication attempts. Try again later.' });
  }
  return next();
}

function issueToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

router.post('/register', limitAuthAttempts, async (request, response, next) => {
  try {
    const input = validateRegistration(request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const userId = randomUUID();
    const database = getDatabasePool();
    const result = await database.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, first_name, last_name, status, created_at`,
      [userId, input.email, passwordHash, input.role, input.firstName, input.lastName]
    );
    const user = result.rows[0];
    return response.status(201).json({ user, token: issueToken(user) });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'Unable to complete registration with these details' });
    if (error.message?.includes('required') || error.message?.includes('must be') || error.message?.includes('Role')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post('/login', limitAuthAttempts, async (request, response, next) => {
  try {
    const input = validateLogin(request.body);
    const database = getDatabasePool();
    const result = await database.query(
      `SELECT id, email, password_hash, role, first_name, last_name, status
       FROM users WHERE email = $1`,
      [input.email]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) return response.status(401).json({ error: 'Invalid email or password' });
    if (user.status !== 'active') return response.status(401).json({ error: 'Invalid email or password' });
    delete user.password_hash;
    return response.json({ user, token: issueToken(user) });
  } catch (error) {
    if (error.message?.includes('required')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get('/me', requireAuth, async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT id, email, role, first_name, last_name, status, created_at
       FROM users WHERE id = $1`,
      [request.user.sub]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'User account not found' });
    return response.json({ user: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
