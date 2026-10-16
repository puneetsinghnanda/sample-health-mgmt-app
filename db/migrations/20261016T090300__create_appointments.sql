-- Appointments and their history (PRD §4.3, APT-1..11).
CREATE TABLE appointment (
  id                   serial PRIMARY KEY,
  doctor_id            integer NOT NULL REFERENCES doctor (id),
  patient_id           integer NOT NULL REFERENCES patient (id),
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  reason               text CHECK (char_length(reason) <= 300),
  status               text NOT NULL DEFAULT 'SCHEDULED'
                         CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  cancellation_reason  text CHECK (char_length(cancellation_reason) <= 300),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  CHECK (starts_at < ends_at),
  CHECK ((status = 'CANCELLED') = (cancellation_reason IS NOT NULL)),
  -- APT-2/APT-4: a doctor never has two overlapping Scheduled appointments, even under concurrent booking.
  CONSTRAINT appointment_doctor_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'SCHEDULED'),
  -- APT-3: nor does a patient, with any doctors.
  CONSTRAINT appointment_patient_overlap EXCLUDE USING gist (
    patient_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'SCHEDULED')
);
CREATE INDEX appointment_doctor_start_idx ON appointment (doctor_id, starts_at);
CREATE INDEX appointment_patient_start_idx ON appointment (patient_id, starts_at);
CREATE INDEX appointment_start_idx ON appointment (starts_at);

-- APT-11: every change, with time and actor.
CREATE TABLE appointment_event (
  id               serial PRIMARY KEY,
  appointment_id   integer NOT NULL REFERENCES appointment (id),
  event            text NOT NULL CHECK (event IN ('BOOKED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  from_starts_at   timestamptz,
  to_starts_at     timestamptz,
  note             text,
  actor            text NOT NULL,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_event_appt_idx ON appointment_event (appointment_id, id);
