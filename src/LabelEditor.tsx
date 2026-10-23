import { useEffect, useRef, useState } from 'react';
import { labelText } from './catalog';
import { STATUS_COLOR } from './render';
import type { CatalogComponent, Label, Screen } from './types';
import { uid } from './util';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'create'; x0: number; y0: number }
  | { kind: 'move'; id: string; px: number; py: number; orig: Label }
  | { kind: 'resize'; id: string; corner: Corner; px: number; py: number; orig: Label };

interface Props {
  screen: Screen;
  catalog: CatalogComponent[];
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLabelsChange: (labels: Label[]) => void;
}

const MIN = 6;

export default function LabelEditor({ screen, catalog, zoom, selectedId, onSelect, onLabelsChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // 드래그 중 최신 값을 pointermove에서 읽기 위해
  const labelsRef = useRef(screen.labels);
  labelsRef.current = screen.labels;

  const toImage = (e: { clientX: number; clientY: number }) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(screen.width, (e.clientX - rect.left) / zoom)),
      y: Math.max(0, Math.min(screen.height, (e.clientY - rect.top) / zoom)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = toImage(e);
    const handle = target.dataset.corner as Corner | undefined;
    const id = target.closest<HTMLElement>('[data-label-id]')?.dataset.labelId;
    stageRef.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (id) {
      const orig = screen.labels.find((l) => l.id === id)!;
      onSelect(id);
      setDrag(handle ? { kind: 'resize', id, corner: handle, px: p.x, py: p.y, orig } : { kind: 'move', id, px: p.x, py: p.y, orig });
    } else {
      onSelect(null);
      setDrag({ kind: 'create', x0: p.x, y0: p.y });
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toImage(e);
    if (drag.kind === 'create') {
      setDraft({
        x: Math.min(drag.x0, p.x),
        y: Math.min(drag.y0, p.y),
        w: Math.abs(p.x - drag.x0),
        h: Math.abs(p.y - drag.y0),
      });
      return;
    }
    const dx = p.x - drag.px;
    const dy = p.y - drag.py;
    const o = drag.orig;
    let next: Label;
    if (drag.kind === 'move') {
      next = {
        ...o,
        x: Math.round(Math.max(0, Math.min(screen.width - o.w, o.x + dx))),
        y: Math.round(Math.max(0, Math.min(screen.height - o.h, o.y + dy))),
      };
    } else {
      let { x, y, w, h } = o;
      if (drag.corner.includes('w')) {
        x = Math.min(o.x + o.w - MIN, o.x + dx);
        w = o.x + o.w - x;
      } else {
        w = Math.max(MIN, o.w + dx);
      }
      if (drag.corner.includes('n')) {
        y = Math.min(o.y + o.h - MIN, o.y + dy);
        h = o.y + o.h - y;
      } else {
        h = Math.max(MIN, o.h + dy);
      }
      next = { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
    onLabelsChange(labelsRef.current.map((l) => (l.id === next.id ? next : l)));
  };

  const onPointerUp = () => {
    if (drag?.kind === 'create' && draft && draft.w >= MIN && draft.h >= MIN) {
      const label: Label = {
        id: uid(),
        x: Math.round(draft.x),
        y: Math.round(draft.y),
        w: Math.round(draft.w),
        h: Math.round(draft.h),
        componentId: null,
        freeName: '',
        props: {},
        status: 'unregistered',
      };
      onLabelsChange([...labelsRef.current, label]);
      onSelect(label.id);
    }
    setDrag(null);
    setDraft(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onLabelsChange(labelsRef.current.filter((l) => l.id !== selectedId));
        onSelect(null);
      } else if (e.key === 'Escape') {
        onSelect(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        onLabelsChange(labelsRef.current.map((l) => (l.id === selectedId ? { ...l, x: l.x + d[0], y: l.y + d[1] } : l)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, onLabelsChange, onSelect]);

  return (
    <div
      ref={stageRef}
      className="stage"
      style={{ width: screen.width * zoom, height: screen.height * zoom }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={screen.src} alt={screen.name} draggable={false} />
      {screen.labels.map((l, i) => {
        const selected = l.id === selectedId;
        const color = STATUS_COLOR[l.status];
        return (
          <div
            key={l.id}
            data-label-id={l.id}
            className={`box ${selected ? 'selected' : ''} ${l.status}`}
            style={{ left: l.x * zoom, top: l.y * zoom, width: l.w * zoom, height: l.h * zoom, borderColor: color }}
          >
            <span className="tag" style={{ background: color }}>
              {i + 1}. {labelText(l, catalog)}
            </span>
            {selected &&
              (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                <span key={c} className={`handle ${c}`} data-corner={c} style={{ borderColor: color }} />
              ))}
          </div>
        );
      })}
      {draft && (
        <div
          className="box draft"
          style={{ left: draft.x * zoom, top: draft.y * zoom, width: draft.w * zoom, height: draft.h * zoom }}
        />
      )}
    </div>
  );
}
