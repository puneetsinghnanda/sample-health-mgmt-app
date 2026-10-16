import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { useSettings } from '../hooks/useSettings';
import { rupees, todayIn, weekdayName } from '../lib/format';

/** DOC-3 details, DOC-5 delete, DOC-7 flags, APT-10 day schedule. */
export function DoctorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { timeZone } = useSettings();
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [error, setError] = useState<string>();
  const doctor = useAsync(() => api.doctor(id), id);
  const day = useAsync(() => api.schedule(id, date), `${id}:${date}`);

  async function remove() {
    if (!window.confirm('Delete this doctor? This cannot be undone.')) return;
    try {
      await api.deleteDoctor(Number(id));
      navigate('/doctors');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (doctor.loading && !doctor.data) return <Loading />;
  if (doctor.error || !doctor.data) return <ErrorBanner message={doctor.error ?? 'Doctor not found'} />;
  const d = doctor.data;

  return (
    <section>
      <div className="page-head">
        <h1>
          {d.fullName} <small className="muted">{d.code}</small> <StatusBadge status={d.status} />
        </h1>
        <div className="actions">
          {d.status === 'ACTIVE' && <Link className="button" to={`/appointments/new?doctorId=${d.id}`}>Book appointment</Link>}
          <Link className="button secondary" to={`/doctors/${d.id}/edit`}>Edit</Link>
          {d.appointmentCount === 0 && <button type="button" className="danger" onClick={remove}>Delete</button>}
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {d.appointmentCount > 0 && d.status === 'ACTIVE' && (
        <p className="muted">This doctor has appointments, so they can be set Inactive (Edit) but not deleted.</p>
      )}
      <dl className="details">
        <dt>Specialization</dt>
        <dd>{d.specialization.name}{d.specialization.status === 'INACTIVE' && ' (Inactive)'}</dd>
        <dt>Department</dt>
        <dd>{d.department.name}{d.department.status === 'INACTIVE' && ' (Inactive)'}</dd>
        <dt>Phone</dt>
        <dd>{d.phone}</dd>
        <dt>Email</dt>
        <dd>{d.email ?? '—'}</dd>
        <dt>Consultation fee</dt>
        <dd>{rupees(d.feePaise)}</dd>
        <dt>Slot length</dt>
        <dd>{d.slotMinutes} minutes</dd>
      </dl>

      <h2>Weekly availability</h2>
      {d.availability.length === 0 ? (
        <p className="muted">No availability set.</p>
      ) : (
        <ul>
          {d.availability.map((b, i) => (
            <li key={i}>{weekdayName(b.weekday)}: {b.start}–{b.end}</li>
          ))}
        </ul>
      )}

      <h2>Upcoming appointments</h2>
      {d.outsideAvailability.length > 0 && (
        <p className="warning" role="status">
          {d.outsideAvailability.length} appointment(s) fall outside the current availability. Reschedule or cancel them.
        </p>
      )}
      {d.status === 'INACTIVE' && d.upcoming.length > 0 && (
        <p className="warning" role="status">This doctor is Inactive. Reschedule or cancel these appointments.</p>
      )}
      <AppointmentTable
        items={d.upcoming.filter((a, i) => i < 10 || d.outsideAvailability.includes(a.id))}
        hide="doctor"
        flagged={d.outsideAvailability}
      />
      {d.upcoming.length > 10 && (
        <p>
          <Link to={`/appointments?doctorId=${d.id}&status=SCHEDULED&from=${todayIn(timeZone)}`}>All upcoming appointments</Link>
        </p>
      )}

      <h2>Day schedule</h2>
      <label>
        Date <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      {day.error && <ErrorBanner message={day.error} />}
      {day.data && (
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Slot</th>
            </tr>
          </thead>
          <tbody>
            {day.data.slots.map((s) => (
              <tr key={s.start} className={`slot-row slot-${s.state.toLowerCase()}`}>
                <td>{s.label}</td>
                <td>
                  {s.appointment ? (
                    <Link to={`/appointments/${s.appointment.id}`}>
                      {s.appointment.patient.fullName} ({s.appointment.code})
                    </Link>
                  ) : s.state === 'FREE' ? (
                    <Link to={`/appointments/new?doctorId=${d.id}&date=${date}&start=${encodeURIComponent(s.start)}`}>Free: book</Link>
                  ) : (
                    <span className="muted">Past</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {day.data && day.data.slots.length === 0 && <p className="muted">No availability on this day.</p>}
    </section>
  );
}
