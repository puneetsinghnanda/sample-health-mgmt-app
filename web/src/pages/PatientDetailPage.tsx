import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AppointmentTable } from '../components/AppointmentTable';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { GENDER_LABEL } from '../lib/format';

const list = (items: string[]) => (items.length ? items.join(', ') : 'None recorded');

/** PAT-3: details, medical history (shown only here, PAT-8) and appointments. */
export function PatientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const patient = useAsync(() => api.patient(id), id);

  async function remove() {
    if (!window.confirm('Delete this patient? This cannot be undone.')) return;
    try {
      await api.deletePatient(Number(id));
      navigate('/patients');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (patient.loading && !patient.data) return <Loading />;
  if (patient.error || !patient.data) return <ErrorBanner message={patient.error ?? 'Patient not found'} />;
  const p = patient.data;
  const h = p.medicalHistory;

  return (
    <section>
      <div className="page-head">
        <h1>
          {p.fullName} <small className="muted">{p.code}</small> <StatusBadge status={p.status} />
        </h1>
        <div className="actions">
          {p.status === 'ACTIVE' && <Link className="button" to={`/appointments/new?patientId=${p.id}`}>Book appointment</Link>}
          <Link className="button secondary" to={`/patients/${p.id}/edit`}>Edit</Link>
          {p.appointments.length === 0 && <button type="button" className="danger" onClick={remove}>Delete</button>}
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <dl className="details">
        <dt>Date of birth</dt>
        <dd>{p.dateOfBirth} ({p.age} years)</dd>
        <dt>Gender</dt>
        <dd>{GENDER_LABEL[p.gender] ?? p.gender}</dd>
        <dt>Phone</dt>
        <dd>{p.phone}</dd>
        <dt>Email</dt>
        <dd>{p.email ?? '—'}</dd>
        <dt>Address</dt>
        <dd>{p.address ?? '—'}</dd>
        <dt>Emergency contact</dt>
        <dd>{[p.emergencyContact.name, p.emergencyContact.phone].filter(Boolean).join(', ') || '—'}</dd>
      </dl>
      <h2>Medical history</h2>
      <dl className="details" aria-label="Medical history">
        <dt>Blood group</dt>
        <dd>{h.bloodGroup === 'UNKNOWN' ? 'Unknown' : (h.bloodGroup ?? 'Not recorded')}</dd>
        <dt>Allergies</dt>
        <dd>{list(h.allergies)}</dd>
        <dt>Chronic conditions</dt>
        <dd>{list(h.chronicConditions)}</dd>
        <dt>Current medications</dt>
        <dd>{list(h.currentMedications)}</dd>
        <dt>Notes</dt>
        <dd className="prewrap">{h.notes ?? '—'}</dd>
      </dl>
      <h2>Visit summary</h2>
      <dl className="details" aria-label="Visit summary">
        <dt>Completed</dt>
        <dd>{p.visit_summary.completed}</dd>
        <dt>No-show</dt>
        <dd>{p.visit_summary.no_show}</dd>
      </dl>
      <h2>Appointments</h2>
      <AppointmentTable items={p.appointments} hide="patient" />
    </section>
  );
}
