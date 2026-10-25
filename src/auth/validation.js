const roles = new Set(['tenant', 'landlord']);

export function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Registration details are required');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
  const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
  const role = typeof input.role === 'string' ? input.role : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (firstName.length < 2 || firstName.length > 80) throw new Error('First name must be between 2 and 80 characters');
  if (lastName.length < 2 || lastName.length > 80) throw new Error('Last name must be between 2 and 80 characters');
  if (!roles.has(role)) throw new Error('Role must be tenant or landlord');

  return { email, password, firstName, lastName, role };
}

export function validateLogin(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Email and password are required');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !password) throw new Error('Email and password are required');
  return { email, password };
}
