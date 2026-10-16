-- Doctors and their weekly availability (PRD §4.1, DOC-1..7).
CREATE TABLE doctor (
  id                 serial PRIMARY KEY,
  full_name          text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  specialization_id  integer NOT NULL REFERENCES specialization (id),
  department_id      integer NOT NULL REFERENCES department (id),
  phone              text NOT NULL,
  email              text,
  fee_paise          integer NOT NULL CHECK (fee_paise >= 0),
  slot_minutes       integer NOT NULL DEFAULT 15 CHECK (slot_minutes IN (10, 15, 20, 30, 45, 60)),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text NOT NULL
);
CREATE INDEX doctor_name_idx ON doctor (lower(full_name));
CREATE INDEX doctor_department_idx ON doctor (department_id);
CREATE INDEX doctor_specialization_idx ON doctor (specialization_id);

-- Weekly blocks in the hospital's local wall-clock time. weekday: 1 = Monday .. 7 = Sunday.
CREATE TABLE availability_block (
  id          serial PRIMARY KEY,
  doctor_id   integer NOT NULL REFERENCES doctor (id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (start_time < end_time),
  -- Blocks of one doctor on one weekday never overlap.
  CONSTRAINT availability_block_no_overlap EXCLUDE USING gist (
    doctor_id WITH =,
    weekday WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&
  )
);
