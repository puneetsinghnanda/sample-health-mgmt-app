import { Link } from 'react-router-dom';
import type { VisitSummary as Summary } from '../api/types';
import { localDate } from '../lib/format';

interface Props {
  summary: Summary;
  /** False when the patient has no appointments at all. */
  hasAppointments: boolean;
}

/** HMS-24: visit counts and the last Completed visit, shown above the patient's Appointments table. */
export function VisitSummary({ summary, hasAppointments }: Props) {
  if (!hasAppointments) {
    return (
      <div className="visit-summary" aria-label="Visit summary">
        <p className="muted">No visits yet</p>
      </div>
    );
  }
  const { completed, noShow, cancelled, upcoming, lastVisit } = summary;
  return (
    <div className="visit-summary" aria-label="Visit summary">
      <p>{`${completed} completed · ${noShow} no-show · ${cancelled} cancelled · ${upcoming} upcoming`}</p>
      <p>
        Last visit:{' '}
        {lastVisit ? (
          <>
            <Link to={`/appointments/${lastVisit.appointmentId}`}>{localDate(lastVisit.date)}</Link>, {lastVisit.doctorName}
          </>
        ) : (
          'none yet'
        )}
      </p>
    </div>
  );
}
