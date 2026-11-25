-- HMS-34: appointments still Scheduled 24h after their start time become Stale.
-- The original CHECKs are unnamed, so they are dropped by the Postgres default names.
ALTER TABLE appointment DROP CONSTRAINT appointment_status_check;
ALTER TABLE appointment ADD CONSTRAINT appointment_status_check
  CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'STALE'));

ALTER TABLE appointment_event DROP CONSTRAINT appointment_event_event_check;
ALTER TABLE appointment_event ADD CONSTRAINT appointment_event_event_check
  CHECK (event IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'STALE'));
