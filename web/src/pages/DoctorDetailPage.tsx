import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { useSettings } from '../hooks/useSettings';
import { rupees, todayIn, weekdayName } from '../lib/format';

/** HMS-7: the appointment list filtered the way the No-shows count was counted (same as the dashboard tile). */
export function noShowsQuery(doctorId: number, window: { from: string; to: string }): string {
  return new URLSearchParams({ doctorId: String(doctorId), status: 'NO_SHOW', from: window.from, to: window.to }).toString();
}

/** HMS-9: a ?date= value is used only when it is a real calendar day in YYYY-MM-DD form. */
export function validDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** DOC-3 details, DOC-5 delete, DOC-7 flags, APT-10 day schedule, HMS-9 next 7 days. */
export function DoctorDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { timeZone } = useSettings();
  const [searchParams] = useSearchParams();
  const urlDate = validDay(searchParams.get('date'));
  const [date, setDate] = useState(() => urlDate ?? todayIn(timeZone));
  // HMS-9 REQ-8: following a Next 7 days link on the same page moves the day schedule to that date.
  useEffect(() => {
    if (urlDate) setDate(urlDate);
  }, [urlDate]);
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
        <dt>No-shows (last 30 days)</dt>
        <dd>
          <Link to={`/appointments?${noShowsQuery(d.id, d.noShowsWindow)}`}>{d.noShowsLast30Days}</Link>
        </dd>
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

      {d.nextSevenDays && (
        <>
          <h2>Next 7 days</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Booked</th>
                <th scope="col">Free</th>
              </tr>
            </thead>
            <tbody>
              {d.nextSevenDays.map((n) => (
                <tr key={n.date} className="next-day-row">
                  <td>
                    <Link to={`/doctors/${d.id}?date=${n.date}`}>{n.date}</Link>
                  </td>
                  {n.available ? (
                    <>
                      <td>{n.booked}</td>
                      <td>{n.free}</td>
                    </>
                  ) : (
                    <td colSpan={2} className="muted">Not available</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
