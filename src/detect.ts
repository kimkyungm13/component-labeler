import type { CatalogComponent, Label, Screen } from './types';
import { loadImage, uid } from './util';

/** 서버(api/detect)와 주고받는 형식 */
export interface DetectRequest {
  image: { mediaType: 'image/jpeg'; data: string; width: number; height: number };
  catalog: {
    codeName: string;
    figmaName: string;
    description: string;
    note?: string;
    variants: { prop: string; options: string[] }[];
    refImages: { dataUrl: string; variant?: string }[];
  }[];
}

export interface DetectItem {
  box: { x: number; y: number; w: number; h: number };
  codeName: string;
  props: { prop: string; value: string }[];
  confidence: 'high' | 'low';
}

const MAX_SIDE = 1568;
/** 세로로 긴 시안은 가로의 이 배수 높이로 잘라 보낸다 */
const TILE_RATIO = 2;

interface Tile {
  top: number;
  height: number;
}

function tiles(width: number, height: number): Tile[] {
  const tileH = Math.round(width * TILE_RATIO);
  if (height <= tileH * 1.15) return [{ top: 0, height }];
  const step = Math.round(tileH * 0.85);
  const result: Tile[] = [];
  for (let top = 0; ; top += step) {
    if (top + tileH >= height) {
      result.push({ top: Math.max(0, height - tileH), height: Math.min(tileH, height) });
      break;
    }
    result.push({ top, height: tileH });
  }
  return result;
}

const iou = (a: Label, b: Label) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
};

async function detectTile(
  img: HTMLImageElement,
  screen: Screen,
  tile: Tile,
  catalog: DetectRequest['catalog'],
  password: string,
): Promise<DetectItem[]> {
  const scale = Math.min(1, MAX_SIDE / Math.max(screen.width, tile.height));
  const w = Math.round(screen.width * scale);
  const h = Math.round(tile.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, tile.top, screen.width, tile.height, 0, 0, w, h);
  const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

  const body: DetectRequest = { image: { mediaType: 'image/jpeg', data, width: w, height: h }, catalog };
  const res = await fetch('/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-password': password },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `검출 실패 (${res.status})`);
  return (json.items as DetectItem[]).map((it) => ({
    ...it,
    box: {
      x: it.box.x / scale,
      y: it.box.y / scale + tile.top,
      w: it.box.w / scale,
      h: it.box.h / scale,
    },
  }));
}

export async function detectLabels(screen: Screen, catalog: CatalogComponent[], password: string): Promise<Label[]> {
  const img = await loadImage(screen.src);
  const payload: DetectRequest['catalog'] = catalog
    .filter((c) => c.labelable)
    .map((c) => ({
      codeName: c.codeName,
      figmaName: c.figmaName,
      description: c.description,
      note: c.note,
      variants: c.variants,
      refImages: c.refImages.map(({ dataUrl, variant }) => ({ dataUrl, variant })),
    }));

  const results = await Promise.all(
    tiles(screen.width, screen.height).map((t) => detectTile(img, screen, t, payload, password)),
  );

  const labels: Label[] = [];
  for (const it of results.flat()) {
    const comp = catalog.find((c) => c.codeName === it.codeName);
    const x = Math.max(0, Math.round(it.box.x));
    const y = Math.max(0, Math.round(it.box.y));
    const label: Label = {
      id: uid(),
      x,
      y,
      w: Math.max(4, Math.min(screen.width - x, Math.round(it.box.w))),
      h: Math.max(4, Math.min(screen.height - y, Math.round(it.box.h))),
      componentId: comp?.id ?? null,
      freeName: comp ? '' : it.codeName,
      props: Object.fromEntries(
        it.props.filter((p) => comp?.variants.some((v) => v.prop === p.prop)).map((p) => [p.prop, p.value]),
      ),
      status: !comp ? 'unregistered' : it.confidence === 'high' ? 'matched' : 'review',
    };
    // 타일이 겹친 구간에서 같은 요소가 두 번 잡히면 하나만 남긴다
    if (!labels.some((l) => l.componentId === label.componentId && iou(l, label) > 0.5)) labels.push(label);
  }
  return labels;
}
