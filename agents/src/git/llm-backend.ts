/**
 * llm-backend.ts — LLM backend interface and implementations.
 *
 * Design context: Supports both Ollama and llama.cpp backends with
 * a common LLmBackend interface. Used by LabelService and
 * ReleaseCoordinator for AI-assisted classification and reporting.
 *
 * Dependencies: none (uses global fetch)
 */

export interface LLmBackend {
  generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null>;
}

interface OllamaGenerateResponse {
  response?: string;
  thinking?: string;
}

interface LlamaCppCompletionResponse {
  choices?: Array<{ text?: string }>;
}

export class OllamaBackend implements LLmBackend {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false,
            options: { num_predict: options.numPredict },
          }),
          signal: AbortSignal.timeout(Math.min(options.timeout, 30000)),
        });
        if (!res.ok) {
          if (attempt === 0) console.warn(`OllamaBackend: HTTP ${res.status}, retrying...`);
          continue;
        }
        const data = (await res.json()) as OllamaGenerateResponse;
        const responseText = (data.response || '').trim();
        let text = responseText;
        if (!text) {
          const thinkingText = (data.thinking || '').trim();
          if (thinkingText) {
            const lines = thinkingText.split('\n').filter((l: string) => l.trim());
            text = lines[lines.length - 1]?.trim() || '';
          }
        }
        if (text) return text;
      } catch (err) {
        if (attempt === 0) {
          console.warn(`OllamaBackend: attempt ${attempt + 1} failed — ${err}`);
        }
      }
    }
    return null;
  }
}

export class LlamaCppBackend implements LLmBackend {
  constructor(private readonly baseUrl: string) {}

  async generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          stream: false,
          max_tokens: options.numPredict,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(options.timeout),
      });
      if (!res.ok) {
        console.warn(`LlamaCppBackend: HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as LlamaCppCompletionResponse;
      return (data.choices?.[0]?.text || '').trim() || null;
    } catch (err) {
      console.warn(`LlamaCppBackend: request failed — ${err}`);
      return null;
    }
  }
}
