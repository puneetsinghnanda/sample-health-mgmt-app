import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../api/client';
import type { OnDutyRow, Period } from '../api/types';
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
          <OnDutyToday rows={data.onDuty} />
          <h2>Next appointments</h2>
          <AppointmentTable items={data.next} />
        </>
      )}
    </section>
  );
}

/** HMS-23: doctors on duty today, sorted by the API. Ignores the Period selector; no contact details. */
function OnDutyToday({ rows }: { rows: OnDutyRow[] }) {
  return (
    <section aria-labelledby="on-duty-today">
      <h2 id="on-duty-today">On duty today</h2>
      {rows.length === 0 ? (
        <p>No doctors on duty today</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Doctor</th>
              <th>Department</th>
              <th>Booked</th>
              <th>Free</th>
              <th>Next free slot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doctorId}>
                <td>
                  <Link to={`/doctors/${r.doctorId}`}>{r.fullName}</Link>
                </td>
                <td>{r.department}</td>
                <td>{r.booked}</td>
                <td>{r.free}</td>
                <td>{r.free === 0 || !r.nextFreeLabel ? 'Fully booked' : r.nextFreeLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
