import type { WikiDocsBook } from '../types';
import { sanitizeFilename } from '../export/base';

export function generateIndex(book: WikiDocsBook, format: 'obsidian' | 'markdown' | 'joplin' = 'obsidian'): string {
  const lines: string[] = [];

  if (format === 'obsidian' || format === 'markdown') {
    lines.push(`# 📚 ${book.title}`, '', '## 📑 Chapters', '');
  } else if (format === 'joplin') {
    lines.push('# 📚 INDEX', '', `**${book.title}**`, '', '## 📑 Chapters', '');
  }

  for (const chapter of book.chapters) {
    const filename = sanitizeFilename(chapter.title);
    if (format === 'joplin') {
      lines.push(`- [${chapter.title}](#${filename.toLowerCase().replace(/\s+/g, '-')})`);
    } else {
      lines.push(`- [${chapter.title}](./${filename}.md)`);
    }
  }

  if (format === 'joplin') {
    lines.push('', '---', '');
    for (const chapter of book.chapters) {
      lines.push(`## ${chapter.title}`, '', `> Source: ${chapter.url}`, '');
    }
  }

  return lines.join('\n');
}
