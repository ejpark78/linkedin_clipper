import * as fs from 'fs';
import * as path from 'path';
import type { WikiDocsBook, WikiDocsChapter } from '../types';

export function loadBookFromDirectory(directoryPath: string): WikiDocsBook {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`디렉터리가 존재하지 않습니다: ${directoryPath}`);
  }

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new Error(`디렉터리 경로가 아닙니다: ${directoryPath}`);
  }

  const bookTitle = path.basename(directoryPath);
  const files = fs.readdirSync(directoryPath);

  // .md 파일 필터링 (INDEX.md나 임시 파일 제외)
  const allMdFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file, ext).toUpperCase();
    return ext === '.md' && name !== 'INDEX' && name !== 'README';
  });

  // 동일한 챕터에 번역본(.en-ko.md)이 존재하는 경우, 원본(.md)은 배제하고 번역본만 유지
  const hasEnKo = new Set<string>();
  for (const file of allMdFiles) {
    if (file.toLowerCase().endsWith('.en-ko.md')) {
      const base = file.slice(0, -'.en-ko.md'.length).toLowerCase();
      hasEnKo.add(base);
    }
  }

  const mdFiles = allMdFiles.filter(file => {
    if (file.toLowerCase().endsWith('.en-ko.md')) {
      return true;
    }
    const ext = path.extname(file);
    const base = file.slice(0, -ext.length).toLowerCase();
    if (hasEnKo.has(base)) {
      return false;
    }
    return true;
  });


  // 챕터 파일 정렬 (기본 정렬 사용하되 숫자가 올바르게 정렬되도록 사전순 정렬)
  mdFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const chapters: WikiDocsChapter[] = [];

  for (const file of mdFiles) {
    const filePath = path.join(directoryPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = path.basename(file, path.extname(file));

    chapters.push({
      title,
      url: `file://${filePath}`,
      content
    });
  }

  return {
    title: bookTitle,
    chapters
  };
}

export function listAvailableBooks(basePath: string): string[] {
  if (!fs.existsSync(basePath)) {
    return [];
  }
  return fs.readdirSync(basePath).filter(file => {
    const fullPath = path.join(basePath, file);
    try {
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });
}
