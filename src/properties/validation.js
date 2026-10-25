const propertyTypes = new Set(['apartment', 'house', 'room']);

export function validatePropertyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Property details are required');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  const propertyType = typeof input.propertyType === 'string' ? input.propertyType.toLowerCase() : '';
  const monthlyRentGhs = Number(input.monthlyRentGhs);
  const bedrooms = Number(input.bedrooms);
  const bathrooms = Number(input.bathrooms);
  const sizeSquareMetres = input.sizeSquareMetres === undefined || input.sizeSquareMetres === null || input.sizeSquareMetres === ''
    ? null
    : Number(input.sizeSquareMetres);
  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : null;

  if (title.length < 3 || title.length > 160) throw new Error('Title must be between 3 and 160 characters');
  if (description.length < 10 || description.length > 5000) throw new Error('Description must be between 10 and 5,000 characters');
  if (location.length < 2 || location.length > 160) throw new Error('Location must be between 2 and 160 characters');
  if (!propertyTypes.has(propertyType)) throw new Error('Property type must be apartment, house, or room');
  if (!Number.isFinite(monthlyRentGhs) || monthlyRentGhs <= 0) throw new Error('Monthly rent must be greater than zero');
  if (!Number.isInteger(bedrooms) || bedrooms < 1) throw new Error('Bedrooms must be a positive whole number');
  if (!Number.isInteger(bathrooms) || bathrooms < 1) throw new Error('Bathrooms must be a positive whole number');
  if (sizeSquareMetres !== null && (!Number.isFinite(sizeSquareMetres) || sizeSquareMetres <= 0)) throw new Error('Size must be greater than zero');
  if (imageUrl && !/^https:\/\/\S+$/i.test(imageUrl)) throw new Error('Image URL must use HTTPS');

  return { title, description, location, propertyType, monthlyRentGhs, bedrooms, bathrooms, sizeSquareMetres, imageUrl };
}

export function validateApplicationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Application details are required');
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < 20 || message.length > 2000) throw new Error('Application message must be between 20 and 2,000 characters');
  return { message };
}

export function validateApplicationDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Application decision is required');
  const status = typeof input.status === 'string' ? input.status : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!['under_review', 'information_requested', 'shortlisted', 'approved', 'rejected'].includes(status)) throw new Error('Application decision status is invalid');
  if (['rejected', 'information_requested'].includes(status) && (reason.length < 5 || reason.length > 1000)) throw new Error('A reason between 5 and 1,000 characters is required');
  if (reason.length > 1000) throw new Error('Decision reason must not exceed 1,000 characters');
  return { status, reason: reason || null };
}

const applicationTransitions = {
  submitted: new Set(['under_review', 'information_requested', 'shortlisted', 'approved', 'rejected']),
  under_review: new Set(['information_requested', 'shortlisted', 'approved', 'rejected']),
  information_requested: new Set(['under_review', 'withdrawn']),
  shortlisted: new Set(['information_requested', 'approved', 'rejected'])
};

export function canTransitionApplication(fromStatus, toStatus) {
  return Boolean(applicationTransitions[fromStatus]?.has(toStatus));
}

export function validateModerationDecision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Moderation decision is required');
  const status = typeof input.status === 'string' ? input.status : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!['published', 'rejected'].includes(status)) throw new Error('Moderation status must be published or rejected');
  if (status === 'rejected' && (reason.length < 5 || reason.length > 1000)) throw new Error('A rejection reason between 5 and 1,000 characters is required');
  return { status, reason: reason || null };
}

export function validateAvailabilityInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Availability details are required');
  if (typeof input.isAvailable !== 'boolean') throw new Error('Availability must be true or false');
  const availableFrom = input.availableFrom === undefined || input.availableFrom === null || input.availableFrom === ''
    ? null
    : String(input.availableFrom);
  if (availableFrom !== null) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(availableFrom) ? new Date(`${availableFrom}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== availableFrom) {
      throw new Error('Available-from date must be a valid YYYY-MM-DD date');
    }
  }
  return { isAvailable: input.isAvailable, availableFrom };
}
