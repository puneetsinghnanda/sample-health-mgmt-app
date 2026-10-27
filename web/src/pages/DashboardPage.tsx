import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../api/client';
import type { Period } from '../api/types';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { useAsync } from '../hooks/useAsync';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/** PRD §4.4. Every tile links to the list it counts (DSH-8). */
export function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today');
  const { data, error, loading } = useAsync(() => api.dashboard(period), period);

  return (
    <section>
      <div className="page-head">
        <h1>Dashboard</h1>
        <label>
          Period{' '}
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="tiles">
            <Tile label="Total patients" value={data.totals.patients} to="/patients?status=ACTIVE" />
            <Tile label="Total doctors" value={data.totals.doctors} to="/doctors?status=ACTIVE" />
            <Tile label="Appointments today" value={data.totals.appointmentsToday} to={`/appointments${query({ from: data.today, to: data.today })}`} />
            <Tile label="Upcoming appointments" value={data.totals.upcoming} to={`/appointments${query({ status: 'SCHEDULED', from: data.today })}`} />
            <Tile
              label={`Completed (${PERIODS.find((p) => p.value === period)?.label})`}
              value={data.totals.completed}
              to={`/appointments${query({ status: 'COMPLETED', from: data.period.from, to: data.period.to })}`}
            />
            <Tile
              label={`Cancelled (${PERIODS.find((p) => p.value === period)?.label})`}
              value={data.totals.cancelled}
              to={`/appointments${query({ status: 'CANCELLED', from: data.period.from, to: data.period.to })}`}
            />
            <Tile
              label="No-shows"
              value={data.totals.noShows}
              to={`/appointments${query({ status: 'NO_SHOW', from: data.period.from, to: data.period.to })}`}
            />
          </div>
          <h2>Next appointments</h2>
          <AppointmentTable items={data.next} />
        </>
      )}
    </section>
  );
}

function Tile({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link className="tile" to={to}>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </Link>
  );
}
