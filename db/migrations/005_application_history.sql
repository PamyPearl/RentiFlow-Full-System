ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check CHECK (
    status IN ('submitted', 'under_review', 'information_requested', 'shortlisted', 'approved', 'rejected', 'withdrawn')
  );

CREATE TABLE IF NOT EXISTS application_events (
  id UUID PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  from_status TEXT CHECK (
    from_status IS NULL OR from_status IN ('submitted', 'under_review', 'information_requested', 'shortlisted', 'approved', 'rejected', 'withdrawn')
  ),
  to_status TEXT NOT NULL CHECK (
    to_status IN ('submitted', 'under_review', 'information_requested', 'shortlisted', 'approved', 'rejected', 'withdrawn')
  ),
  reason TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_events_history_idx
  ON application_events (application_id, created_at ASC, id ASC);
