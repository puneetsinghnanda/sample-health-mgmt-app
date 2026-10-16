import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';

interface Option {
  id: number;
  label: string;
}

interface Props {
  label: string;
  value: number | undefined;
  selectedLabel?: string;
  search: (q: string) => Promise<Option[]>;
  onChange: (id: number | undefined, label: string) => void;
  error?: string;
}

/** Search-then-choose for doctors and patients (lists are paged, so a plain select cannot hold them all). */
export function Picker({ label, value, selectedLabel, search, onChange, error }: Props) {
  const [q, setQ] = useState('');
  const results = useAsync(() => search(q), q);
  return (
    <fieldset className="picker">
      <legend>{label}</legend>
      {value !== undefined && selectedLabel ? (
        <p>
          <strong>{selectedLabel}</strong>{' '}
          <button type="button" className="link" onClick={() => onChange(undefined, '')}>
            Change
          </button>
        </p>
      ) : (
        <>
          <input aria-label={`Search ${label.toLowerCase()}`} placeholder="Type to search" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="picker-results">
            {(results.data ?? []).map((o) => (
              <li key={o.id}>
                <button type="button" className="link" onClick={() => onChange(o.id, o.label)}>
                  {o.label}
                </button>
              </li>
            ))}
            {results.data?.length === 0 && <li className="muted">No matches</li>}
          </ul>
        </>
      )}
      {error && <small className="field-error">{error}</small>}
    </fieldset>
  );
}
