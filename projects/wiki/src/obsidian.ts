import * as path from 'path';
import { WikiDocsBook } from './joplin'; // 기존의 WikiDocsBook 타입을 가져옵니다.

export class ObsidianClipperService {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiKey: string, apiUrl?: string) {
    if (!apiKey) {
      throw new Error('Obsidian REST API 키가 제공되지 않았습니다.');
    }
    this.apiKey = apiKey;
    this.apiUrl = apiUrl || process.env.OBSIDIAN_API_URL || 'http://host.docker.internal:27123';
  }

  /**
   * 로컬 책 데이터의 챕터 마크다운 파일들을 Obsidian Local REST API를 사용하여 지정 폴더에 생성/수정합니다.
   */
  public async pushBook(book: WikiDocsBook, toPath?: string): Promise<void> {
    // 저장 대상 폴더 지정
    const sanitizedTitle = ObsidianClipperService.sanitizeFilename(book.title);
    const targetFolder = toPath || sanitizedTitle;
    const folderPath = `/WikiDocs/${targetFolder}`;

    console.log(`[ObsidianService] Starting export to Obsidian for book "${book.title}" in folder: ${folderPath}`);

    for (const chapter of book.chapters) {
      const filename = `${ObsidianClipperService.sanitizeFilename(chapter.title)}.md`;
      const filePath = `${folderPath}/${filename}`;
      const content = chapter.content;

      console.log(`   [Obsidian] Creating file: ${filePath}`);
      await this.createFile(filePath, content, 'text/markdown');
    }

    console.log('[ObsidianService] Export finished successfully.');
  }

  private async createFile(filePath: string, content: string, mimeType: string): Promise<void> {
    // host.docker.internal Gateway 등을 활용한 호출 경로 확보
    const url = `${this.apiUrl}/vault${filePath}`;

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: content,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`파일 생성 실패: ${filePath} - ${response.status} ${response.statusText}\n${errorText}`);
      }
    } catch (error: any) {
      console.error(`[Obsidian] Fetch error to ${url}:`, error.message);
      throw error;
    }
  }

  private static sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_');
  }
}
