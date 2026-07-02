import type { SiteDescriptor } from "../../core/SiteRegistry";

export interface EbookMeta {
  title: string;
  bookTitle: string;
  chapterIndex: number;
  content: string;
  url?: string;
  publishedAt?: string;
}

export const descriptor: SiteDescriptor = {
  key: "ebook",
  name: "Ebook",
  favicon: "",
  indexName: "ebook",

  indexes: [
    {
      collection: "silver/ebook.contents",
      fields: { id: 1 },
      options: { unique: true },
    },
    { collection: "silver/ebook.contents", fields: { updatedAt: -1 } },
  ],

  targetLoader: {
    collectionName: "silver/ebook.contents",
    filterField: "id",
    buildDocument: (id, meta: EbookMeta) => ({
      id,
      title: meta.title || "Untitled",
      bookTitle: meta.bookTitle || "Unknown Book",
      chapterIndex: meta.chapterIndex ?? 0,
      content: meta.content || "",
      markdown: meta.content || "",
      url: meta.url || null,
      publishedAt: meta.publishedAt || new Date().toISOString(),
      updatedAt: new Date(),
    }),
  },
};
