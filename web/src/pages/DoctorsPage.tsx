import { Link, useSearchParams } from 'react-router-dom';
import { api, query } from '../api/client';
import { ErrorBanner } from '../components/ErrorBanner';
import { Loading } from '../components/Loading';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { useAsync } from '../hooks/useAsync';
import { useSettings } from '../hooks/useSettings';
import { rupees, todayIn } from '../lib/format';

/**
 * DOC-2: 20 per page by name; filter by department, specialization and status; search name or code.
 * HMS-6: "Today" counts each doctor's appointments today and links to them.
 */
export function DoctorsPage() {
  const [params, setParams] = useSearchParams();
  const { timeZone } = useSettings();
  const today = todayIn(timeZone);
  const filters = {
    q: params.get('q') ?? '',
    departmentId: params.get('departmentId') ?? '',
    specializationId: params.get('specializationId') ?? '',
    status: params.get('status') ?? '',
    page: params.get('page') ?? '1',
  };
  const list = useAsync(() => api.doctorsWithToday(filters), params.toString());
  const refs = useAsync(() => Promise.all([api.references('departments'), api.references('specializations')]), 'refs');
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
        <h1>Doctors</h1>
        <Link className="button" to="/doctors/new">
          Add doctor
        </Link>
      </div>
      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <input aria-label="Search by name or code" placeholder="Search name or D-0001" defaultValue={filters.q}
          onChange={(e) => set('q', e.target.value)} />
        <select aria-label="Department" value={filters.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
          <option value="">All departments</option>
          {refs.data?.[0].map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select aria-label="Specialization" value={filters.specializationId} onChange={(e) => set('specializationId', e.target.value)}>
          <option value="">All specializations</option>
          {refs.data?.[1].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
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
                <th scope="col">Specialization</th>
                <th scope="col">Department</th>
                <th scope="col">Fee</th>
                <th scope="col">Status</th>
                <th scope="col">Today</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td>{d.code}</td>
                  <td><Link to={`/doctors/${d.id}`}>{d.fullName}</Link></td>
                  <td>{d.specialization.name}</td>
                  <td>{d.department.name}</td>
                  <td>{rupees(d.feePaise)}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td><Link to={`/appointments${query({ doctorId: d.id, from: today, to: today })}`}>{d.today_count}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.items.length === 0 && <p className="muted">No doctors match.</p>}
          <Pagination page={list.data.page} pageSize={list.data.page_size} total={list.data.total} onPage={(p) => set('page', String(p))} />
        </>
      )}
    </section>
  );
}
