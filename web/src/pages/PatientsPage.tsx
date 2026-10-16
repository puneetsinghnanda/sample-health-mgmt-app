import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { GENDER_LABEL } from '../lib/format';

/** PAT-2: newest first, 20 per page; search name, code or phone. No medical history here (PAT-8). */
export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', page: params.get('page') ?? '1' };
  const list = useAsync(() => api.patients(filters), params.toString());
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <section>
      <div className="page-head">
        <h1>Patients</h1>
        <Link className="button" to="/patients/new">Register patient</Link>
      </div>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <input aria-label="Search by name, code or phone" placeholder="Search name, P-000001 or phone" defaultValue={filters.q}
          onChange={(e) => set('q', e.target.value)} />
        <select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </form>
      {list.error && <ErrorBanner message={list.error} />}
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Age</th>
                <th scope="col">Gender</th>
                <th scope="col">Phone</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td><Link to={`/patients/${p.id}`}>{p.fullName}</Link></td>
                  <td>{p.age}</td>
                  <td>{GENDER_LABEL[p.gender] ?? p.gender}</td>
                  <td>{p.phone}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.items.length === 0 && <p className="muted">No patients match.</p>}
          <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </section>
  );
}
