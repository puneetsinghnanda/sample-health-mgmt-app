import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AvailabilityBlock, DoctorDetail, RefEntry } from '../api/types';
import { AvailabilityEditor } from '../components/AvailabilityEditor';
import { ErrorBanner } from '../components/ErrorBanner';
import { Field } from '../components/Field';
import { Loading } from '../components/Loading';
import { useAsync } from '../hooks/useAsync';
import { toPaise } from '../lib/format';

const SLOT_MINUTES = [10, 15, 20, 30, 45, 60];

interface Form {
  fullName: string;
  specializationId: string;
  departmentId: string;
  phone: string;
  email: string;
  fee: string;
  slotMinutes: string;
  status: string;
  availability: AvailabilityBlock[];
}

const EMPTY: Form = {
  fullName: '', specializationId: '', departmentId: '', phone: '', email: '', fee: '', slotMinutes: '15', status: 'ACTIVE',
  availability: [],
};

function fromDoctor(d: DoctorDetail): Form {
  return {
    fullName: d.fullName, specializationId: String(d.specialization.id), departmentId: String(d.department.id), phone: d.phone,
    email: d.email ?? '', fee: (d.feePaise / 100).toFixed(2), slotMinutes: String(d.slotMinutes), status: d.status,
    availability: d.availability,
  };
}

/** DOC-1 (new) and DOC-4 (edit). Only Active departments and specializations can be newly chosen (REF-3). */
export function DoctorFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = id !== undefined;
  const refs = useAsync(() => Promise.all([api.references('departments'), api.references('specializations')]), 'refs');
  const existing = useAsync(() => (editing ? api.doctor(id) : Promise.resolve(undefined)), id ?? 'new');
  const [form, setForm] = useState<Form>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing.data) setForm(fromDoctor(existing.data));
  }, [existing.data]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const choices = (list: RefEntry[] | undefined, current: string) =>
    (list ?? []).filter((r) => r.status === 'ACTIVE' || String(r.id) === current);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const feePaise = toPaise(form.fee);
    if (feePaise === null) {
      setFields({ feePaise: 'must be an amount in rupees, e.g. 500 or 500.50' });
      return;
    }
    const body = {
      fullName: form.fullName, specializationId: Number(form.specializationId) || undefined,
      departmentId: Number(form.departmentId) || undefined, phone: form.phone, email: form.email, feePaise,
      slotMinutes: Number(form.slotMinutes), status: form.status,
    };
    setSaving(true);
    setError(undefined);
    setFields({});
    try {
      let doctor: DoctorDetail;
      if (editing) {
        await api.updateDoctor(Number(id), body);
        doctor = await api.setAvailability(Number(id), form.availability);
      } else {
        doctor = await api.createDoctor({ ...body, availability: form.availability });
      }
      navigate(`/doctors/${doctor.id}`);
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing && existing.loading) return <Loading />;
  if (existing.error) return <ErrorBanner message={existing.error} />;
  const [departments, specializations] = refs.data ?? [];

  return (
    <section>
      <h1>{editing ? `Edit ${existing.data?.code ?? 'doctor'}` : 'Add doctor'}</h1>
      {error && <ErrorBanner message={error} />}
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Full name" required error={fields.fullName}>
          <input value={form.fullName} maxLength={100} onChange={(e) => set({ fullName: e.target.value })} />
        </Field>
        <Field label="Specialization" required error={fields.specializationId}>
          <select value={form.specializationId} onChange={(e) => set({ specializationId: e.target.value })}>
            <option value="">Choose…</option>
            {choices(specializations, form.specializationId).map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.status === 'INACTIVE' ? ' (Inactive)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Department" required error={fields.departmentId}>
          <select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">Choose…</option>
            {choices(departments, form.departmentId).map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.status === 'INACTIVE' ? ' (Inactive)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Phone" required error={fields.phone}>
          <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Email" error={fields.email}>
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Consultation fee (₹)" required error={fields.feePaise}>
          <input inputMode="decimal" value={form.fee} onChange={(e) => set({ fee: e.target.value })} />
        </Field>
        <Field label="Slot length (minutes)" error={fields.slotMinutes}>
          <select value={form.slotMinutes} onChange={(e) => set({ slotMinutes: e.target.value })}>
            {SLOT_MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Status" error={fields.status}>
          <select value={form.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
        <AvailabilityEditor blocks={form.availability} onChange={(availability) => set({ availability })} error={fields.availability} />
        <div className="actions">
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
