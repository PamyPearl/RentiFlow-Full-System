import 'dotenv/config';
import { getIntegrationStatus } from '../src/integrations/status.js';

const status = getIntegrationStatus();
for (const [name, integration] of Object.entries(status)) {
  const state = integration.note ? 'simulation only' : integration.configured ? 'configured' : integration.enabled ? 'missing configuration' : 'disabled';
  const missing = integration.missing?.length ? ` (missing: ${integration.missing.join(', ')})` : '';
  console.log(`${name}: ${state}${missing}`);
}
