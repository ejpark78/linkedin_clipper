import type { WikiDocsBook, ExportOptions } from '../types';
import { sanitizeFilename } from './base';
import { generateIndex } from '../generators';

const OBSIDIAN_API_URL = process.env.OBSIDIAN_API_URL || 'http://host.docker.internal:27123';

export async function exportToObsidian(
  book: WikiDocsBook,
  options: ExportOptions,
  apiKey: string
): Promise<void> {
  if (!apiKey) {
    throw new Error('Obsidian REST API 키가 제공되지 않았습니다.');
  }
  
  const folderName = sanitizeFilename(book.title);
  const folderPath = `/WikiDocs/${folderName}`;

  for (const chapter of book.chapters) {
    const filename = `${sanitizeFilename(chapter.title)}.md`;
    const filePath = `${folderPath}/${filename}`;
    const content = chapter.content;

    await createFile(filePath, content, 'text/markdown', apiKey);
  }
}

async function createFile(path: string, content: string, mimeType: string, apiKey: string): Promise<void> {
  const url = `${OBSIDIAN_API_URL}/vault${path}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Authorization': `Bearer ${apiKey}`
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`파일 생성 실패: ${path} - ${response.status} ${response.statusText}\n${errorText}`);
    }
  } catch (error) {
    console.error(`[Obsidian] Fetch error to ${url}:`, error);
    throw error;
  }
}
