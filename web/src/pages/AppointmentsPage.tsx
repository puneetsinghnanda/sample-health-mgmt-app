import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { Pagination } from '../components/Pagination';
import { Picker } from '../components/Picker';
import { useAsync } from '../hooks/useAsync';
import { STATUS_LABEL } from '../lib/format';

const FILTER_KEYS = ['doctorId', 'patientId', 'status', 'from', 'to'] as const;

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

  // HMS-8: the doctor filter is shown by name and can be changed or cleared on its own.
  const doctorId = filters.doctorId ? Number(filters.doctorId) : undefined;
  const [picked, setPicked] = useState<{ id: number; label: string }>();
  const doctor = useAsync(
    () => (doctorId && picked?.id !== doctorId ? api.doctor(doctorId) : Promise.resolve(undefined)),
    filters.doctorId ?? '',
  );
  const doctorLabel =
    picked && picked.id === doctorId
      ? picked.label
      : doctor.data
        ? `${doctor.data.fullName} (${doctor.data.code}) · ${doctor.data.specialization.name}`
        : '';
  const anyFilter = FILTER_KEYS.some((k) => filters[k]);

  return (
    <section>
      <div className="page-head">
        <h1>Appointments</h1>
        <Link className="button" to="/appointments/new">Book appointment</Link>
      </div>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <Picker
          label="Doctor"
          value={doctorId}
          selectedLabel={doctorLabel}
          search={async (q) =>
            (await api.doctors({ q })).items.map((d) => ({ id: d.id, label: `${d.fullName} (${d.code}) · ${d.specialization.name}` }))
          }
          onChange={(id, label) => {
            setPicked(id === undefined ? undefined : { id, label });
            set('doctorId', id === undefined ? '' : String(id));
          }}
        />
        <select aria-label="Status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="NOT_CANCELLED">Any except Cancelled</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label>From <input type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label>To <input type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        {anyFilter && (
          <button type="button" className="link" onClick={() => setParams(new URLSearchParams())}>
            Clear All
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
