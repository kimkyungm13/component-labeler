import { useRef, useState } from 'react';
import type { CatalogComponent } from './types';
import { downloadBlob, readAsDataUrl, uid } from './util';

interface Props {
  catalog: CatalogComponent[];
  onChange: (catalog: CatalogComponent[]) => void;
  onReset: () => void;
}

const emptyComponent = (): CatalogComponent => ({
  id: uid(),
  codeName: 'NewComponent',
  figmaName: '',
  importPath: '',
  description: '',
  labelable: true,
  variants: [],
  refImages: [],
});

export default function CatalogPage({ catalog, onChange, onReset }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(catalog[0]?.id ?? null);
  const importRef = useRef<HTMLInputElement>(null);
  const comp = catalog.find((c) => c.id === selectedId);

  const update = (patch: Partial<CatalogComponent>) =>
    onChange(catalog.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));

  const addRefs = async (files: FileList | null) => {
    if (!comp || !files) return;
    const added = await Promise.all(
      [...files].filter((f) => f.type.startsWith('image/')).map(async (f) => ({ id: uid(), dataUrl: await readAsDataUrl(f) })),
    );
    update({ refImages: [...comp.refImages, ...added] });
  };

  const exportJson = () =>
    downloadBlob(new Blob([JSON.stringify({ version: 1, components: catalog }, null, 2)], { type: 'application/json' }), 'catalog.json');

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!Array.isArray(json.components)) throw new Error();
      onChange(json.components);
      setSelectedId(json.components[0]?.id ?? null);
    } catch {
      alert('이 앱에서 내보낸 카탈로그 JSON만 가져올 수 있어요');
    }
  };

  const variantText = (c: CatalogComponent) => c.variants.map((v) => `${v.prop}=${v.options.join('|')}`).join('\n');
  const parseVariants = (text: string) =>
    text
      .split('\n')
      .map((line) => line.split('='))
      .filter(([prop, opts]) => prop?.trim() && opts?.trim())
      .map(([prop, opts]) => ({ prop: prop.trim(), options: opts.split('|').map((o) => o.trim()).filter(Boolean) }));

  return (
    <div className="catalog-page">
      <aside className="catalog-list">
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              const c = emptyComponent();
              onChange([...catalog, c]);
              setSelectedId(c.id);
            }}
          >
            + 컴포넌트
          </button>
        </div>
        <ul>
          {catalog.map((c) => (
            <li key={c.id} className={c.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(c.id)}>
              {c.refImages[0] ? <img src={c.refImages[0].dataUrl} alt="" /> : <span className="noimg" />}
              <div>
                <b>{c.codeName}</b>
                <small>{c.figmaName || '피그마명 없음'}</small>
              </div>
            </li>
          ))}
        </ul>
        <div className="row wrap">
          <button onClick={exportJson}>JSON 내보내기</button>
          <button onClick={() => importRef.current?.click()}>JSON 가져오기</button>
          <button
            onClick={() => {
              if (confirm('기본 목 카탈로그로 되돌릴까요? 지금 카탈로그는 사라져요.')) onReset();
            }}
          >
            목 카탈로그로 초기화
          </button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        </div>
      </aside>

      {comp ? (
        <section className="catalog-form" key={comp.id}>
          <div className="grid2">
            <label className="field">
              <span>코드명 (라벨에 찍히는 값)</span>
              <input defaultValue={comp.codeName} onBlur={(e) => update({ codeName: e.target.value.trim() })} />
            </label>
            <label className="field">
              <span>피그마명</span>
              <input defaultValue={comp.figmaName} onBlur={(e) => update({ figmaName: e.target.value.trim() })} />
            </label>
          </div>
          <label className="field">
            <span>import 경로</span>
            <input defaultValue={comp.importPath} placeholder="common_modules/CustomChip" onBlur={(e) => update({ importPath: e.target.value.trim() })} />
          </label>
          <label className="field">
            <span>생김새 설명 (AI가 비슷한 컴포넌트를 구분할 때 씀)</span>
            <textarea rows={3} defaultValue={comp.description} onBlur={(e) => update({ description: e.target.value })} />
          </label>
          <label className="field">
            <span>variant (한 줄에 하나, 예: variant=active|disabled)</span>
            <textarea rows={2} defaultValue={variantText(comp)} onBlur={(e) => update({ variants: parseVariants(e.target.value) })} />
          </label>
          <label className="field">
            <span>비고</span>
            <input defaultValue={comp.note ?? ''} onBlur={(e) => update({ note: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={comp.labelable} onChange={(e) => update({ labelable: e.target.checked })} />
            단독 라벨 대상 (다른 컴포넌트 안에만 들어가는 요소면 끄기)
          </label>

          <div className="field">
            <span>참고 이미지 (variant별 1장 권장)</span>
            <div className="ref-grid">
              {comp.refImages.map((r) => (
                <figure key={r.id}>
                  <img src={r.dataUrl} alt="" />
                  <select
                    value={r.variant ?? ''}
                    onChange={(e) =>
                      update({ refImages: comp.refImages.map((x) => (x.id === r.id ? { ...x, variant: e.target.value || undefined } : x)) })
                    }
                  >
                    <option value="">(공통)</option>
                    {comp.variants.flatMap((v) =>
                      v.options.map((o) => (
                        <option key={`${v.prop}=${o}`} value={`${v.prop}=${o}`}>
                          {v.prop}={o}
                        </option>
                      )),
                    )}
                  </select>
                  <button className="link" onClick={() => update({ refImages: comp.refImages.filter((x) => x.id !== r.id) })}>
                    삭제
                  </button>
                </figure>
              ))}
              <label className="ref-add">
                + 이미지
                <input type="file" accept="image/*" multiple hidden onChange={(e) => addRefs(e.target.files)} />
              </label>
            </div>
          </div>

          <button
            className="danger"
            onClick={() => {
              if (!confirm(`${comp.codeName}을(를) 카탈로그에서 지울까요?`)) return;
              onChange(catalog.filter((c) => c.id !== comp.id));
              setSelectedId(null);
            }}
          >
            컴포넌트 삭제
          </button>
        </section>
      ) : (
        <section className="catalog-form empty">왼쪽에서 컴포넌트를 고르거나 새로 추가하세요.</section>
      )}
    </div>
  );
}
