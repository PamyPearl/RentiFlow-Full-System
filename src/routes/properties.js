import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getDatabasePool } from '../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validateApplicationDecision, validateApplicationInput, validateAvailabilityInput, validateModerationDecision, validatePropertyInput } from '../properties/validation.js';

const router = Router();

router.get('/', async (request, response, next) => {
  try {
    const values = [];
    const conditions = ["p.status = 'published'", 'p.is_available = TRUE', '(p.available_from IS NULL OR p.available_from <= CURRENT_DATE)'];
    const addFilter = (sql, value) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (typeof request.query.location === 'string' && request.query.location.trim()) addFilter('p.location ILIKE ?', `%${request.query.location.trim()}%`);
    if (typeof request.query.type === 'string' && ['apartment', 'house', 'room'].includes(request.query.type)) addFilter('p.property_type = ?', request.query.type);
    if (request.query.maxRent !== undefined && Number.isFinite(Number(request.query.maxRent)) && Number(request.query.maxRent) > 0) addFilter('p.monthly_rent_ghs <= ?', Number(request.query.maxRent));
    const limit = Math.min(Math.max(Number(request.query.limit) || 24, 1), 50);
    const offset = Math.max(Number(request.query.offset) || 0, 0);
    values.push(limit, offset);
    const result = await getDatabasePool().query(
      `SELECT p.id, p.title, p.description, p.location, p.property_type, p.monthly_rent_ghs,
              p.bedrooms, p.bathrooms, p.size_square_metres, p.image_url, p.is_available, p.available_from, p.created_at
       FROM properties p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return response.json({ properties: result.rows, pagination: { limit, offset, returned: result.rowCount } });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const property = validatePropertyInput(request.body);
    const result = await getDatabasePool().query(
      `WITH created AS (
       INSERT INTO properties
       (id, landlord_id, title, description, location, property_type, monthly_rent_ghs,
        bedrooms, bathrooms, size_square_metres, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
       RETURNING id, title, description, location, property_type, monthly_rent_ghs,
                 bedrooms, bathrooms, size_square_metres, image_url, status, created_at
       ), recorded AS (
         INSERT INTO property_events (id, property_id, actor_id, event_type, from_status, to_status, request_id)
         SELECT $12, id, $2, 'listing_submitted', NULL, status, $13 FROM created
       )
       SELECT * FROM created`,
      [randomUUID(), request.user.sub, property.title, property.description, property.location,
        property.propertyType, property.monthlyRentGhs, property.bedrooms, property.bathrooms,
        property.sizeSquareMetres, property.imageUrl, randomUUID(), request.id]
    );
    return response.status(201).json({ property: result.rows[0] });
  } catch (error) {
    if (error.message?.includes('must be') || error.message?.includes('must be a valid')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get('/owned', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT p.id, p.title, p.description, p.location, p.property_type, p.monthly_rent_ghs,
              p.bedrooms, p.bathrooms, p.size_square_metres, p.image_url, p.status,
              p.is_available, p.available_from, p.created_at, p.updated_at,
              COALESCE((SELECT json_agg(json_build_object(
                'eventType', e.event_type, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                'details', e.details, 'createdAt', e.created_at
              ) ORDER BY e.created_at, e.id) FROM property_events e WHERE e.property_id = p.id), '[]'::json) AS history
       FROM properties p WHERE p.landlord_id = $1 ORDER BY p.created_at DESC`,
      [request.user.sub]
    );
    return response.json({ properties: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:propertyId', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const property = validatePropertyInput(request.body);
    const changedFields = ['title', 'description', 'location', 'propertyType', 'monthlyRentGhs', 'bedrooms', 'bathrooms', 'sizeSquareMetres', 'imageUrl'];
    const result = await getDatabasePool().query(
      `WITH previous AS MATERIALIZED (
         SELECT id, status FROM properties
         WHERE id = $10 AND landlord_id = $11 AND status <> 'archived'
         FOR UPDATE
       ), changed AS (
         UPDATE properties p SET
           title = $1, description = $2, location = $3, property_type = $4,
           monthly_rent_ghs = $5, bedrooms = $6, bathrooms = $7,
           size_square_metres = $8, image_url = $9, status = 'pending_review', updated_at = NOW()
         FROM previous WHERE p.id = previous.id
         RETURNING p.id, p.title, p.description, p.location, p.property_type, p.monthly_rent_ghs,
                   p.bedrooms, p.bathrooms, p.size_square_metres, p.image_url, p.status,
                   p.is_available, p.available_from, p.updated_at
       ), recorded AS (
         INSERT INTO property_events (id, property_id, actor_id, event_type, from_status, to_status, details, request_id)
         SELECT $12, changed.id, $11, 'listing_updated', previous.status, changed.status,
                jsonb_build_object('changedFields', $13::jsonb), $14
         FROM changed JOIN previous ON previous.id = changed.id
       )
       SELECT * FROM changed`,
      [property.title, property.description, property.location, property.propertyType, property.monthlyRentGhs,
        property.bedrooms, property.bathrooms, property.sizeSquareMetres, property.imageUrl,
        request.params.propertyId, request.user.sub, randomUUID(), JSON.stringify(changedFields), request.id]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Editable property listing not found' });
    return response.json({ property: result.rows[0], message: 'Listing updated and sent for review.' });
  } catch (error) {
    if (error.message?.includes('must be') || error.message?.includes('must be a valid')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.patch('/:propertyId/availability', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const availability = validateAvailabilityInput(request.body);
    const result = await getDatabasePool().query(
      `WITH changed AS (
         UPDATE properties p SET is_available = $1, available_from = $2, updated_at = NOW()
         WHERE p.id = $3 AND p.landlord_id = $4 AND p.status <> 'archived'
         RETURNING p.id, p.status, p.is_available, p.available_from, p.updated_at
       ), recorded AS (
         INSERT INTO property_events (id, property_id, actor_id, event_type, details, request_id)
         SELECT $5, id, $4, 'availability_changed',
                jsonb_build_object('isAvailable', is_available, 'availableFrom', available_from), $6
         FROM changed
       )
       SELECT * FROM changed`,
      [availability.isAvailable, availability.availableFrom, request.params.propertyId, request.user.sub, randomUUID(), request.id]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Editable property listing not found' });
    return response.json({ property: result.rows[0] });
  } catch (error) {
    if (error.message?.includes('Availability') || error.message?.includes('Available-from')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post('/:propertyId/archive', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `WITH previous AS MATERIALIZED (
         SELECT id, status FROM properties WHERE id = $1 AND landlord_id = $2 AND status <> 'archived' FOR UPDATE
       ), changed AS (
         UPDATE properties p SET status = 'archived', updated_at = NOW()
         FROM previous WHERE p.id = previous.id
         RETURNING p.id, p.status, p.updated_at
       ), recorded AS (
         INSERT INTO property_events (id, property_id, actor_id, event_type, from_status, to_status, request_id)
         SELECT $3, changed.id, $2, 'archived', previous.status, changed.status, $4
         FROM changed JOIN previous ON previous.id = changed.id
       )
       SELECT * FROM changed`,
      [request.params.propertyId, request.user.sub, randomUUID(), request.id]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Archivable property listing not found' });
    return response.json({ property: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/landlord/applications', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT a.id, a.status, a.message, a.decision_reason, a.created_at, a.updated_at,
              p.id AS property_id, p.title, p.location, p.monthly_rent_ghs,
              u.id AS tenant_id, u.first_name, u.last_name, u.email
       FROM applications a
       JOIN properties p ON p.id = a.property_id
       JOIN users u ON u.id = a.tenant_id
       WHERE p.landlord_id = $1 ORDER BY a.created_at DESC`,
      [request.user.sub]
    );
    return response.json({ applications: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/moderation/queue', requireAuth, requireRole('administrator'), async (_request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT p.id, p.title, p.description, p.location, p.property_type,
              p.monthly_rent_ghs, p.bedrooms, p.bathrooms, p.image_url,
              p.status, p.created_at, u.first_name, u.last_name, u.email
       FROM properties p JOIN users u ON u.id = p.landlord_id
       WHERE p.status = 'pending_review' ORDER BY p.created_at ASC`
    );
    return response.json({ properties: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:propertyId/moderation', requireAuth, requireRole('administrator'), async (request, response, next) => {
  try {
    const decision = validateModerationDecision(request.body);
    const result = await getDatabasePool().query(
      `WITH changed AS (
         UPDATE properties SET status = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'pending_review'
         RETURNING id, title, status, updated_at
       ), logged AS (
         INSERT INTO audit_events (id, actor_id, action, target_type, target_id, metadata, request_id)
         SELECT $3, $4, 'property.moderated', 'property', id::text,
                jsonb_build_object('status', status, 'reason', $5::text), $6
         FROM changed
       ), recorded AS (
         INSERT INTO property_events (id, property_id, actor_id, event_type, from_status, to_status, details, request_id)
         SELECT $7, id, $4, 'moderation_decision', 'pending_review', status,
                jsonb_build_object('reason', $5::text), $6
         FROM changed
       )
       SELECT id, title, status, updated_at FROM changed`,
      [decision.status, request.params.propertyId, randomUUID(), request.user.sub, decision.reason, request.id, randomUUID()]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Pending property listing not found' });
    return response.json({ property: result.rows[0], decisionReason: decision.reason });
  } catch (error) {
    if (error.message?.includes('Moderation status') || error.message?.includes('rejection reason')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post('/:propertyId/applications', requireAuth, requireRole('tenant'), async (request, response, next) => {
  try {
    const application = validateApplicationInput(request.body);
    const result = await getDatabasePool().query(
      `WITH created AS (
         INSERT INTO applications (id, property_id, tenant_id, message)
         SELECT $1, p.id, $2, $3 FROM properties p WHERE p.id = $4 AND p.status = 'published'
           AND p.is_available = TRUE AND (p.available_from IS NULL OR p.available_from <= CURRENT_DATE)
         RETURNING id, property_id, tenant_id, message, status, created_at
       ), recorded AS (
         INSERT INTO application_events (id, application_id, actor_id, from_status, to_status, request_id)
         SELECT $5, id, tenant_id, NULL, status, $6 FROM created
       )
       SELECT * FROM created`,
      [randomUUID(), request.user.sub, application.message, request.params.propertyId, randomUUID(), request.id]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Published property not found' });
    return response.status(201).json({ application: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'You have already applied to this property' });
    if (error.message?.includes('Application') || error.message?.includes('must be between')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get('/applications/me', requireAuth, requireRole('tenant'), async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT a.id, a.status, a.message, a.decision_reason, a.created_at, a.updated_at,
              p.id AS property_id, p.title, p.location, p.monthly_rent_ghs, p.image_url,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'fromStatus', e.from_status, 'toStatus', e.to_status,
                  'reason', e.reason, 'createdAt', e.created_at
                ) ORDER BY e.created_at, e.id)
                FROM application_events e WHERE e.application_id = a.id
              ), '[]'::json) AS history
       FROM applications a JOIN properties p ON p.id = a.property_id
       WHERE a.tenant_id = $1 ORDER BY a.created_at DESC`,
      [request.user.sub]
    );
    return response.json({ applications: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.patch('/applications/:applicationId', requireAuth, requireRole('landlord'), async (request, response, next) => {
  try {
    const decision = validateApplicationDecision(request.body);
    const result = await getDatabasePool().query(
      `WITH previous AS MATERIALIZED (
         SELECT a.id, a.status
         FROM applications a JOIN properties p ON p.id = a.property_id
         WHERE a.id = $3 AND p.landlord_id = $4
           AND ((a.status = 'submitted' AND $1 IN ('under_review', 'information_requested', 'shortlisted', 'approved', 'rejected'))
             OR (a.status = 'under_review' AND $1 IN ('information_requested', 'shortlisted', 'approved', 'rejected'))
             OR (a.status = 'information_requested' AND $1 = 'under_review')
             OR (a.status = 'shortlisted' AND $1 IN ('information_requested', 'approved', 'rejected')))
         FOR UPDATE OF a
       ), changed AS (
         UPDATE applications a SET status = $1, decision_reason = $2, updated_at = NOW()
         FROM previous c WHERE a.id = c.id
         RETURNING a.id, a.status, a.decision_reason, a.updated_at
       ), history AS (
         INSERT INTO application_events (id, application_id, actor_id, from_status, to_status, reason, request_id)
         SELECT $5, changed.id, $4, previous.status, changed.status, $2, $6
         FROM changed JOIN previous ON previous.id = changed.id
       ), logged AS (
         INSERT INTO audit_events (id, actor_id, action, target_type, target_id, metadata, request_id)
         SELECT $7, $4, 'application.decided', 'application', id::text,
                jsonb_build_object('status', status, 'reason', decision_reason), $6
         FROM changed
       )
       SELECT id, status, decision_reason, updated_at FROM changed`,
      [decision.status, decision.reason, request.params.applicationId, request.user.sub, randomUUID(), request.id, randomUUID()]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Reviewable application not found for your property' });
    return response.json({ application: result.rows[0] });
  } catch (error) {
    if (error.message?.includes('Application decision') || error.message?.includes('A reason') || error.message?.includes('Decision reason')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get('/:propertyId', async (request, response, next) => {
  try {
    const result = await getDatabasePool().query(
      `SELECT p.id, p.title, p.description, p.location, p.property_type, p.monthly_rent_ghs,
              p.bedrooms, p.bathrooms, p.size_square_metres, p.image_url, p.is_available, p.available_from, p.created_at
       FROM properties p WHERE p.id = $1 AND p.status = 'published' AND p.is_available = TRUE
         AND (p.available_from IS NULL OR p.available_from <= CURRENT_DATE)`,
      [request.params.propertyId]
    );
    if (!result.rows[0]) return response.status(404).json({ error: 'Published property not found' });
    return response.json({ property: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

export default router;
