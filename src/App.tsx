import { useCallback, useEffect, useRef, useState } from 'react';
import CatalogPage from './CatalogPage';
import { loadDefaultCatalog, loadStoredCatalog, storeCatalog } from './catalog';
import { guessScale, matchByCss } from './matcher';
import Inspector from './Inspector';
import LabelEditor from './LabelEditor';
import { buildZip, STATUS_COLOR, STATUS_TEXT } from './render';
import type { CatalogComponent, Label, Screen } from './types';
import { downloadBlob, loadImage, uid } from './util';

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [tab, setTab] = useState<'label' | 'catalog'>('label');
  const [catalog, setCatalog] = useState<CatalogComponent[]>(() => loadStoredCatalog() ?? []);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [fitZoom, setFitZoom] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const screen = screens.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    if (!loadStoredCatalog()) loadDefaultCatalog().then(setCatalog);
  }, []);

  useEffect(() => {
    if (catalog.length) storeCatalog(catalog);
  }, [catalog]);

  // 새로고침하면 시안이 사라지므로 경고
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (screens.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [screens.length]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !screen) return;
    const ro = new ResizeObserver(() => setFitZoom(Math.min(1, (el.clientWidth - 48) / screen.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen?.id, screen?.width, tab]);

  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode;

  const addFiles = async (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    const added = await Promise.all(
      images.map(async (f): Promise<Screen> => {
        const src = URL.createObjectURL(f);
        const img = await loadImage(src);
        return {
          id: uid(),
          name: f.name.replace(/\.[^.]+$/, ''),
          src,
          mime: f.type,
          width: img.naturalWidth,
          height: img.naturalHeight,
          scale: guessScale(img.naturalWidth),
          labels: [],
        };
      }),
    );
    if (!added.length) return;
    setScreens((prev) => [...prev, ...added]);
    setActiveId((cur) => cur ?? added[0].id);
    setTab('label');
  };

  const updateScreen = (id: string, patch: Partial<Screen>) =>
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const setLabels = useCallback(
    (labels: Label[]) => {
      if (activeId) setScreens((prev) => prev.map((s) => (s.id === activeId ? { ...s, labels } : s)));
    },
    [activeId],
  );

  const removeScreen = (id: string) => {
    const s = screens.find((x) => x.id === id);
    if (s?.labels.length && !confirm(`"${s.name}"의 라벨 ${s.labels.length}개도 함께 지워져요. 지울까요?`)) return;
    if (s) URL.revokeObjectURL(s.src);
    const rest = screens.filter((x) => x.id !== id);
    setScreens(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
  };

  const runMatch = async () => {
    if (!screen) return;
    if (screen.labels.length && !confirm('지금 라벨을 대조 결과로 바꿀까요? (기존 라벨은 지워져요)')) return;
    setBusy('소스와 대조하는 중…');
    try {
      const labels = await matchByCss(screen.src, screen.width, screen.height, catalog, screen.scale);
      updateScreen(screen.id, { labels });
      setSelectedId(null);
      if (!labels.length) alert('카탈로그 CSS와 맞는 요소를 찾지 못했어요. 배율이 맞는지 확인해 주세요.');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runExport = async (targets: Screen[]) => {
    const review = targets.reduce((n, s) => n + s.labels.filter((l) => l.status === 'review').length, 0);
    const unregistered = targets.reduce((n, s) => n + s.labels.filter((l) => l.status === 'unregistered').length, 0);
    if (review || unregistered) {
      const parts = [review && `확인 필요 ${review}개`, unregistered && `미등록 ${unregistered}개`].filter(Boolean).join(', ');
      if (!confirm(`${parts}가 남아 있어요. 그대로 내보낼까요?`)) return;
    }
    setBusy('내보내는 중…');
    try {
      const zip = await buildZip(targets, catalog);
      const name = targets.length === 1 ? targets[0].name : `라벨시안_${today()}`;
      downloadBlob(zip, `${name}.zip`);
    } finally {
      setBusy(null);
    }
  };

  const counts = (s: Screen) => ({
    matched: s.labels.filter((l) => l.status === 'matched').length,
    review: s.labels.filter((l) => l.status === 'review').length,
    unregistered: s.labels.filter((l) => l.status === 'unregistered').length,
  });

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <h1>컴포넌트 라벨러</h1>
        <nav>
          <button className={tab === 'label' ? 'on' : ''} onClick={() => setTab('label')}>
            라벨링
          </button>
          <button className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}>
            카탈로그 ({catalog.length})
          </button>
        </nav>
        <div className="spacer" />
        {tab === 'label' && screens.length > 0 && (
          <button className="primary" onClick={() => runExport(screens)} disabled={!!busy}>
            전체 Export ({screens.length}장)
          </button>
        )}
      </header>

      {tab === 'catalog' ? (
        <CatalogPage
          catalog={catalog}
          onChange={(next) => {
            const ids = new Set(next.map((c) => c.id));
            setCatalog(next);
            // 지워진 컴포넌트를 가리키던 라벨은 미등록으로 돌린다
            setScreens((prev) =>
              prev.map((s) => ({
                ...s,
                labels: s.labels.map((l) =>
                  l.componentId && !ids.has(l.componentId) ? { ...l, componentId: null, status: 'unregistered' } : l,
                ),
              })),
            );
          }}
          onReset={() => loadDefaultCatalog().then(setCatalog)}
        />
      ) : (
        <div className="label-page">
          <aside className="screens">
            <button className="primary block" onClick={() => fileRef.current?.click()}>
              + 시안 추가
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <ul>
              {screens.map((s) => {
                const c = counts(s);
                return (
                  <li
                    key={s.id}
                    className={s.id === activeId ? 'on' : ''}
                    onClick={() => {
                      setActiveId(s.id);
                      setSelectedId(null);
                    }}
                  >
                    <img src={s.src} alt="" />
                    <div>
                      <b>{s.name}</b>
                      <small>
                        {s.labels.length ? (
                          <>
                            <i style={{ color: STATUS_COLOR.matched }}>{c.matched}</i> ·{' '}
                            <i style={{ color: STATUS_COLOR.review }}>{c.review}</i> ·{' '}
                            <i style={{ color: STATUS_COLOR.unregistered }}>{c.unregistered}</i>
                          </>
                        ) : (
                          '라벨 없음'
                        )}
                      </small>
                    </div>
                    <button
                      className="x"
                      title="시안 빼기"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeScreen(s.id);
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="legend">
              {(Object.keys(STATUS_TEXT) as (keyof typeof STATUS_TEXT)[]).map((k) => (
                <span key={k}>
                  <i style={{ background: STATUS_COLOR[k] }} />
                  {STATUS_TEXT[k]}
                </span>
              ))}
            </div>
          </aside>

          <main className="workspace">
            {screen ? (
              <>
                <div className="toolbar">
                  <input
                    className="screen-name"
                    key={screen.id}
                    defaultValue={screen.name}
                    title="화면명 (export 파일명)"
                    onBlur={(e) => updateScreen(screen.id, { name: e.target.value.trim() || screen.name })}
                  />
                  <span className="dim">
                    {screen.width}×{screen.height}
                  </span>
                  <div className="spacer" />
                  <select
                    value={String(zoomMode)}
                    onChange={(e) => setZoomMode(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
                  >
                    <option value="fit">화면 맞춤</option>
                    <option value="0.5">50%</option>
                    <option value="1">100%</option>
                    <option value="2">200%</option>
                  </select>
                  <select
                    value={screen.scale}
                    title="시안 배율"
                    onChange={(e) => updateScreen(screen.id, { scale: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        @{n}x{n === guessScale(screen.width) ? ' (자동)' : ''}
                      </option>
                    ))}
                  </select>
                  <button onClick={runMatch} disabled={!!busy}>
                    소스 대조로 라벨
                  </button>
                  <button className="primary" onClick={() => runExport([screen])} disabled={!!busy}>
                    이 시안 Export
                  </button>
                </div>
                <div className="canvas" ref={canvasRef}>
                  <LabelEditor
                    screen={screen}
                    catalog={catalog}
                    zoom={zoom}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onLabelsChange={setLabels}
                  />
                </div>
              </>
            ) : (
              <div className="dropzone" onClick={() => fileRef.current?.click()}>
                <b>시안 이미지를 끌어다 놓으세요</b>
                <span>PNG·JPG, 여러 장 가능. 이미지는 브라우저 안에서만 처리돼요.</span>
              </div>
            )}
          </main>

          {screen && (
            <Inspector
              labels={screen.labels}
              catalog={catalog}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onLabelsChange={setLabels}
            />
          )}
        </div>
      )}

      {dragOver && <div className="drop-overlay">여기에 놓으면 시안이 추가돼요</div>}
      {busy && (
        <div className="busy">
          <div>{busy}</div>
        </div>
      )}
    </div>
  );
}
