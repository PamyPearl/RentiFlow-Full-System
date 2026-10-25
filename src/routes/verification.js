import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getDatabasePool } from '../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validateVerificationReview, validateVerificationSubmission } from '../verification/validation.js';

const router = Router();

router.post('/submissions', requireAuth, requireRole('tenant'), async (request, response, next) => {
  const database = getDatabasePool();
  const client = await database.connect();
  try {
    const submission = validateVerificationSubmission(request.body);
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id, status FROM verification_submissions
       WHERE user_id = $1 AND status IN ('submitted', 'under_review')
       LIMIT 1`,
      [request.user.sub]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'You already have a verification submission under review' });
    }
    const submissionId = randomUUID();
    const result = await client.query(
      `INSERT INTO verification_submissions (id, user_id, evidence_reference)
       VALUES ($1, $2, $3)
       RETURNING id, method, status, evidence_reference, submitted_at`,
      [submissionId, request.user.sub, submission.evidenceReference]
    );
    await client.query(
      `INSERT INTO verification_events (id, submission_id, actor_id, from_status, to_status)
       VALUES ($1, $2, $3, NULL, 'submitted')`,
      [randomUUID(), submissionId, request.user.sub]
    );
    await client.query('COMMIT');
    return response.status(201).json({ submission: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.message?.includes('synthetic evidence')) return response.status(400).json({ error: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/me', requireAuth, requireRole('tenant'), async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT id, method, status, evidence_reference, decision_reason, submitted_at, reviewed_at
       FROM verification_submissions WHERE user_id = $1 ORDER BY submitted_at DESC`,
      [request.user.sub]
    );
    const history = await getDatabasePool().query(
      `SELECT e.submission_id, e.from_status, e.to_status, e.reason, e.created_at
       FROM verification_events e JOIN verification_submissions s ON s.id = e.submission_id
       WHERE s.user_id = $1 ORDER BY e.created_at ASC`,
      [request.user.sub]
    );
    return response.json({ method: 'simulated_manual_review', submissions: result.rows, history: history.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/review-queue', requireAuth, requireRole('administrator'), async (_request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT s.id, s.user_id, u.first_name, u.last_name, u.email, s.method, s.status,
              s.evidence_reference, s.submitted_at
       FROM verification_submissions s JOIN users u ON u.id = s.user_id
       WHERE s.status IN ('submitted', 'under_review')
       ORDER BY s.submitted_at ASC`
    );
    return response.json({ method: 'simulated_manual_review', submissions: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/submissions/:submissionId', requireAuth, requireRole('administrator'), async (request, response, next) => {
  const database = getDatabasePool();
  const client = await database.connect();
  try {
    const review = validateVerificationReview(request.body);
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id, status FROM verification_submissions
       WHERE id = $1 AND status IN ('submitted', 'under_review') FOR UPDATE`,
      [request.params.submissionId]
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'Reviewable verification submission not found' });
    }
    const updated = await client.query(
      `UPDATE verification_submissions
       SET status = $1, reviewer_id = $2, decision_reason = $3, reviewed_at = NOW()
       WHERE id = $4
       RETURNING id, method, status, decision_reason, submitted_at, reviewed_at`,
      [review.status, request.user.sub, review.reason, request.params.submissionId]
    );
    await client.query(
      `INSERT INTO verification_events (id, submission_id, actor_id, from_status, to_status, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), request.params.submissionId, request.user.sub, current.rows[0].status, review.status, review.reason]
    );
    await client.query(
      `INSERT INTO audit_events (id, actor_id, action, target_type, target_id, metadata, request_id)
       VALUES ($1, $2, 'verification.reviewed', 'verification_submission', $3, $4::jsonb, $5)`,
      [randomUUID(), request.user.sub, request.params.submissionId, JSON.stringify({ status: review.status, reason: review.reason }), request.id]
    );
    await client.query('COMMIT');
    return response.json({ submission: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.message?.includes('Review status') || error.message?.includes('review reason')) return response.status(400).json({ error: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

export default router;
