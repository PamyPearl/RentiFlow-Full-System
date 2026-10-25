ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS available_from DATE;

CREATE TABLE IF NOT EXISTS property_events (
  id UUID PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('listing_submitted', 'listing_updated', 'availability_changed', 'archived', 'moderation_decision')
  ),
  from_status TEXT,
  to_status TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS property_events_history_idx
  ON property_events (property_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS properties_availability_idx
  ON properties (status, is_available, available_from);
