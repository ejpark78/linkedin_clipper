"""split_chapter.py — PDF/EPUB chapter splitter.

Extracts page ranges from PDF files or chapter sections from EPUB files.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import fitz


@dataclass
class ChapterDef:
    title: str
    start_page: int
    end_page: int
    include: bool = True


@dataclass
class BookProfile:
    path: Path
    title: str
    page_count: int
    chapters: list[ChapterDef]
    body_font_size: float = 11.0


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name[:120]


def get_output_path(filename: str) -> str:
    name = filename.lower()
    for ext in ('.pdf', '.epub'):
        if name.endswith(ext):
            return filename[:-len(ext)].strip()
    return filename.strip()


class ChapterSplitter:
    """Split a PDF or EPUB into chapter-level files."""

    def __init__(self, raw_dir: str, output_dir: str):
        self.raw_dir = Path(raw_dir)
        self.output_dir = Path(output_dir)

    def split(self, filename: str, profile: BookProfile) -> list[Path]:
        filepath = self.raw_dir / filename
        if not filepath.exists():
            print(f"  ✗ File not found: {filepath}")
            return []

        if filename.lower().endswith('.epub'):
            return self._split_epub(filepath, profile)
        return self._split_pdf(filename, profile)

    def _split_pdf(self, pdf_name: str, profile: BookProfile) -> list[Path]:
        pdf_path = self.raw_dir / pdf_name
        book_dir = self.output_dir / get_output_path(pdf_name)
        book_dir.mkdir(parents=True, exist_ok=True)

        doc = fitz.open(str(pdf_path))
        chapter_paths = []

        for ch in profile.chapters:
            if not ch.include:
                continue

            title_clean = sanitize_filename(ch.title)
            ch_filename = f"{title_clean}.pdf"
            ch_path = book_dir / ch_filename

            from_p = ch.start_page - 1
            to_p = ch.end_page - 1

            if from_p < 0:
                from_p = 0
            if to_p >= doc.page_count:
                to_p = doc.page_count - 1
            if from_p > to_p:
                print(f"  ✗ Invalid range for '{ch.title}': {ch.start_page}–{ch.end_page}")
                continue

            new_doc = fitz.open()
            new_doc.insert_pdf(doc, from_page=from_p, to_page=to_p)
            new_doc.save(str(ch_path))
            new_doc.close()

            chapter_paths.append(ch_path)
            print(f"  ✓ {ch_filename}")

        doc.close()
        return chapter_paths

    def _split_epub(self, epub_path: Path, profile: BookProfile) -> list[Path]:
        import ebooklib
        from ebooklib import epub

        book = epub.read_epub(str(epub_path))
        book_dir = self.output_dir / get_output_path(epub_path.name)
        book_dir.mkdir(parents=True, exist_ok=True)

        docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))
        chapter_paths = []

        for ch in profile.chapters:
            if not ch.include:
                continue

            idx = ch.start_page - 1
            if idx < 0 or idx >= len(docs):
                print(f"  ✗ Invalid index for '{ch.title}': {ch.start_page}")
                continue

            content = docs[idx].get_content()
            title_clean = sanitize_filename(ch.title)
            ch_path = book_dir / f"{title_clean}.html"
            ch_path.write_bytes(content)
            chapter_paths.append(ch_path)
            print(f"  ✓ {title_clean}.html")

        return chapter_paths
