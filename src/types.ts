export type LabelStatus = 'matched' | 'review' | 'unregistered';

export interface VariantDef {
  prop: string;
  options: string[];
}

export interface RefImage {
  id: string;
  dataUrl: string;
  /** 어떤 variant의 참고 이미지인지. 예: "variant=active" */
  variant?: string;
}

export interface CatalogComponent {
  id: string;
  codeName: string;
  figmaName: string;
  importPath: string;
  /** 피그마 요소에서 뽑은 CSS. 시안 픽셀과 대조하는 기준 */
  css: string;
  note?: string;
  /** false면 다른 컴포넌트 안에 포함되는 요소라 단독 라벨 대상이 아님 */
  labelable: boolean;
  variants: VariantDef[];
  refImages: RefImage[];
}

export interface Label {
  id: string;
  /** 원본 이미지 픽셀 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
  componentId: string | null;
  /** 카탈로그에 없는 요소의 메모용 이름 */
  freeName: string;
  props: Record<string, string>;
  status: LabelStatus;
}

export interface Screen {
  id: string;
  name: string;
  src: string;
  mime: string;
  width: number;
  height: number;
  /** 시안 배율 (1x, 2x, 3x) */
  scale: number;
  labels: Label[];
}
