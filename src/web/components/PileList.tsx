import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { pileSummary } from '../../core/pile.ts';
import type { Pile } from '../../core/types.ts';

/** The piles in the picker's order, each with its filters in brief, to edit, move or add. */
export function PileList({
  piles,
  onEdit,
  onMove,
  onAdd,
}: {
  piles: Pile[];
  onEdit(id: string): void;
  /** Moves the pile one place up (-1) or down (1). */
  onMove(id: string, by: -1 | 1): void;
  onAdd(): void;
}) {
  return (
    <fieldset>
      <legend>Piles</legend>
      <ol className="pile-list">
        {piles.map((pile, index) => (
          <li key={pile.id}>
            <button
              type="button"
              className="pile-row"
              aria-label={`Edit ${pile.name || 'unnamed pile'}: ${pileSummary(pile.filters)}`}
              onClick={() => onEdit(pile.id)}
            >
              <span className="pile-row-text">
                <strong>{pile.name || 'Unnamed pile'}</strong>
                <span>{pileSummary(pile.filters)}</span>
              </span>
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button small"
              aria-label={`Move ${pile.name} up`}
              disabled={index === 0}
              onClick={() => onMove(pile.id, -1)}
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              className="icon-button small"
              aria-label={`Move ${pile.name} down`}
              disabled={index === piles.length - 1}
              onClick={() => onMove(pile.id, 1)}
            >
              <ArrowDown size={16} />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="button secondary" onClick={onAdd}>
        <Plus size={18} aria-hidden="true" /> New pile
      </button>
      <p className="hint">The picker in the header lists the piles in this order, and nilmail opens on the first.</p>
    </fieldset>
  );
}
