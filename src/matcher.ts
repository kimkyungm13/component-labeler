import type { CatalogComponent, Label } from './types';
import { loadImage, uid } from './util';

/**
 * 카탈로그 CSS에서 눈에 보이는 특징(크기, 배경색, 테두리, 모서리, 투명도)을 뽑아
 * 시안 픽셀에서 같은 특징을 가진 영역을 찾는다. 모든 처리는 브라우저 안에서 한다.
 *
 * 지원하는 CSS
 * - width, height, min-width (px)
 * - background / background-color, border / border-color / border-width, opacity
 * - 주석 `/* prop=value *\/` 아래 선언은 그 variant에만 적용된다 (카탈로그에 정의된 variant prop만)
 * - --label-above: 위쪽에 붙는 라벨 높이(px). 위에 글자가 있으면 박스를 그만큼 늘린다
 * - --row-siblings: 같은 줄에 반복되는 형제 요소 테두리(예: 1px solid #d0d1d2). 찾으면 하나로 묶는다
 */

type RGB = [number, number, number];

interface Spec {
  width?: number;
  height?: number;
  minWidth?: number;
  background?: RGB;
  borderColor?: RGB;
  borderWidth: number;
  opacity: number;
  labelAbove: number;
  rowSiblings?: RGB;
}

interface VariantSpec {
  props: Record<string, string>;
  spec: Spec;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Hit extends Box {
  componentId: string;
  props: Record<string, string>;
  /** 0~1, 클수록 CSS와 잘 맞음 */
  score: number;
}

const WHITE: RGB = [255, 255, 255];

function parseColor(value: string): RGB | undefined {
  const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
  }
  const rgb = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (/\bwhite\b/i.test(value)) return [255, 255, 255];
  if (/\bblack\b/i.test(value)) return [0, 0, 0];
  return undefined;
}

const px = (value: string) => {
  const m = value.match(/(-?[\d.]+)px/);
  return m ? Number(m[1]) : undefined;
};

function applyDeclarations(spec: Spec, text: string) {
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    switch (prop) {
      case 'width':
        spec.width = px(value);
        break;
      case 'height':
        spec.height = px(value);
        break;
      case 'min-width':
        spec.minWidth = px(value);
        break;
      case 'background':
      case 'background-color':
        spec.background = parseColor(value);
        break;
      case 'border':
        if (/none|\b0(px)?\b/.test(value) && !parseColor(value)) {
          spec.borderColor = undefined;
        } else {
          spec.borderColor = parseColor(value) ?? spec.borderColor;
          spec.borderWidth = px(value) ?? spec.borderWidth;
        }
        break;
      case 'border-color':
        spec.borderColor = parseColor(value);
        break;
      case 'border-width':
        spec.borderWidth = px(value) ?? spec.borderWidth;
        break;
      case 'opacity':
        spec.opacity = Number(value) || 1;
        break;
      case '--label-above':
        spec.labelAbove = px(value) ?? 0;
        break;
      case '--row-siblings':
        spec.rowSiblings = parseColor(value);
        break;
    }
  }
}

/** CSS를 기본 특징 + variant별 특징으로 나눈다 */
export function parseCss(css: string, variantProps: string[]): VariantSpec[] {
  // 선택자 블록이 있으면 중괄호만 걷어낸다
  const body = css.replace(/[^{};/]*\{/g, '').replace(/\}/g, ';');
  const parts = body.split(/\/\*([\s\S]*?)\*\//);
  const base: Spec = { borderWidth: 1, opacity: 1, labelAbove: 0 };
  const variants: { props: Record<string, string>; text: string }[] = [];
  applyDeclarations(base, parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const m = parts[i].trim().match(/^([\w-]+)\s*=\s*"?([\w-]+)"?$/);
    if (m && variantProps.includes(m[1])) variants.push({ props: { [m[1]]: m[2] }, text: parts[i + 1] });
    else if (variants.length) variants[variants.length - 1].text += parts[i + 1];
    else applyDeclarations(base, parts[i + 1]);
  }
  if (!variants.length) return [{ props: {}, spec: base }];
  return variants.map((v) => {
    const spec = { ...base };
    applyDeclarations(spec, v.text);
    return { props: v.props, spec };
  });
}

/** 흰 바탕 위에 투명도를 적용했을 때 보이는 색 */
const blend = (c: RGB, opacity: number): RGB => c.map((v, i) => Math.round(v * opacity + WHITE[i] * (1 - opacity))) as RGB;

/**
 * 픽셀이 목표색 쪽에 있는지 본다. 흰 바탕과 목표색을 잇는 선 위에서 얼마나 목표색 쪽인지(t)와
 * 선에서 얼마나 벗어났는지(dist)로 판단해, 테두리 안티앨리어싱도 잡는다.
 */
function makeMask(data: Uint8ClampedArray, n: number, target: RGB, tMin: number): Uint8Array {
  const mask = new Uint8Array(n);
  const d = [target[0] - 255, target[1] - 255, target[2] - 255];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (len2 < 100) return mask; // 흰색에 가까운 색은 바탕과 구분할 수 없다
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] - 255;
    const g = data[i * 4 + 1] - 255;
    const b = data[i * 4 + 2] - 255;
    const t = (r * d[0] + g * d[1] + b * d[2]) / len2;
    if (t < tMin || t > 1.35) continue;
    const er = r - t * d[0];
    const eg = g - t * d[1];
    const eb = b - t * d[2];
    if (er * er + eg * eg + eb * eb < 28 * 28) mask[i] = 1;
  }
  return mask;
}

interface Component extends Box {
  count: number;
}

function components(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const result: Component[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;
    while (top) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 8방향으로 이어 붙여 둥근 모서리의 끊김을 막는다
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    if (count >= 8) result.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
  }
  return result;
}

const tolerance = (expected: number, scale: number) => Math.max(2 * scale, expected * 0.08);

/** 크기가 얼마나 맞는지 0~1 */
function sizeScore(actual: number, expected: number | undefined, scale: number): number {
  if (expected === undefined) return 1;
  const e = expected * scale;
  const diff = Math.abs(actual - e);
  const tol = tolerance(e, scale);
  return diff > tol ? -1 : 1 - (diff / tol) * 0.5;
}

function find(
  spec: Spec,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): (Box & { score: number })[] {
  const outlined = !!spec.borderColor;
  const color = outlined ? spec.borderColor! : spec.background;
  if (!color) return [];
  const target = blend(color, spec.opacity);
  const mask = makeMask(data, width * height, target, outlined ? 0.4 : 0.6);
  const hits: (Box & { score: number })[] = [];
  for (const c of components(mask, width, height)) {
    const sw = sizeScore(c.w, spec.width, scale);
    const sh = sizeScore(c.h, spec.height, scale);
    if (sw < 0 || sh < 0) continue;
    if (spec.width === undefined && c.w < Math.max(spec.minWidth ?? 0, spec.height ?? 0) * scale) continue;
    const fill = c.count / (c.w * c.h);
    if (outlined) {
      // 테두리만 있는 상자는 속이 비어 있어야 한다
      const perimeter = 2 * (c.w + c.h) * spec.borderWidth * scale;
      if (fill > 0.5 || c.count < perimeter * 0.6) continue;
    } else if (fill < 0.6) {
      continue;
    }
    hits.push({ x: c.x, y: c.y, w: c.w, h: c.h, score: (sw + sh) / 2 });
  }
  return hits;
}

/** 위쪽 띠에 글자(진한 픽셀)가 있는지 */
function hasInkAbove(data: Uint8ClampedArray, width: number, box: Box, gap: number): boolean {
  const top = Math.max(0, box.y - gap);
  for (let y = top; y < box.y; y++) {
    for (let x = box.x; x < box.x + Math.min(box.w, gap * 6); x++) {
      const i = (y * width + x) * 4;
      if (data[i] + data[i + 1] + data[i + 2] < 300) return true;
    }
  }
  return false;
}

const overlapRatio = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
};

/** 시안 너비로 배율을 짐작한다 (360~390 → 1x, 720~780 → 2x, 1080~1170 → 3x) */
export const guessScale = (width: number) => Math.max(1, Math.round(width / 390));

export async function matchByCss(
  src: string,
  width: number,
  height: number,
  catalog: CatalogComponent[],
  scale: number,
): Promise<Label[]> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);

  const hits: Hit[] = [];
  for (const comp of catalog) {
    if (!comp.labelable || !comp.css.trim()) continue;
    for (const { props, spec } of parseCss(comp.css, comp.variants.map((v) => v.prop))) {
      for (const box of find(spec, data, width, height, scale)) {
        let hit: Hit = { ...box, componentId: comp.id, props };
        if (spec.rowSiblings) {
          // 같은 줄의 형제 버튼을 찾아 하나로 묶는다
          const siblings = find({ ...spec, borderColor: spec.rowSiblings, background: undefined, width: undefined }, data, width, height, scale);
          const gap = 24 * scale;
          let changed = true;
          while (changed) {
            changed = false;
            for (const s of siblings) {
              const sameRow = Math.abs(s.y - hit.y) <= 2 * scale && Math.abs(s.h - hit.h) <= 2 * scale;
              const touching = s.x <= hit.x + hit.w + gap && s.x + s.w >= hit.x - gap;
              const inside = s.x >= hit.x && s.x + s.w <= hit.x + hit.w;
              if (sameRow && touching && !inside) {
                const x = Math.min(hit.x, s.x);
                const r = Math.max(hit.x + hit.w, s.x + s.w);
                hit = { ...hit, x, w: r - x };
                changed = true;
              }
            }
          }
        }
        const above = Math.round(spec.labelAbove * scale);
        if (above && hasInkAbove(data, width, hit, above)) {
          hit = { ...hit, y: Math.max(0, hit.y - above), h: hit.h + Math.min(above, hit.y) };
        }
        hits.push(hit);
      }
    }
  }

  // 큰 것(묶음)부터 남기고, 그 안에 대부분 들어가는 작은 후보는 버린다. 같은 자리 후보는 점수 높은 쪽
  hits.sort((a, b) => b.w * b.h - a.w * a.h || b.score - a.score);
  const kept: Hit[] = [];
  for (const h of hits) {
    const clash = kept.find((k) => overlapRatio(k, h) > 0.7);
    if (!clash) kept.push(h);
    else if (clash.componentId === h.componentId && Math.abs(clash.w * clash.h - h.w * h.h) < clash.w * clash.h * 0.1 && h.score > clash.score) {
      kept[kept.indexOf(clash)] = h;
    }
  }

  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  return kept.map((h) => ({
    id: uid(),
    x: h.x,
    y: h.y,
    w: h.w,
    h: h.h,
    componentId: h.componentId,
    freeName: '',
    props: h.props,
    status: h.score >= 0.75 ? 'matched' : 'review',
  }));
}
