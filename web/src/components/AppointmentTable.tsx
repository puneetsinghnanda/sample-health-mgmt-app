import { Link } from 'react-router-dom';
import type { AppointmentSummary } from '../api/types';
import { useSettings } from '../hooks/useSettings';
import { dateTime } from '../lib/format';
import { StatusBadge } from './StatusBadge';

interface Props {
  items: AppointmentSummary[];
  hide?: 'doctor' | 'patient';
  flagged?: number[];
}

export function AppointmentTable({ items, hide, flagged = [] }: Props) {
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
