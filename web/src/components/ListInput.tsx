import { useState } from 'react';

interface Props {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}

/** Short text items such as allergies: add with Enter or the button, remove individually. */
export function ListInput({ label, items, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !items.includes(t)) onChange([...items, t]);
    setDraft('');
  };
  return (
    <fieldset className="list-input">
      <legend>{label}</legend>
      <ul>
        {items.map((item) => (
          <li key={item}>
            {item}{' '}
            <button type="button" className="link" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((x) => x !== item))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label={`Add to ${label}`}
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" onClick={add}>
        Add
      </button>
    </fieldset>
  );
}
