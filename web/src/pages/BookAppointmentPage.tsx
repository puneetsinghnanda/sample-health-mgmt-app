import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { Field } from '../components/Field';
import { Picker } from '../components/Picker';
import { SlotPicker } from '../components/SlotPicker';
import { useAsync } from '../hooks/useAsync';
import { useSettings } from '../hooks/useSettings';
import { todayIn } from '../lib/format';

const numberOrUndefined = (v: string | null) => (v ? Number(v) : undefined);

/** APT-1: choose a doctor, a patient, a date and one of the free slots. */
export function BookAppointmentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { timeZone } = useSettings();
  const [doctorId, setDoctorId] = useState(numberOrUndefined(params.get('doctorId')));
  const [patientId, setPatientId] = useState(numberOrUndefined(params.get('patientId')));
  const [labels, setLabels] = useState({ doctor: '', patient: '' });
  const [date, setDate] = useState(params.get('date') ?? todayIn(timeZone));
  const [start, setStart] = useState<string | undefined>(params.get('start') ?? undefined);
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Labels for ids that arrive in the URL (from a doctor's or patient's page).
  useAsync(async () => {
    const [d, p] = await Promise.all([
      doctorId && !labels.doctor ? api.doctor(doctorId) : undefined,
      patientId && !labels.patient ? api.patient(patientId) : undefined,
    ]);
    setLabels((l) => ({
      doctor: l.doctor || (d ? `${d.fullName} (${d.code}) · ${d.specialization.name}` : ''),
      patient: l.patient || (p ? `${p.fullName} (${p.code})` : ''),
    }));
  }, `${doctorId}:${patientId}`);
  const day = useAsync(() => (doctorId ? api.schedule(doctorId, date) : Promise.resolve(undefined)), `${doctorId}:${date}`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!doctorId || !patientId || !start) {
      setFields({
        ...(doctorId ? {} : { doctorId: 'Choose a doctor' }),
        ...(patientId ? {} : { patientId: 'Choose a patient' }),
        ...(start ? {} : { startsAt: 'Choose a free slot' }),
      });
      return;
    }
    setSaving(true);
    setError(undefined);
    setFields({});
    try {
      const appt = await api.book({ doctorId, patientId, startsAt: start, reason });
      navigate(`/appointments/${appt.id}`);
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h1>Book appointment</h1>
      {error && <ErrorBanner message={error} />}
      <form className="form" onSubmit={submit} noValidate>
        <Picker
          label="Doctor"
          value={doctorId}
          selectedLabel={labels.doctor}
          error={fields.doctorId}
          search={async (q) =>
            (await api.doctors({ q, status: 'ACTIVE' })).items.map((d) => ({ id: d.id, label: `${d.fullName} (${d.code}) · ${d.specialization.name}` }))
          }
          onChange={(id, label) => {
            setDoctorId(id);
            setLabels((l) => ({ ...l, doctor: label }));
            setStart(undefined);
          }}
        />
        <Picker
          label="Patient"
          value={patientId}
          selectedLabel={labels.patient}
          error={fields.patientId}
          search={async (q) =>
            (await api.patients({ q, status: 'ACTIVE' })).items.map((p) => ({ id: p.id, label: `${p.fullName} (${p.code})` }))
          }
          onChange={(id, label) => {
            setPatientId(id);
            setLabels((l) => ({ ...l, patient: label }));
          }}
        />
        <Field label="Date" required>
          <input type="date" value={date} min={todayIn(timeZone)} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setStart(undefined); } }} />
        </Field>
        <fieldset>
          <legend>Time</legend>
          {!doctorId && <p className="muted">Choose a doctor to see free slots.</p>}
          {day.error && <ErrorBanner message={day.error} />}
          {day.data && <SlotPicker slots={day.data.slots} selected={start} onSelect={setStart} />}
          {fields.startsAt && <small className="field-error">{fields.startsAt}</small>}
        </fieldset>
        <Field label="Reason for visit" error={fields.reason}>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="actions">
          <button type="submit" disabled={saving}>{saving ? 'Booking…' : 'Book'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
