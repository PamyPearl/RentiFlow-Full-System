const reviewStatuses = new Set(['under_review', 'approved', 'rejected', 'needs_resubmission']);

export function validateVerificationSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Verification submission details are required');
  const evidenceReference = typeof input.evidenceReference === 'string' ? input.evidenceReference.trim() : '';
  if (evidenceReference.length < 3 || evidenceReference.length > 255) {
    throw new Error('A synthetic evidence reference between 3 and 255 characters is required');
  }
  return { evidenceReference };
}

export function validateVerificationReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Verification review is required');
  const status = typeof input.status === 'string' ? input.status : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reviewStatuses.has(status)) throw new Error('Review status is invalid');
  if ((status === 'rejected' || status === 'needs_resubmission') && (reason.length < 5 || reason.length > 1000)) {
    throw new Error('A review reason between 5 and 1,000 characters is required');
  }
  if (reason.length > 1000) throw new Error('Review reason must not exceed 1,000 characters');
  return { status, reason: reason || null };
}
