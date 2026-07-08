export interface WikiDocsChapter {
  title: string;
  url: string;
  content: string;
}

export interface WikiDocsBook {
  id?: string;
  title: string;
  url?: string;
  chapters: WikiDocsChapter[];
}

export interface ExportOptions {
  target: 'obsidian' | 'joplin' | 'markdown';
  includeImages: boolean;
  addFrontmatter: boolean;
  createIndex: boolean;
}
