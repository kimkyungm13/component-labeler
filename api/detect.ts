import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { DetectRequest } from '../src/detect';

const client = new Anthropic();

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          box: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              w: { type: 'integer' },
              h: { type: 'integer' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
          codeName: { type: 'string' },
          props: {
            type: 'array',
            items: {
              type: 'object',
              properties: { prop: { type: 'string' }, value: { type: 'string' } },
              required: ['prop', 'value'],
              additionalProperties: false,
            },
          },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
        required: ['box', 'codeName', 'props', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const SYSTEM = `당신은 모바일·웹 UI 시안 이미지에서 공통 컴포넌트를 찾아 코드 컴포넌트명으로 라벨링하는 도구입니다.
사용자는 컴포넌트 카탈로그(코드명, 피그마명, 생김새 설명, variant, 참고 이미지)와 시안 이미지 한 장을 줍니다.

규칙:
- 시안에서 카탈로그 컴포넌트와 같은 요소를 모두 찾아 각각 항목 하나로 냅니다. 같은 컴포넌트가 여러 번 나오면 각각 냅니다.
- box는 시안 이미지의 픽셀 좌표(왼쪽 위 기준 x, y, 너비 w, 높이 h)입니다. 컴포넌트 전체(라벨 텍스트를 포함하는 컴포넌트라면 라벨까지)를 딱 맞게 감쌉니다.
- codeName에는 카탈로그의 코드명을 그대로 씁니다. 카탈로그에 없지만 버튼·입력칸·칩·탭·바텀시트처럼 재사용 공통 컴포넌트로 보이는 요소는 codeName에 짧은 한국어 설명(예: "주황 CTA 버튼")을 쓰고 confidence는 low로 둡니다. 일회성 레이아웃, 사진, 아이콘, 일반 텍스트는 내지 않습니다.
- props에는 카탈로그에 정의된 variant 중 이미지로 판단되는 값만 넣습니다. 판단이 안 되면 비웁니다.
- 참고 이미지와 생김새가 분명히 같으면 confidence는 high, 비슷하지만 확신이 없으면 low입니다.`;

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function parseDataUrl(dataUrl: string): { media_type: ImageMediaType; data: string } {
  const [head, data] = dataUrl.split(',');
  const media_type = head.slice(5, head.indexOf(';')) as ImageMediaType;
  return { media_type, data };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원해요' });

  const password = process.env.APP_PASSWORD;
  if (password && req.headers['x-app-password'] !== password) {
    return res.status(401).json({ error: '비밀번호가 맞지 않아요' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(501).json({ error: 'AI 검출이 아직 설정되지 않았어요 (ANTHROPIC_API_KEY 없음)' });
  }

  const body = req.body as DetectRequest;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: '## 컴포넌트 카탈로그' }];
  for (const c of body.catalog) {
    const variants = c.variants.map((v) => `${v.prop}: ${v.options.join(' | ')}`).join(', ');
    content.push({
      type: 'text',
      text: [
        `### ${c.codeName} (피그마명: ${c.figmaName})`,
        `생김새: ${c.description}`,
        variants && `variant: ${variants}`,
        c.note && `비고: ${c.note}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    for (const ref of c.refImages) {
      content.push({ type: 'text', text: `${c.codeName} 참고 이미지${ref.variant ? ` (${ref.variant})` : ''}:` });
      content.push({ type: 'image', source: { type: 'base64', ...parseDataUrl(ref.dataUrl) } });
    }
  }
  content.push({
    type: 'text',
    text: `## 시안 이미지 (${body.image.width} x ${body.image.height} px)\n아래 시안에서 컴포넌트를 찾아 주세요.`,
  });
  content.push({ type: 'image', source: { type: 'base64', media_type: body.image.mediaType, data: body.image.data } });

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'AI가 이 이미지 처리를 거절했어요' });
    }
    const text = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(text && text.type === 'text' ? text.text : '{"items":[]}');
    return res.status(200).json(parsed);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: '요청이 많아요. 잠시 뒤 다시 시도해 주세요' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `AI 호출 실패: ${err.message}` });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : '알 수 없는 오류' });
  }
}
