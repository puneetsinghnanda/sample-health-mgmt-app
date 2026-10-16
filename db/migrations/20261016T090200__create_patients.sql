-- Patients and their basic medical history (PRD §4.2, PAT-1..8).
CREATE TABLE patient (
  id                       serial PRIMARY KEY,
  full_name                text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  date_of_birth            date NOT NULL,
  gender                   text NOT NULL CHECK (gender IN ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')),
  phone                    text NOT NULL,
  email                    text,
  address                  text CHECK (char_length(address) <= 300),
  emergency_contact_name   text,
  emergency_contact_phone  text,
  blood_group              text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN')),
  allergies                text[] NOT NULL DEFAULT '{}',
  chronic_conditions       text[] NOT NULL DEFAULT '{}',
  current_medications      text[] NOT NULL DEFAULT '{}',
  medical_notes            text CHECK (char_length(medical_notes) <= 2000),
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text NOT NULL
);
CREATE INDEX patient_name_idx ON patient (lower(full_name));
CREATE INDEX patient_phone_idx ON patient (phone);
CREATE INDEX patient_created_idx ON patient (created_at DESC, id DESC);
