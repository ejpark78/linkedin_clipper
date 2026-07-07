/**
 * label-service.ts — Issue label classification (LLM + rule-based).
 *
 * Design context: Dual-strategy labeler. Primary: LLM-assisted
 * classification (type + area). Fallback: regex rule-based.
 * Used by GiteaClient.createIssue and ReleaseCoordinator.
 *
 * Dependencies: llm-backend (LLmBackend)
 */

import { LLmBackend } from './llm-backend';

interface LlmLabelResponse {
  type?: string;
  area?: string;
}

const VALID_TYPES = ['feature', 'bug', 'chore'] as const;
const VALID_AREAS = ['agent', 'wiki', 'crawler', 'ebook', 'viewer', 'infra'] as const;

export class LabelService {
  constructor(private readonly llmBackend: LLmBackend) {}

  async classifyWithLLM(title: string, body: string): Promise<{ type: string | null; area: string | null }> {
    const combo = title + '\n' + body;
    const truncated = combo.substring(0, 2000);
    const prompt = `<start_of_turn>user
Classify this issue into Type (feature|bug|chore) and Area (agent|wiki|crawler|ebook|viewer|infra|null).
Return ONLY a JSON object with keys "type" and "area". No other text.

Title: ${title}
Body: ${truncated}
<end_of_turn>
<start_of_turn>model
`;

    const raw = await this.llmBackend.generate(prompt, { numPredict: 512, timeout: 30000 });

    if (raw) {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      try {
        const parsed: LlmLabelResponse = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object') {
          const type = parsed.type && (VALID_TYPES as ReadonlyArray<string>).includes(parsed.type) ? parsed.type : null;
          const area = parsed.area && parsed.area !== 'null' && (VALID_AREAS as ReadonlyArray<string>).includes(parsed.area) ? parsed.area : null;
          if (type || area) return { type, area };
        }
      } catch (err) {
        console.warn(`LabelService: LLM response parse failed — ${err}`);
      }
    }

    return { type: null, area: null };
  }

  classifyByRule(title: string, body: string): string[] {
    const combo = title + '\n' + body;
    const labels: string[] = [];

    if (/^\[?feat/i.test(title) || /^feat\b/i.test(title)) labels.push('feature');
    else if (/^\[?fix/i.test(title) || /^fix\b/i.test(title) || /^\[?bug/i.test(title)) labels.push('bug');
    else labels.push('chore');

    if (/agents(?:\/|$)/.test(combo)) labels.push('agent');
    else if (/apps\/wiki(?:\/|$)/.test(combo)) labels.push('wiki');
    else if (/apps\/crawler(?:\/|$)/.test(combo)) labels.push('crawler');
    else if (/apps\/ebook(?:\/|$)/.test(combo)) labels.push('ebook');
    else if (/apps\/viewer(?:\/|$)/.test(combo)) labels.push('viewer');
    else if (/infra\//.test(combo)) labels.push('infra');

    return labels;
  }
}
