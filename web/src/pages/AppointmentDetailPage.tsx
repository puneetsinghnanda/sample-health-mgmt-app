import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AppointmentDetail } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { SlotPicker } from '../components/SlotPicker';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { useSettings } from '../hooks/useSettings';
import { dateTime, todayIn } from '../lib/format';

const EVENT_LABEL: Record<string, string> = {
  BOOKED: 'Booked',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Marked completed',
  NO_SHOW: 'Marked no-show',
};

/** APT-5 reschedule, APT-6 cancel, APT-7 complete / no-show, APT-11 history. */
export function AppointmentDetailPage() {
  const { id = '' } = useParams();
  const { timeZone } = useSettings();
  const [version, setVersion] = useState(0);
  const loaded = useAsync(() => api.appointment(id), `${id}:${version}`);
  const [mode, setMode] = useState<'none' | 'reschedule' | 'cancel'>('none');
  const [error, setError] = useState<string>();

  async function act(work: () => Promise<AppointmentDetail>) {
    setError(undefined);
    try {
      await work();
      setMode('none');
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loaded.loading && !loaded.data) return <Loading />;
  if (loaded.error || !loaded.data) return <ErrorBanner message={loaded.error ?? 'Appointment not found'} />;
  const a = loaded.data;
  const scheduled = a.status === 'SCHEDULED';
  const started = Date.parse(a.startsAt) <= Date.now();

  return (
    <section>
      <div className="page-head">
        <h1>
          Appointment {a.code} <StatusBadge status={a.status} />
        </h1>
      </div>
      {error && <ErrorBanner message={error} />}
      <dl className="details">
        <dt>When</dt>
        <dd>{dateTime(a.startsAt, timeZone)} – {dateTime(a.endsAt, timeZone).split(', ').pop()}</dd>
        <dt>Doctor</dt>
        <dd><Link to={`/doctors/${a.doctor.id}`}>{a.doctor.fullName}</Link></dd>
        <dt>Patient</dt>
        <dd><Link to={`/patients/${a.patient.id}`}>{a.patient.fullName}</Link></dd>
        <dt>Reason for visit</dt>
        <dd>{a.reason ?? '—'}</dd>
        {a.cancellationReason && (
          <>
            <dt>Cancellation reason</dt>
            <dd>{a.cancellationReason}</dd>
          </>
        )}
      </dl>

      {scheduled ? (
        <div className="actions">
          <button type="button" onClick={() => setMode('reschedule')}>Reschedule</button>
          <button type="button" className="secondary" onClick={() => setMode('cancel')}>Cancel appointment</button>
          <button type="button" className="secondary" disabled={!started} title={started ? undefined : 'Available once the start time has passed'}
            onClick={() => void act(() => api.complete(a.id))}>Mark completed</button>
          <button type="button" className="secondary" disabled={!started} title={started ? undefined : 'Available once the start time has passed'}
            onClick={() => void act(() => api.noShow(a.id))}>Mark no-show</button>
        </div>
      ) : (
        <p className="muted">This appointment is closed and can no longer be changed.</p>
      )}

      {mode === 'reschedule' && <Reschedule appointment={a} onDone={(start) => void act(() => api.reschedule(a.id, start))} />}
      {mode === 'cancel' && <Cancel onDone={(reason) => void act(() => api.cancel(a.id, reason))} />}

      <h2>History</h2>
      <ol className="history">
        {a.history.map((e, i) => (
          <li key={i}>
            <strong>{EVENT_LABEL[e.event] ?? e.event}</strong> · {dateTime(e.at, timeZone)} by {e.actor}
            {e.event === 'RESCHEDULED' && e.fromStartsAt && e.toStartsAt && (
              <> · from {dateTime(e.fromStartsAt, timeZone)} to {dateTime(e.toStartsAt, timeZone)}</>
            )}
            {e.note && <> · {e.note}</>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Reschedule({ appointment, onDone }: { appointment: AppointmentDetail; onDone: (start: string) => void }) {
  const { timeZone } = useSettings();
  const [date, setDate] = useState(todayIn(timeZone, new Date(appointment.startsAt)));
  const [start, setStart] = useState<string>();
  const day = useAsync(() => api.schedule(appointment.doctor.id, date), date);
  return (
    <fieldset className="panel">
      <legend>Reschedule with {appointment.doctor.fullName}</legend>
      <label>
        Date <input type="date" value={date} min={todayIn(timeZone)} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      {day.data && <SlotPicker slots={day.data.slots} selected={start} onSelect={setStart} />}
      <button type="button" disabled={!start} onClick={() => start && onDone(start)}>Move to this slot</button>
    </fieldset>
  );
}

function Cancel({ onDone }: { onDone: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <fieldset className="panel">
      <legend>Cancel appointment</legend>
      <label>
        Reason (required) <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" className="danger" disabled={!reason.trim()} onClick={() => onDone(reason.trim())}>
        Cancel appointment
      </button>
    </fieldset>
  );
}
