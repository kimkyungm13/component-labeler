import type { CatalogComponent, Label, RefImage } from './types';
import { readAsDataUrl, uid } from './util';

const STORAGE_KEY = 'component-labeler.catalog.v3';

interface RawVariantEntry {
  refImage?: string;
}

interface RawComponent {
  codeName: string;
  figmaName: string;
  importPath?: string;
  css?: string;
  note?: string;
  labelable?: boolean;
  refImages?: string[];
  variants?: Record<string, Record<string, RawVariantEntry>>;
}

/** public/catalog/catalog.json(목 카탈로그 원본 형식)을 앱 형식으로 바꾼다 */
async function fromRaw(raw: { components: RawComponent[] }, base: string): Promise<CatalogComponent[]> {
  const toDataUrl = async (path: string) => readAsDataUrl(await (await fetch(base + path)).blob());
  return Promise.all(
    raw.components.map(async (c) => {
      const refImages = await Promise.all(
        (c.refImages ?? []).map(async (p): Promise<RefImage> => ({ id: uid(), dataUrl: await toDataUrl(p) })),
      );
      const variants = Object.entries(c.variants ?? {}).map(([prop, options]) => ({
        prop,
        options: Object.keys(options),
      }));
      for (const [prop, options] of Object.entries(c.variants ?? {})) {
        for (const [value, entry] of Object.entries(options)) {
          if (entry.refImage) {
            refImages.push({ id: uid(), dataUrl: await toDataUrl(entry.refImage), variant: `${prop}=${value}` });
          }
        }
      }
      return {
        id: uid(),
        codeName: c.codeName,
        figmaName: c.figmaName,
        importPath: c.importPath ?? '',
        css: c.css ?? '',
        note: c.note,
        labelable: c.labelable !== false,
        variants,
        refImages,
      };
    }),
  );
}

export async function loadDefaultCatalog(): Promise<CatalogComponent[]> {
  const raw = await (await fetch('/catalog/catalog.json')).json();
  return fromRaw(raw, '/catalog/');
}

export function loadStoredCatalog(): CatalogComponent[] | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function storeCatalog(catalog: CatalogComponent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // 용량 초과 등. 카탈로그 JSON 내보내기로 백업할 수 있다.
  }
}

export function labelText(label: Label, catalog: CatalogComponent[]): string {
  const comp = catalog.find((c) => c.id === label.componentId);
  if (!comp) return label.freeName ? `미등록: ${label.freeName}` : '미등록';
  const props = Object.entries(label.props)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return props ? `${comp.codeName} ${props}` : comp.codeName;
}
