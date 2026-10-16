import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PatientDetail } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { Field } from '../components/Field';
import { ListInput } from '../components/ListInput';
import { Loading } from '../components/Loading';
import { useAsync } from '../hooks/useAsync';
import { GENDER_LABEL } from '../lib/format';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'];

interface Form {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  medicalNotes: string;
  status: string;
}

const EMPTY: Form = {
  fullName: '', dateOfBirth: '', gender: '', phone: '', email: '', address: '', emergencyName: '', emergencyPhone: '',
  bloodGroup: '', allergies: [], chronicConditions: [], currentMedications: [], medicalNotes: '', status: 'ACTIVE',
};

function fromPatient(p: PatientDetail): Form {
  return {
    fullName: p.fullName, dateOfBirth: p.dateOfBirth, gender: p.gender, phone: p.phone, email: p.email ?? '',
    address: p.address ?? '', emergencyName: p.emergencyContact.name ?? '', emergencyPhone: p.emergencyContact.phone ?? '',
    bloodGroup: p.medicalHistory.bloodGroup ?? '', allergies: p.medicalHistory.allergies,
    chronicConditions: p.medicalHistory.chronicConditions, currentMedications: p.medicalHistory.currentMedications,
    medicalNotes: p.medicalHistory.notes ?? '', status: p.status,
  };
}

/** PAT-1 (register, with the PAT-5 duplicate warning) and PAT-4 (edit). */
export function PatientFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;
  const existing = useAsync(() => (editing ? api.patient(id) : Promise.resolve(undefined)), id ?? 'new');
  const [form, setForm] = useState<Form>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [duplicate, setDuplicate] = useState<{ id: number; code: string }>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) setForm(fromPatient(existing.data));
  }, [existing.data]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function save(confirmDuplicate: boolean) {
    const body = {
      fullName: form.fullName, dateOfBirth: form.dateOfBirth, gender: form.gender, phone: form.phone, email: form.email,
      address: form.address, emergencyContact: { name: form.emergencyName, phone: form.emergencyPhone },
      bloodGroup: form.bloodGroup || null, allergies: form.allergies, chronicConditions: form.chronicConditions,
      currentMedications: form.currentMedications, medicalNotes: form.medicalNotes, status: form.status,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
    };
    setSaving(true);
    setError(undefined);
    setFields({});
    try {
      const patient = editing ? await api.updatePatient(Number(id), body) : await api.createPatient(body);
      navigate(`/patients/${patient.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details.reason === 'POSSIBLE_DUPLICATE') {
        setDuplicate(err.details.existing as { id: number; code: string });
      } else {
        if (err instanceof ApiError) setFields(err.fields);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setDuplicate(undefined);
    void save(false);
  }

  if (editing && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBanner message={existing.error} />;

  return (
    <section>
      <h1>{editing ? `Edit ${existing.data?.code ?? 'patient'}` : 'Register patient'}</h1>
      {error && <ErrorBanner message={error} />}
      {duplicate && (
        <div className="warning" role="alert">
          A patient with the same name, date of birth and phone already exists:{' '}
          <Link to={`/patients/${duplicate.id}`}>{duplicate.code}</Link>.{' '}
          <button type="button" onClick={() => void save(true)} disabled={saving}>Register anyway</button>
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Full name" required error={fields.fullName}>
          <input value={form.fullName} maxLength={100} onChange={(e) => set({ fullName: e.target.value })} />
        </Field>
        <Field label="Date of birth" required error={fields.dateOfBirth}>
          <input type="date" value={form.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} />
        </Field>
        <Field label="Gender" required error={fields.gender}>
          <select value={form.gender} onChange={(e) => set({ gender: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(GENDER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Phone" required error={fields.phone}>
          <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email" error={fields.email}>
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Address" error={fields.address}>
          <textarea value={form.address} maxLength={300} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Emergency contact name" error={fields.emergencyContact}>
          <input value={form.emergencyName} maxLength={100} onChange={(e) => set({ emergencyName: e.target.value })} />
        </Field>
        <Field label="Emergency contact phone">
          <input type="tel" value={form.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} />
        </Field>
        <h2>Medical history</h2>
        <Field label="Blood group" error={fields.bloodGroup}>
          <select value={form.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })}>
            <option value="">Not recorded</option>
            {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b === 'UNKNOWN' ? 'Unknown' : b}</option>)}
          </select>
        </Field>
        <ListInput label="Allergies" items={form.allergies} onChange={(allergies) => set({ allergies })} />
        <ListInput label="Chronic conditions" items={form.chronicConditions} onChange={(chronicConditions) => set({ chronicConditions })} />
        <ListInput label="Current medications" items={form.currentMedications} onChange={(currentMedications) => set({ currentMedications })} />
        <Field label="Medical notes" error={fields.medicalNotes}>
          <textarea value={form.medicalNotes} maxLength={2000} rows={4} onChange={(e) => set({ medicalNotes: e.target.value })} />
        </Field>
        {editing && (
          <Field label="Status" error={fields.status}>
            <select value={form.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
        )}
        <div className="actions">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
