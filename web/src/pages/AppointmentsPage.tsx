import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../hooks/useAsync';
import { STATUS_LABEL } from '../lib/format';

/** APT-9: appointments for a doctor or patient, by date range and status, ordered by start. */
export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(
    ['doctorId', 'patientId', 'status', 'from', 'to', 'page'].map((k) => [k, params.get(k) ?? undefined]),
  );
  const list = useAsync(() => api.appointments(filters), params.toString());
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <section>
      <div className="page-head">
        <h1>Appointments</h1>
        <Link className="button" to="/appointments/new">Book appointment</Link>
      </div>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <select aria-label="Status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label>From <input type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label>To <input type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        {(filters.doctorId || filters.patientId) && (
          <button type="button" className="link" onClick={() => setParams(new URLSearchParams())}>
            Clear doctor / patient filter
          </button>
        )}
      </form>
      {list.error && <ErrorBanner message={list.error} />}
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <>
          <p className="muted">{list.data.total} appointment(s)</p>
          <AppointmentTable items={list.data.items} />
          <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </section>
  );
}
