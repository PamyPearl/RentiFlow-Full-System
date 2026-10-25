import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { validateLogin, validateRegistration } from '../src/auth/validation.js';
import { canTransitionApplication, validateApplicationDecision, validateApplicationInput, validateAvailabilityInput, validateModerationDecision, validatePropertyInput } from '../src/properties/validation.js';
import { validateVerificationReview, validateVerificationSubmission } from '../src/verification/validation.js';
import { createResendMailer } from '../src/integrations/email.js';
import { createCloudinaryMediaStore } from '../src/integrations/media-storage.js';
import { getIntegrationStatus } from '../src/integrations/status.js';

test('registration normalizes email and excludes privileged roles', () => {
  const input = validateRegistration({ email: ' TENANT@EXAMPLE.COM ', password: 'safe-password', firstName: 'Ama', lastName: 'Mensah', role: 'tenant' });
  assert.equal(input.email, 'tenant@example.com');
  assert.throws(() => validateRegistration({ email: 'admin@example.com', password: 'safe-password', firstName: 'Admin', lastName: 'Person', role: 'administrator' }), /Role/);
  assert.throws(() => validateRegistration(null), /required/);
});

test('login rejects incomplete and malformed inputs', () => {
  assert.deepEqual(validateLogin({ email: ' PERSON@example.com ', password: 'pw' }), { email: 'person@example.com', password: 'pw' });
  assert.throws(() => validateLogin(null), /required/);
});

test('property input validates type, rent, and image URL', () => {
  const input = validatePropertyInput({ title: 'Osu flat', description: 'A bright and spacious home.', location: 'Osu, Accra', propertyType: 'apartment', monthlyRentGhs: 3200, bedrooms: 2, bathrooms: 1, imageUrl: 'https://example.test/home.jpg' });
  assert.equal(input.monthlyRentGhs, 3200);
  assert.throws(() => validatePropertyInput({}), /Title/);
  assert.throws(() => validatePropertyInput({ title: 'A fine home', description: 'A bright and spacious home.', location: 'Osu', propertyType: 'apartment', monthlyRentGhs: 0, bedrooms: 1, bathrooms: 1, imageUrl: 'javascript:alert(1)' }), /rent/);
});

test('property availability requires a boolean and a real ISO calendar date', () => {
  assert.deepEqual(validateAvailabilityInput({ isAvailable: true, availableFrom: '2026-10-25' }), {
    isAvailable: true, availableFrom: '2026-10-25'
  });
  assert.throws(() => validateAvailabilityInput({ isAvailable: 'true' }), /true or false/);
  assert.throws(() => validateAvailabilityInput({ isAvailable: true, availableFrom: '2026-02-31' }), /valid YYYY-MM-DD/);
});

test('application decisions require valid transitions and rejection reasons', () => {
  assert.equal(validateApplicationInput({ message: 'I would like to rent this home.' }).message.length > 0, true);
  assert.throws(() => validateApplicationInput(null), /required/);
  assert.throws(() => validateApplicationDecision({ status: 'rejected' }), /reason/);
  assert.throws(() => validateApplicationDecision({ status: 'withdrawn' }), /invalid/);
  assert.equal(validateApplicationDecision({ status: 'approved' }).status, 'approved');
  assert.throws(() => validateApplicationDecision({ status: 'information_requested' }), /reason/);
  assert.equal(validateApplicationDecision({ status: 'information_requested', reason: 'Please provide your intended move-in date.' }).status, 'information_requested');
  assert.equal(canTransitionApplication('submitted', 'shortlisted'), true);
  assert.equal(canTransitionApplication('information_requested', 'under_review'), true);
  assert.equal(canTransitionApplication('approved', 'rejected'), false);
  assert.equal(canTransitionApplication('rejected', 'approved'), false);
});

test('moderation rejects invalid decisions and requires rejection rationale', () => {
  assert.throws(() => validateModerationDecision({ status: 'rejected' }), /rejection reason/);
  assert.equal(validateModerationDecision({ status: 'published' }).status, 'published');
});

test('identity workflow uses a synthetic reference and reasoned negative outcomes', () => {
  assert.equal(validateVerificationSubmission({ evidenceReference: 'DEV-REF-002' }).evidenceReference, 'DEV-REF-002');
  assert.throws(() => validateVerificationSubmission({ evidenceReference: 'x' }), /synthetic/);
  assert.throws(() => validateVerificationReview({ status: 'rejected' }), /reason/);
  assert.equal(validateVerificationReview({ status: 'approved' }).status, 'approved');
});

test('Resend adapter sends a transactional email and hides provider response errors', async () => {
  let request;
  const client = { emails: { send: async (options) => { request = options; return { data: { id: 'email-test-id' }, error: null }; } } };
  const mailer = createResendMailer({ apiKey: 'test-key', from: 'RentiFlow <onboarding@resend.dev>', client });
  const result = await mailer.send({ to: 'delivered@resend.dev', subject: 'Verify email', text: 'Use this code.' });
  assert.equal(result.id, 'email-test-id');
  assert.equal(request.from, 'RentiFlow <onboarding@resend.dev>');
  assert.deepEqual(request.to, ['delivered@resend.dev']);

  const unavailable = createResendMailer({ apiKey: 'test-key', from: 'test@example.test', client: { emails: { send: async () => ({ data: null, error: new Error('private provider detail') }) } } });
  await assert.rejects(unavailable.send({ to: 'tenant@example.test', subject: 'Test', text: 'Test' }), /delivery failed/);
  await assert.rejects(mailer.send({ to: 'tenant@example.test', subject: 'Test', text: 'Test' }), /test recipients/);
  await assert.rejects(createResendMailer({}).send({ to: 'tenant@example.test', subject: 'Test', text: 'Test' }), /not configured/);
});

test('Cloudinary adapter separates public media from private authenticated files', async () => {
  let uploadedOptions;
  let uploadedBytes = 0;
  let downloadOptions;
  const client = {
    uploader: {
      upload_stream(options, callback) {
        uploadedOptions = options;
        return new Writable({
          write(chunk, _encoding, done) { uploadedBytes += chunk.length; done(); },
          final(done) { callback(null, { asset_id: 'asset-123', public_id: 'rentiflow/property/photo', resource_type: options.resource_type, type: options.type, secure_url: 'https://res.cloudinary.com/demo/image/upload/photo.jpg', format: 'jpg', bytes: uploadedBytes }); done(); }
        });
      },
      async destroy(_publicId, options) { return { result: options.type === 'authenticated' ? 'ok' : 'not found' }; }
    },
    utils: {
      private_download_url(publicId, format, options) { downloadOptions = { publicId, format, options }; return 'https://download.example.test/private'; }
    }
  };
  const media = createCloudinaryMediaStore({ cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }, { client });
  const publicPhoto = await media.upload({ buffer: Buffer.from('fake-image'), folder: 'rentiflow/property', resourceType: 'image' });
  assert.equal(publicPhoto.access, 'public');
  assert.equal(uploadedOptions.type, 'upload');
  assert.equal(uploadedBytes, 10);

  const privateFile = await media.upload({ buffer: Buffer.from('fake-document'), folder: 'rentiflow/documents', resourceType: 'raw', access: 'private' });
  assert.equal(privateFile.access, 'private');
  assert.equal(privateFile.secureUrl, null);
  assert.equal(uploadedOptions.type, 'authenticated');
  assert.match(media.createPrivateDownloadUrl({ publicId: privateFile.publicId, format: 'pdf', resourceType: 'raw' }), /^https:/);
  assert.equal(downloadOptions.options.type, 'authenticated');
  assert.equal(await media.remove({ publicId: privateFile.publicId, resourceType: 'raw', access: 'private' }), true);
  await assert.rejects(media.upload({ buffer: Buffer.from('x'), folder: '../private' }), /folder is invalid/);
});

test('integration status reports missing environment keys without exposing values', () => {
  const status = getIntegrationStatus({
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'hidden-secret',
    MEDIA_STORAGE_PROVIDER: 'cloudinary', CLOUDINARY_CLOUD_NAME: 'demo'
  });
  assert.equal(status.email.configured, false);
  assert.deepEqual(status.email.missing, ['EMAIL_FROM']);
  assert.deepEqual(status.mediaStorage.missing, ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
  assert.equal(JSON.stringify(status).includes('hidden-secret'), false);
});
