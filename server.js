import express from 'express';
import 'dotenv/config';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import authRouter from './src/routes/auth.js';
import propertiesRouter from './src/routes/properties.js';
import verificationRouter from './src/routes/verification.js';
import auditRouter from './src/routes/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET || '').length < 32) {
  throw new Error('Production JWT_SECRET must contain at least 32 characters');
}

app.disable('x-powered-by');
app.use((request, response, next) => {
  const suppliedRequestId = request.get('x-request-id') || '';
  const requestId = /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
  request.id = requestId;
  response.setHeader('X-Request-Id', requestId);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/properties', propertiesRouter);
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/admin/audit-events', auditRouter);

app.get('/api/v1/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'rentiflow',
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DATABASE_URL ? 'configured' : 'not_configured'
  });
});

// Keep the multi-page entry points explicit so every portal is reachable even
// when a hosting layer does not apply Express's directory-index behavior.
const htmlPages = new Set([
  'index.html', 'properties.html', 'property.html', 'login.html',
  'tenant.html', 'landlord.html', 'admin.html'
]);
app.get('/:page.html', (request, response, next) => {
  const filename = `${request.params.page}.html`;
  if (!htmlPages.has(filename)) return next();
  return response.sendFile(path.join(__dirname, 'public', filename));
});

app.get('*splat', (_request, response) => {
  response.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _request, response, _next) => {
  console.error(JSON.stringify({ requestId: _request.id, error: error.name || 'Error', code: error.code || 'INTERNAL_ERROR' }));
  response.status(500).json({ error: 'Internal server error' });
});

export { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`RentiFlow listening on http://localhost:${port}`);
  });
}
