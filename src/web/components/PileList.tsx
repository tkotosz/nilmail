import { ArrowDown, ArrowUp, ChevronRight, Layers, Plus } from 'lucide-react';
import { pileSummary } from '../../core/pile.ts';
import type { Pile } from '../../core/types.ts';
import { Group, RowIcon } from './SettingsRows.tsx';

/** The piles in the picker's order, each with its filters in brief, to open, move or add. */
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
    <Group title="Piles">
      {piles.map((pile, index) => (
        <div key={pile.id} className="row pile-row">
          <button
            type="button"
            className="pile-open"
            aria-label={`Edit ${pile.name || 'unnamed pile'}: ${pileSummary(pile.filters)}`}
            onClick={() => onEdit(pile.id)}
          >
            <RowIcon>
              <Layers size={20} />
            </RowIcon>
            <span className="row-text">
              <span className="row-title">{pile.name || 'Unnamed pile'}</span>
              <span className="row-value">{pileSummary(pile.filters)}</span>
            </span>
            <ChevronRight size={20} aria-hidden="true" className="row-trailing" />
          </button>
          {piles.length > 1 && (
            <span className="pile-move">
              <button
                type="button"
                className="icon-button small"
                aria-label={`Move ${pile.name} up`}
                disabled={index === 0}
                onClick={() => onMove(pile.id, -1)}
              >
                <ArrowUp size={18} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Move ${pile.name} down`}
                disabled={index === piles.length - 1}
                onClick={() => onMove(pile.id, 1)}
              >
                <ArrowDown size={18} />
              </button>
            </span>
          )}
        </div>
      ))}
      <button type="button" className="row add-row" onClick={onAdd}>
        <RowIcon>
          <Plus size={20} />
        </RowIcon>
        <span className="row-title">New pile</span>
      </button>
    </Group>
  );
}
