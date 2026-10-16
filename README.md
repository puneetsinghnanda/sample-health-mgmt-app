# Hospital Management System (MVP)

A small hospital front desk: doctors, patients, appointments and a dashboard. It is also the shared product that
the team extends with AI Skill Library workflows. Requirements are in [docs/PRD.md](docs/PRD.md).

**Invented data only.** No real patients, doctors or contact details, anywhere: not in seed data, tests, tickets or
screenshots.

## Stack and layout

Node.js 22, TypeScript, Express API, React 18 web app (Vite), PostgreSQL 16, Vitest. One npm workspace per part:

```
api/   Express API. routes -> services -> repositories
  src/auth/identity.ts   identity + permissions; sign-in plugs in here later (PRD §4.6)
  src/lib/               time zone, slots, validation, error helpers
  test/                  API tests, named by PRD requirement ID (DOC-1, APT-4, ...)
web/   React web app (pages, components, API client)
db/    SQL migrations, migration runner, synthetic seed, throwaway PostgreSQL test harness
  migrations/            one file per change: YYYYMMDDTHHMMSS__what.sql (UTC timestamp)
render.yaml              the shared test environment on Render
```

## How the team works

```
engineers --AI Skill Library runs--> tsl/<ticket> branches --draft PRs--> main
                                                                   | auto-deploy: migrate, seed if empty, start
own Neon database branch (dev) <-- reset from main --+             v
                                                     +-- Neon "hms" main <-- Render "hms-test" (shared URL)
```

1. **One ticket per person.** Start a workflow from the companion repo
   (`/truminds:run brownfield-change <ticket> <ticket-file>`). Two people on one ticket block each other.
2. **Changes arrive as pull requests.** A reviewer merges into `main`. Merging is the only way code reaches the
   shared environment.
3. **The shared environment** redeploys after every merge. Everyone tests the integrated result at the same URL.
4. **Your own database.** Each engineer has a Neon database branch for local runs. Break it freely and reset it
   from `main` in the Neon console when you want fresh data. Never point local runs at the `main` branch.
5. **Migrations** are new files only, never edits to merged ones. Name them with the current UTC time,
   e.g. `db/migrations/20261020T143000__add_lab_results.sql`, so parallel work never collides. Every deploy applies
   the new ones in name order.
6. **Every requirement has a test that names its ID** (PRD NFR-4). New requirements get new IDs and tests.

## Run locally

Needs Node.js 22. Create `.env` from [.env.example](.env.example) with your own Neon branch's connection string
(direct, not "-pooler"), then in PowerShell:

```powershell
npm ci
Get-Content .env | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
npm run db:migrate            # apply new migrations to your branch
npm run db:seed               # seeds only an empty database; `npm run db:seed -- --reset` wipes YOUR branch first
npm run dev -w api            # API on http://127.0.0.1:3000
npm run dev -w web            # web app on http://127.0.0.1:5174 (proxies /api to the API), in a second window
```

## Test

```powershell
npm run lint; npm run typecheck; npm test
```

Database tests start a throwaway PostgreSQL 16 from local binaries (`PG_BIN`, default
`/usr/lib/postgresql/16/bin`) or use `HMS_TEST_DATABASE_URL` (an admin URL of a local server). Without either they
are skipped with a warning, so on a laptop without PostgreSQL only the non-database tests run. Tests never touch
Neon. CI (`.github/workflows/ci.yml`) runs everything against a PostgreSQL 16 service on every pull request.

## Shared test environment

Defined in [render.yaml](render.yaml): one free Render web service (`hms-test`) built from `main`, serving the API
and the web app from the same origin, with `DATABASE_URL` set to the `main` branch of the Neon project `hms`.
On each deploy it runs `npm run db:migrate`, then `npm run db:seed` (which does nothing once data exists), then
starts. The free service sleeps when idle; the first request after a pause takes up to a minute.

The URL is open to anyone who has it until sign-in is added (PRD AUTH-5). It holds invented data only.

## API

JSON under `/api`; see PRD §6. Lists return `{ items, page, page_size, total }`. Errors return
`{ error: { code, message, fields? } }`: `400` invalid input (one message per field), `404` unknown id,
`409` conflict (slot taken, appointment closed, record in use). `GET /api/health` reports database status;
`GET /api/settings` gives the hospital time zone and currency.
