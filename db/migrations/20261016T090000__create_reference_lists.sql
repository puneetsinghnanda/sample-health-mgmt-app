-- Departments and specializations that staff maintain (PRD §4.5, REF-1..4).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE department (
  id          serial PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL
);
CREATE UNIQUE INDEX department_name_key ON department (lower(name));

CREATE TABLE specialization (
  id          serial PRIMARY KEY,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL
);
CREATE UNIQUE INDEX specialization_name_key ON specialization (lower(name));
