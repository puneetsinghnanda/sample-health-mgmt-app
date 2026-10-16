import { useState } from 'react';
import { api } from '../api/client';
import type { RefEntry } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';

type Kind = 'departments' | 'specializations';

/** PRD §4.5: staff maintain departments and specializations (REF-1..4). */
export function SettingsPage() {
  return (
    <section>
      <h1>Departments &amp; specializations</h1>
      <div className="columns">
        <RefList kind="departments" title="Departments" />
        <RefList kind="specializations" title="Specializations" />
      </div>
    </section>
  );
}

function RefList({ kind, title }: { kind: Kind; title: string }) {
  const [version, setVersion] = useState(0);
  const list = useAsync(() => api.references(kind), `${kind}:${version}`);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  async function run(work: () => Promise<unknown>) {
    setError(undefined);
    try {
      await work();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const rename = (e: RefEntry) => {
    const next = window.prompt(`Rename ${e.name} to`, e.name);
    if (next && next.trim() !== e.name) void run(() => api.updateReference(kind, e.id, { name: next.trim() }));
  };

  return (
    <div>
      <h2>{title}</h2>
      {error && <ErrorBanner message={error} />}
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Doctors</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.doctorCount}</td>
              <td><StatusBadge status={e.status} /></td>
              <td className="row-actions">
                <button type="button" className="link" onClick={() => rename(e)}>Rename</button>
                <button type="button" className="link"
                  onClick={() => void run(() => api.updateReference(kind, e.id, { status: e.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }))}>
                  {e.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </button>
                {e.doctorCount === 0 && (
                  <button type="button" className="link" onClick={() => void run(() => api.deleteReference(kind, e.id))}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="inline" onSubmit={(ev) => { ev.preventDefault(); if (name.trim()) void run(async () => { await api.createReference(kind, name.trim()); setName(''); }); }}>
        <input aria-label={`New ${title.toLowerCase().replace(/s$/, '')} name`} value={name} maxLength={60} onChange={(ev) => setName(ev.target.value)} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
