import JSZip from 'jszip';
import { labelText } from './catalog';
import type { CatalogComponent, LabelStatus, Screen } from './types';
import { loadImage } from './util';

export const STATUS_COLOR: Record<LabelStatus, string> = {
  matched: '#2563eb',
  review: '#db2777',
  unregistered: '#6b7280',
};

export const STATUS_TEXT: Record<LabelStatus, string> = {
  matched: '매칭됨',
  review: '확인 필요',
  unregistered: '미등록',
};

const FONT_FAMILY = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 원본과 같은 해상도로 라벨을 그린 PNG를 만든다 */
export async function renderLabeled(screen: Screen, catalog: CatalogComponent[]): Promise<Blob> {
  const img = await loadImage(screen.src);
  const { width, height } = screen;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);

  // 1x(360~375px) 시안 기준 크기를 해상도에 맞춰 키운다
  const s = Math.min(4, Math.max(1, width / 375));
  const fontSize = Math.round(11 * s);
  const pad = Math.round(4 * s);
  const tagH = fontSize + pad * 2;
  ctx.font = `600 ${fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';

  const placed: Rect[] = [];
  const legend: { no: number; text: string; color: string }[] = [];

  screen.labels.forEach((label, i) => {
    const color = STATUS_COLOR[label.status];
    const text = labelText(label, catalog);

    ctx.setLineDash(label.status === 'unregistered' ? [4 * s, 3 * s] : []);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = color;
    ctx.strokeRect(label.x, label.y, label.w, label.h);
    ctx.setLineDash([]);

    const tagW = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const clamp = (r: Rect): Rect => ({
      ...r,
      x: Math.max(0, Math.min(width - r.w, r.x)),
      y: Math.max(0, Math.min(height - r.h, r.y)),
    });
    const candidates: Rect[] = [
      { x: label.x, y: label.y - tagH, w: tagW, h: tagH },
      { x: label.x, y: label.y + label.h, w: tagW, h: tagH },
      { x: label.x + label.w - tagW, y: label.y - tagH, w: tagW, h: tagH },
      { x: label.x + label.w - tagW, y: label.y + label.h, w: tagW, h: tagH },
    ].map(clamp);
    const spot = candidates.find((c) => !placed.some((p) => overlaps(c, p)));

    if (spot) {
      placed.push(spot);
      ctx.fillStyle = color;
      ctx.fillRect(spot.x, spot.y, spot.w, spot.h);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, spot.x + pad, spot.y + tagH / 2);
      return;
    }

    // 자리가 없으면 번호 마커 + 범례로 바꾼다
    const no = i + 1;
    const r = tagH / 2;
    const cx = Math.max(r, Math.min(width - r, label.x));
    const cy = Math.max(r, Math.min(height - r, label.y));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(String(no), cx, cy);
    ctx.textAlign = 'left';
    placed.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
    legend.push({ no, text, color });
  });

  if (legend.length) {
    const rowH = tagH;
    const lines = legend.map((l) => `${l.no}. ${l.text}`);
    const boxW = Math.ceil(Math.max(...lines.map((t) => ctx.measureText(t).width))) + pad * 4;
    const boxH = rowH * lines.length + pad * 2;
    const bx = width - boxW - pad * 2;
    const by = height - boxH - pad * 2;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.lineWidth = s;
    ctx.strokeStyle = '#111';
    ctx.strokeRect(bx, by, boxW, boxH);
    lines.forEach((t, i) => {
      ctx.fillStyle = legend[i].color;
      ctx.fillText(t, bx + pad * 2, by + pad + rowH * i + rowH / 2);
    });
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 생성 실패'))), 'image/png'),
  );
}

async function originalPng(screen: Screen): Promise<Blob> {
  if (screen.mime === 'image/png') return (await fetch(screen.src)).blob();
  const img = await loadImage(screen.src);
  const canvas = document.createElement('canvas');
  canvas.width = screen.width;
  canvas.height = screen.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 생성 실패'))), 'image/png'),
  );
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'screen';

export async function buildZip(screens: Screen[], catalog: CatalogComponent[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const screen of screens) {
    let name = safeName(screen.name);
    for (let n = 2; used.has(name); n++) name = `${safeName(screen.name)}_${n}`;
    used.add(name);
    zip.file(`${name}_original.png`, await originalPng(screen));
    zip.file(`${name}_labeled.png`, await renderLabeled(screen, catalog));
  }
  return zip.generateAsync({ type: 'blob' });
}
