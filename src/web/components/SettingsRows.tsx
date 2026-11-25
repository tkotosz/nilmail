import type { ReactNode } from 'react';

/*
 * The building blocks of Settings, in the style of Android's settings: rows in rounded groups. A row shows a title and,
 * below it, its current value. Tapping a row either opens the phone's own menu (SelectRow), toggles it (CheckRow,
 * SwitchRow), or opens a page of its own inside Settings (NavRow).
 */

/** A titled group of rows. */
export function Group({ title, className, children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`settings-group${className ? ` ${className}` : ''}`}>
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group">{children}</div>
    </section>
  );
}

function RowText({ title, value }: { title: ReactNode; value?: ReactNode }) {
  return (
    <span className="row-text">
      <span className="row-title">{title}</span>
      {value !== undefined && value !== '' && <span className="row-value">{value}</span>}
    </span>
  );
}

/** A row that opens a page of its own. */
export function NavRow({
  title,
  value,
  icon,
  label,
  onClick,
}: {
  title: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  /** The row's name for screen readers, when the title alone does not say it. */
  label?: string;
  onClick(): void;
}) {
  return (
    <button type="button" className="row" onClick={onClick} aria-label={label}>
      {icon}
      <RowText title={title} value={value} />
    </button>
  );
}

/** A row whose value is one of a few choices: tapping it opens the phone's own menu. */
export function SelectRow<Value extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange(value: Value): void;
}) {
  const shown = options.find(([option]) => option === value)?.[1] ?? '';
  return (
    <label className="row">
      <RowText title={title} value={shown} />
      <select className="row-select" aria-label={title} value={value} onChange={event => onChange(event.target.value as Value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A row with a checkbox at its end, for one of several related options, such as the labels of a pile. */
export function CheckRow({
  title,
  value,
  icon,
  checked,
  onChange,
}: {
  title: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="row">
      {icon}
      <RowText title={title} value={value} />
      <input type="checkbox" className="row-trailing" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

/** A standalone on/off setting with a switch at its end: settings apply as they change, which is what Material gives switches. */
export function SwitchRow({
  title,
  value,
  checked,
  onChange,
}: {
  title: ReactNode;
  value?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="row">
      <RowText title={title} value={value} />
      <input
        type="checkbox"
        role="switch"
        className="switch row-trailing"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  );
}

/** A row holding a text field, with its label above the text. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row field-row">
      <span className="row-label">{label}</span>
      {children}
    </label>
  );
}

/** A round, tinted icon at the start of a row, such as a swipe's action. */
export function RowIcon({ tone, children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`row-icon${tone ? ` tone-${tone}` : ''}`} aria-hidden="true">
      {children}
    </span>
  );
}
