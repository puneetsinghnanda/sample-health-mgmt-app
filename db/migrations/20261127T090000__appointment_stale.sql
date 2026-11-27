-- HMS-34: a Scheduled appointment still open 24h after its start time becomes STALE.
-- STALE stays open (it can still be completed, marked no-show, cancelled or rescheduled),
-- so the overlap constraints keep covering SCHEDULED rows only.
ALTER TABLE appointment DROP CONSTRAINT appointment_status_check;
ALTER TABLE appointment ADD CONSTRAINT appointment_status_check
  CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'STALE'));

ALTER TABLE appointment_event DROP CONSTRAINT appointment_event_event_check;
ALTER TABLE appointment_event ADD CONSTRAINT appointment_event_event_check
  CHECK (event IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'STALE'));
