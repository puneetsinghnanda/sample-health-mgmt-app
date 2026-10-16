import { useId, type ReactElement, type ReactNode } from 'react';
import { cloneElement, isValidElement } from 'react';

interface Props {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactElement;
}

/** A labelled form control with its field error (PRD NFR-8: labelled fields). */
export function Field({ label, error, hint, required, children }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? errorId : undefined })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && <small className="muted">{hint}</small>}
      {error && (
        <small id={errorId} className="field-error">
          {error}
        </small>
      )}
    </div>
  );
}
