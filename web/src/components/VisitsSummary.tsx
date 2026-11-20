import { Link } from 'react-router-dom';
import type { PatientVisits } from '../api/types';
import { date, dateTime } from '../lib/format';

/** HMS-26: a No-show count of this many or more is highlighted as a warning. */
const NO_SHOW_WARNING = 2;

/** HMS-26: next appointment, last visit and closed counts. Takes only the visits, never the patient (PAT-8). */
export function VisitsSummary({ visits, timeZone }: { visits: PatientVisits; timeZone: string }) {
  const { next, last } = visits;
  return (
    <section aria-label="Visits">
      <h2>Visits</h2>
      <dl className="details">
        <dt>Next appointment</dt>
        <dd>
          {next ? (
            <>
              <Link to={`/appointments/${next.id}`}>{dateTime(next.starts_at, timeZone)}</Link> · {next.doctor_name}
            </>
          ) : 'None booked'}
        </dd>
        <dt>Last visit</dt>
        <dd>{last ? `${date(last.starts_at, timeZone)} · ${last.doctor_name}` : 'No visits yet'}</dd>
        <dt>Completed</dt>
        <dd>{visits.completed}</dd>
        <dt>Cancelled</dt>
        <dd>{visits.cancelled}</dd>
        <dt>No-show</dt>
        <dd>
          {visits.no_show >= NO_SHOW_WARNING
            ? <span className="badge badge-warning" role="status">{visits.no_show}</span>
            : visits.no_show}
        </dd>
      </dl>
    </section>
  );
}
