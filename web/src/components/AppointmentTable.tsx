import { Link } from 'react-router-dom';
import type { AppointmentSummary } from '../api/types';
import { useSettings } from '../hooks/useSettings';
import { dateTime } from '../lib/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  items: Array<AppointmentSummary & { cancellationReason?: string | null }>;
  hide?: 'doctor' | 'patient';
  flagged?: number[];
  /** HMS-33: adds the Cancellation reason column after Status; only the appointment list sets it. */
  showCancellationReason?: boolean;
}

const REASON_MAX = 60;

/** HMS-33: a Cancelled appointment's reason, shortened past 60 characters; "-" otherwise. */
function reasonCell(a: AppointmentSummary & { cancellationReason?: string | null }): string {
  if (a.status !== 'CANCELLED' || !a.cancellationReason) return '-';
  const chars = Array.from(a.cancellationReason);
  return chars.length > REASON_MAX ? `${chars.slice(0, REASON_MAX).join('')}…` : a.cancellationReason;
}

export function AppointmentTable({ items, hide, flagged = [], showCancellationReason = false }: Props) {
  const { timeZone } = useSettings();
  if (items.length === 0) return <p className="muted">No appointments.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Appointment</th>
          <th scope="col">When</th>
          {hide !== 'doctor' && <th scope="col">Doctor</th>}
          {hide !== 'patient' && <th scope="col">Patient</th>}
          <th scope="col">Status</th>
          {showCancellationReason && <th scope="col">Cancellation reason</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <tr key={a.id} className={flagged.includes(a.id) ? 'flagged' : undefined}>
            <td>
              <Link to={`/appointments/${a.id}`}>{a.code}</Link>
              {flagged.includes(a.id) && <span className="badge badge-warning">Outside availability</span>}
            </td>
            <td>{dateTime(a.startsAt, timeZone)}</td>
            {hide !== 'doctor' && (
              <td>
                <Link to={`/doctors/${a.doctor.id}`}>{a.doctor.fullName}</Link>
              </td>
            )}
            {hide !== 'patient' && (
              <td>
                <Link to={`/patients/${a.patient.id}`}>{a.patient.fullName}</Link>
              </td>
            )}
            <td>
              <StatusBadge status={a.status} />
            </td>
            {showCancellationReason && <td>{reasonCell(a)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
