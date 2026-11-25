import { useState } from 'react';
import { X } from 'lucide-react';
import type { GmailLabel } from '../../core/types.ts';

/** A label named in the form that Gmail does not have yet; Settings creates it on Save. */
export const stagedLabel = (name: string): GmailLabel => ({ id: `new:${name.trim().toLowerCase()}`, name: name.trim() });
export const isStaged = (label: GmailLabel) => label.id.startsWith('new:');

/** The picker's choice that asks for a new label's name. */
const newChoice = 'new';

/**
 * Chosen labels as chips, and a picker to add more. With `allowNew`, a name the user types becomes a staged label: an
 * existing label of that name (ignoring case, as Gmail does) is used instead.
 */
export function LabelPicker({
  name,
  chosen,
  known,
  allowNew,
  onChange,
}: {
  /** What the picker is for, such as "Has labels"; it names the controls for screen readers. */
  name: string;
  chosen: GmailLabel[];
  known: GmailLabel[];
  allowNew: boolean;
  onChange(labels: GmailLabel[]): void;
}) {
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const available = known.filter(label => !chosen.some(item => item.id === label.id));

  function addNamed() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const existing = known.find(label => label.name.toLowerCase() === trimmed.toLowerCase());
    const label = existing ?? stagedLabel(trimmed);
    if (!chosen.some(item => item.id === label.id)) onChange([...chosen, label]);
    setNewName('');
    setNaming(false);
  }

  return (
    <div className="label-picker">
      {chosen.length > 0 && (
        <ul className="label-chips" aria-label={name}>
          {chosen.map(label => (
            <li key={label.id}>
              {label.name}
              {isStaged(label) && <small> (new)</small>}
              <button
                type="button"
                aria-label={`Remove ${label.name} from ${name.toLowerCase()}`}
                onClick={() => onChange(chosen.filter(item => item.id !== label.id))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {naming ? (
        <div className="label-new">
          <input
            type="text"
            aria-label={`New label for ${name.toLowerCase()}`}
            placeholder="Label name, such as Later"
            value={newName}
            autoFocus
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addNamed();
            }}
          />
          <button type="button" className="button secondary" onClick={addNamed}>
            Add
          </button>
        </div>
      ) : (
        <select
          aria-label={`Add to ${name.toLowerCase()}`}
          value=""
          onChange={event => {
            const value = event.target.value;
            if (value === newChoice) return setNaming(true);
            const label = available.find(item => item.id === value);
            if (label) onChange([...chosen, label]);
          }}
        >
          <option value="" disabled>
            {chosen.length ? 'Add another label…' : 'Add a label…'}
          </option>
          {available.map(label => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
          {allowNew && <option value={newChoice}>New label…</option>}
        </select>
      )}
    </div>
  );
}
