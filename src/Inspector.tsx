import { labelText } from './catalog';
import { STATUS_COLOR, STATUS_TEXT } from './render';
import type { CatalogComponent, Label, LabelStatus } from './types';

interface Props {
  labels: Label[];
  catalog: CatalogComponent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLabelsChange: (labels: Label[]) => void;
}

const STATUSES: LabelStatus[] = ['matched', 'review', 'unregistered'];

export default function Inspector({ labels, catalog, selectedId, onSelect, onLabelsChange }: Props) {
  const label = labels.find((l) => l.id === selectedId);
  const comp = catalog.find((c) => c.id === label?.componentId);

  const update = (patch: Partial<Label>) =>
    onLabelsChange(labels.map((l) => (l.id === selectedId ? { ...l, ...patch } : l)));

  const setComponent = (text: string) => {
    const match = catalog.find(
      (c) => c.codeName.toLowerCase() === text.trim().toLowerCase() || c.figmaName.toLowerCase() === text.trim().toLowerCase(),
    );
    if (match) {
      update({ componentId: match.id, freeName: '', props: {}, status: 'matched' });
    } else {
      update({ componentId: null, freeName: text, props: {}, status: 'unregistered' });
    }
  };

  return (
    <aside className="inspector">
      {label ? (
        <section className="panel">
          <h3>라벨 편집</h3>
          <label className="field">
            <span>컴포넌트 (코드명 또는 피그마명)</span>
            <input
              list="catalog-names"
              key={label.id + (comp?.id ?? '')}
              defaultValue={comp?.codeName ?? label.freeName}
              placeholder="예: CustomToggle"
              onBlur={(e) => setComponent(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setComponent(e.currentTarget.value)}
              autoFocus={!label.componentId && !label.freeName}
            />
            <datalist id="catalog-names">
              {catalog
                .filter((c) => c.labelable)
                .map((c) => (
                  <option key={c.id} value={c.codeName}>
                    {c.figmaName}
                  </option>
                ))}
            </datalist>
          </label>

          {comp && (
            <div className="comp-info">
              <div>
                피그마명 <b>{comp.figmaName}</b>
              </div>
              {comp.importPath && <code>{comp.importPath}</code>}
              {comp.refImages[0] && (
                <div className="refs">
                  {comp.refImages.map((r) => (
                    <figure key={r.id}>
                      <img src={r.dataUrl} alt="" />
                      {r.variant && <figcaption>{r.variant}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )}

          {comp?.variants.map((v) => (
            <label className="field" key={v.prop}>
              <span>{v.prop}</span>
              <select value={label.props[v.prop] ?? ''} onChange={(e) => update({ props: { ...label.props, [v.prop]: e.target.value } })}>
                <option value="">(표시 안 함)</option>
                {v.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <div className="field">
            <span>상태</span>
            <div className="segmented">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={label.status === s ? 'on' : ''}
                  style={label.status === s ? { background: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] } : undefined}
                  disabled={s !== 'unregistered' && !comp}
                  onClick={() => update({ status: s })}
                >
                  {STATUS_TEXT[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="preview-text">
            라벨: <code>{labelText(label, catalog)}</code>
          </div>
          <button
            className="danger"
            onClick={() => {
              onLabelsChange(labels.filter((l) => l.id !== label.id));
              onSelect(null);
            }}
          >
            라벨 삭제
          </button>
        </section>
      ) : (
        <section className="panel hint">
          <h3>사용법</h3>
          <p>시안 위를 드래그하면 박스가 생겨요. 박스를 누르면 여기서 코드명을 고를 수 있어요.</p>
          <p>
            <kbd>Delete</kbd> 삭제 · <kbd>←↑→↓</kbd> 1px 이동 (<kbd>Shift</kbd> 10px) · <kbd>Esc</kbd> 선택 해제
          </p>
        </section>
      )}

      <section className="panel">
        <h3>라벨 목록 ({labels.length})</h3>
        <ol className="label-list">
          {labels.map((l) => (
            <li key={l.id} className={l.id === selectedId ? 'on' : ''} onClick={() => onSelect(l.id)}>
              <i style={{ background: STATUS_COLOR[l.status] }} />
              {labelText(l, catalog)}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
