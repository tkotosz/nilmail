import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronRight, Layers, Menu, Plus } from 'lucide-react';
import { pileSummary } from '../../core/pile.ts';
import type { Pile } from '../../core/types.ts';
import { Group, RowIcon } from './SettingsRows.tsx';

/** A pile being dragged by its handle: where the pointer started, how far it has moved, and the rows' places then. */
interface Drag {
  id: string;
  from: number;
  startY: number;
  offset: number;
  /** Each row's top and height when the drag began, in the list's order. */
  rows: { top: number; height: number }[];
}

/** The place a dragged row would take: before every row whose middle its own middle has passed. */
function targetIndex(drag: Drag): number {
  const own = drag.rows[drag.from]!;
  const middle = own.top + own.height / 2 + drag.offset;
  let index = 0;
  drag.rows.forEach((row, at) => {
    if (at !== drag.from && middle > row.top + row.height / 2) index++;
  });
  return index;
}

/** How far a row moves aside while another is dragged across it. */
function shiftFor(drag: Drag, at: number, to: number): number {
  const gap = 2;
  const space = drag.rows[drag.from]!.height + gap;
  if (at === drag.from) return drag.offset;
  if (drag.from < to && at > drag.from && at <= to) return -space;
  if (drag.from > to && at < drag.from && at >= to) return space;
  return 0;
}

/**
 * The piles in the picker's order, each with its filters in brief, to open, add, or reorder by dragging its handle. The
 * handle also takes the arrow keys, for a keyboard.
 */
export function PileList({
  piles,
  onEdit,
  onMove,
  onAdd,
}: {
  piles: Pile[];
  onEdit(id: string): void;
  /** Moves the pile to `index` in the list. */
  onMove(id: string, index: number): void;
  onAdd(): void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const to = drag ? targetIndex(drag) : -1;

  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rows = piles.map(pile => {
      const box = rowRefs.current.get(pile.id)!.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    setDrag({ id, from: piles.findIndex(pile => pile.id === id), startY: event.clientY, offset: 0, rows });
  }

  function finish() {
    if (drag && to !== drag.from) onMove(drag.id, to);
    setDrag(null);
  }

  function keys(event: KeyboardEvent<HTMLButtonElement>, index: number, id: string) {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    const next = index + by;
    if (next >= 0 && next < piles.length) onMove(id, next);
  }

  return (
    <Group title="Piles">
      {piles.map((pile, index) => (
        <div
          key={pile.id}
          ref={element => {
            if (element) rowRefs.current.set(pile.id, element);
            else rowRefs.current.delete(pile.id);
          }}
          className={`row pile-row${drag?.id === pile.id ? ' dragging' : ''}${drag ? ' sorting' : ''}`}
          style={drag ? { transform: `translateY(${shiftFor(drag, index, to)}px)` } : undefined}
        >
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
            <button
              type="button"
              className="drag-handle"
              aria-label={`Move ${pile.name}: drag, or use the arrow keys`}
              onPointerDown={event => start(event, pile.id)}
              onPointerMove={event =>
                setDrag(current => (current?.id === pile.id ? { ...current, offset: event.clientY - current.startY } : current))
              }
              onPointerUp={finish}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={event => keys(event, index, pile.id)}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
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
