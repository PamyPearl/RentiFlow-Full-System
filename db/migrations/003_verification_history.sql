ALTER TABLE verification_submissions
  ADD COLUMN IF NOT EXISTS evidence_reference TEXT;

CREATE TABLE IF NOT EXISTS verification_events (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES verification_submissions(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('submitted', 'under_review', 'approved', 'rejected', 'needs_resubmission')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_events_submission_idx
  ON verification_events (submission_id, created_at ASC);
