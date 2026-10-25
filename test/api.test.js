import 'dotenv/config';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDatabasePool } from '../src/db/pool.js';

process.env.NODE_ENV = 'test';

const pool = getDatabasePool();
const users = [];
const properties = [];
const applications = [];
const verifications = [];
let server;
let baseUrl;

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function register(role, suffix) {
  const email = `rentiflow-it-${suffix}-${randomUUID()}@example.test`;
  const result = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password: 'test-password-93', firstName: 'Test', lastName: suffix, role }
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  users.push(result.body.user.id);
  return { ...result.body, email };
}

before(async () => {
  process.env.NODE_ENV = 'test';
  const { app } = await import('../server.js');
  await pool.query('SELECT 1');
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('multi-page HTML entry points and shared assets are served', async () => {
  for (const page of ['index.html', 'properties.html', 'property.html', 'login.html', 'tenant.html', 'landlord.html', 'admin.html']) {
    const response = await fetch(`${baseUrl}/${page}`);
    assert.equal(response.status, 200, `${page} should be reachable`);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
  }
  for (const asset of ['styles.css', 'app.js']) {
    const response = await fetch(`${baseUrl}/${asset}`);
    assert.equal(response.status, 200, `${asset} should be reachable`);
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (users.length) {
    await pool.query(
      `DELETE FROM audit_events
       WHERE actor_id = ANY($1::uuid[])
          OR (target_type = 'application' AND target_id = ANY($2::text[]))
          OR (target_type = 'property' AND target_id = ANY($3::text[]))`,
      [users, applications, properties]
    );
  }
  if (applications.length) await pool.query('DELETE FROM applications WHERE id = ANY($1::uuid[])', [applications]);
  if (verifications.length) await pool.query('DELETE FROM verification_submissions WHERE id = ANY($1::uuid[])', [verifications]);
  if (properties.length) await pool.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [properties]);
  if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  await pool.end();
});

test('tenant application lifecycle persists history and enforces landlord ownership', async () => {
  const escalatedRegistration = await request('/api/v1/auth/register', {
    method: 'POST',
    body: {
      email: `rentiflow-it-escalation-${randomUUID()}@example.test`,
      password: 'test-password-93', firstName: 'Test', lastName: 'Admin', role: 'administrator'
    }
  });
  assert.equal(escalatedRegistration.status, 400);

  const landlord = await register('landlord', 'landlord');
  const otherLandlord = await register('landlord', 'other');
  const tenant = await register('tenant', 'tenant');

  const tenantOwnedProperties = await request('/api/v1/properties/owned', { token: tenant.token });
  assert.equal(tenantOwnedProperties.status, 403);

  const adminId = randomUUID();
  const adminEmail = `rentiflow-it-admin-${randomUUID()}@example.test`;
  const passwordHash = await bcrypt.hash('test-password-93', 12);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role, first_name, last_name)
     VALUES ($1, $2, $3, 'administrator', 'Test', 'Admin')`,
    [adminId, adminEmail, passwordHash]
  );
  users.push(adminId);
  const adminLogin = await request('/api/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: 'test-password-93' } });
  assert.equal(adminLogin.status, 200);

  const location = `Integration Test ${randomUUID().slice(0, 8)}, Accra`;
  const createdProperty = await request('/api/v1/properties', {
    method: 'POST', token: landlord.token,
    body: {
      title: 'Integration Test Apartment', description: 'Synthetic listing created by automated API acceptance tests.',
      location, propertyType: 'apartment', monthlyRentGhs: 2450, bedrooms: 2, bathrooms: 1
    }
  });
  assert.equal(createdProperty.status, 201, JSON.stringify(createdProperty.body));
  const propertyId = createdProperty.body.property.id;
  properties.push(propertyId);
  assert.equal(createdProperty.body.property.status, 'pending_review');
  const unpublishedSearch = await request(`/api/v1/properties?location=${encodeURIComponent(location)}`);
  assert.equal(unpublishedSearch.body.properties.some((property) => property.id === propertyId), false);
  const unpublishedDetail = await request(`/api/v1/properties/${propertyId}`);
  assert.equal(unpublishedDetail.status, 404);

  const moderation = await request(`/api/v1/properties/${propertyId}/moderation`, {
    method: 'PATCH', token: adminLogin.body.token, body: { status: 'published' }
  });
  assert.equal(moderation.status, 200, JSON.stringify(moderation.body));
  const publicSearch = await request(`/api/v1/properties?location=${encodeURIComponent(location)}`);
  assert.equal(publicSearch.status, 200);
  assert.equal(publicSearch.body.properties.some((property) => property.id === propertyId), true);

  const ownPropertyUpdate = await request(`/api/v1/properties/${propertyId}`, {
    method: 'PATCH', token: landlord.token,
    body: {
      title: 'Updated Integration Test Apartment', description: 'Updated synthetic listing used for API acceptance tests.',
      location, propertyType: 'apartment', monthlyRentGhs: 2550, bedrooms: 2, bathrooms: 1
    }
  });
  assert.equal(ownPropertyUpdate.status, 200, JSON.stringify(ownPropertyUpdate.body));
  assert.equal(ownPropertyUpdate.body.property.status, 'pending_review');
  const foreignPropertyUpdate = await request(`/api/v1/properties/${propertyId}`, {
    method: 'PATCH', token: otherLandlord.token,
    body: {
      title: 'Unauthorized edited listing', description: 'A sufficiently long description for the unauthorized listing.',
      location, propertyType: 'apartment', monthlyRentGhs: 2600, bedrooms: 2, bathrooms: 1
    }
  });
  assert.equal(foreignPropertyUpdate.status, 404);
  const hiddenAfterEdit = await request(`/api/v1/properties/${propertyId}`);
  assert.equal(hiddenAfterEdit.status, 404);
  const republished = await request(`/api/v1/properties/${propertyId}/moderation`, {
    method: 'PATCH', token: adminLogin.body.token, body: { status: 'published' }
  });
  assert.equal(republished.status, 200);

  const invalidAvailability = await request(`/api/v1/properties/${propertyId}/availability`, {
    method: 'PATCH', token: landlord.token, body: { isAvailable: true, availableFrom: '2026-02-31' }
  });
  assert.equal(invalidAvailability.status, 400);
  const unavailable = await request(`/api/v1/properties/${propertyId}/availability`, {
    method: 'PATCH', token: landlord.token, body: { isAvailable: false, availableFrom: null }
  });
  assert.equal(unavailable.status, 200, JSON.stringify(unavailable.body));
  const foreignAvailability = await request(`/api/v1/properties/${propertyId}/availability`, {
    method: 'PATCH', token: otherLandlord.token, body: { isAvailable: true, availableFrom: null }
  });
  assert.equal(foreignAvailability.status, 404);
  const hiddenByAvailability = await request(`/api/v1/properties/${propertyId}`);
  assert.equal(hiddenByAvailability.status, 404);
  const unavailableApplication = await request(`/api/v1/properties/${propertyId}/applications`, {
    method: 'POST', token: tenant.token, body: { message: 'I am interested in renting this home from next month.' }
  });
  assert.equal(unavailableApplication.status, 404);
  const availableAgain = await request(`/api/v1/properties/${propertyId}/availability`, {
    method: 'PATCH', token: landlord.token, body: { isAvailable: true, availableFrom: null }
  });
  assert.equal(availableAgain.status, 200);
  const ownerPortfolio = await request('/api/v1/properties/owned', { token: landlord.token });
  const propertyHistory = ownerPortfolio.body.properties.find((item) => item.id === propertyId).history;
  assert.equal(propertyHistory.some((event) => event.eventType === 'listing_updated'), true);
  assert.equal(propertyHistory.filter((event) => event.eventType === 'moderation_decision').length, 2);

  const submitted = await request(`/api/v1/properties/${propertyId}/applications`, {
    method: 'POST', token: tenant.token, body: { message: 'I am interested in renting this home from next month.' }
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const applicationId = submitted.body.application.id;
  applications.push(applicationId);
  assert.equal(submitted.body.application.status, 'submitted');

  const duplicate = await request(`/api/v1/properties/${propertyId}/applications`, {
    method: 'POST', token: tenant.token, body: { message: 'I would like to submit a duplicate application.' }
  });
  assert.equal(duplicate.status, 409);

  const foreignDecision = await request(`/api/v1/properties/applications/${applicationId}`, {
    method: 'PATCH', token: otherLandlord.token, body: { status: 'approved' }
  });
  assert.equal(foreignDecision.status, 404);

  for (const decision of [
    { status: 'under_review' },
    { status: 'information_requested', reason: 'Please share your intended move-in date.' },
    { status: 'under_review' },
    { status: 'shortlisted' },
    { status: 'approved' }
  ]) {
    const result = await request(`/api/v1/properties/applications/${applicationId}`, {
      method: 'PATCH', token: landlord.token, body: decision
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.application.status, decision.status);
  }

  const invalidTransition = await request(`/api/v1/properties/applications/${applicationId}`, {
    method: 'PATCH', token: landlord.token, body: { status: 'rejected', reason: 'No longer available.' }
  });
  assert.equal(invalidTransition.status, 404);

  const history = await request('/api/v1/properties/applications/me', { token: tenant.token });
  assert.equal(history.status, 200);
  const application = history.body.applications.find((item) => item.id === applicationId);
  assert.deepEqual(application.history.map((event) => event.toStatus), [
    'submitted', 'under_review', 'information_requested', 'under_review', 'shortlisted', 'approved'
  ]);
  assert.equal(application.history[2].reason, 'Please share your intended move-in date.');

  const forbiddenReviewQueue = await request('/api/v1/verification/review-queue', { token: landlord.token });
  assert.equal(forbiddenReviewQueue.status, 403);
  const identitySubmission = await request('/api/v1/verification/submissions', {
    method: 'POST', token: tenant.token,
    body: { evidenceReference: `SYNTH-${randomUUID()}` }
  });
  assert.equal(identitySubmission.status, 201);
  verifications.push(identitySubmission.body.submission.id);
  assert.equal(identitySubmission.body.submission.method, 'simulated_manual_review');
  const review = await request(`/api/v1/verification/submissions/${identitySubmission.body.submission.id}`, {
    method: 'PATCH', token: adminLogin.body.token, body: { status: 'approved' }
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const verificationStatus = await request('/api/v1/verification/me', { token: tenant.token });
  assert.equal(verificationStatus.body.submissions[0].status, 'approved');
  assert.equal(verificationStatus.body.method, 'simulated_manual_review');

  await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [tenant.user.id]);
  const suspendedAccess = await request('/api/v1/properties/applications/me', { token: tenant.token });
  assert.equal(suspendedAccess.status, 401);
  const suspendedLogin = await request('/api/v1/auth/login', {
    method: 'POST', body: { email: tenant.email, password: 'test-password-93' }
  });
  assert.equal(suspendedLogin.status, 401);
  await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [tenant.user.id]);

  const audit = await request('/api/v1/admin/audit-events?limit=100', { token: adminLogin.body.token });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.events.some((event) => event.target_id === applicationId && event.action === 'application.decided'), true);

  const archived = await request(`/api/v1/properties/${propertyId}/archive`, { method: 'POST', token: landlord.token });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.property.status, 'archived');
  const foreignArchive = await request(`/api/v1/properties/${propertyId}/archive`, { method: 'POST', token: otherLandlord.token });
  assert.equal(foreignArchive.status, 404);
  const archivedDetail = await request(`/api/v1/properties/${propertyId}`);
  assert.equal(archivedDetail.status, 404);
  const duplicateArchive = await request(`/api/v1/properties/${propertyId}/archive`, { method: 'POST', token: landlord.token });
  assert.equal(duplicateArchive.status, 404);
  const archivedPortfolio = await request('/api/v1/properties/owned', { token: landlord.token });
  const archivedHistory = archivedPortfolio.body.properties.find((item) => item.id === propertyId).history;
  assert.equal(archivedHistory.some((event) => event.eventType === 'archived'), true);
});
