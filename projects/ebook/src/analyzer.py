"""pdf_analyzer.py — Ebook PDF TOC analyzer and profile builder.

Extracts TOC structure, allows interactive chapter offset alignment, and prints summaries.
"""

import json
import os
import re
import sys
from pathlib import Path

import fitz

from .split_chapter import BookProfile, ChapterDef

EXCLUDE_TITLES = [
    "cover", "copyright", "table of contents", "contents",
    "index", "about the author", "about the authors", "colophon",
    "foreword",
]


class PDFAnalyzer:
    """Analyze a new PDF, extract TOC, and interactively build BookProfile."""

    def dump_all_summaries(self, data_dir: str):
        """Displays summaries of all PDF files inside a directory (Legacy analyze_pdfs.py)."""
        data_path = Path(data_dir)
        if not data_path.exists():
            print(f"Directory not found: {data_dir}")
            return

        pdfs = sorted(os.listdir(str(data_path)))
        results = {}
        for p in pdfs:
            if not p.endswith('.pdf'):
                continue
            doc = fitz.open(str(data_path / p))
            pages = doc.page_count
            toc = doc.get_toc()
            chapters = [(e[1], e[2]) for e in toc if e[0] == 1]
            results[p] = {'pages': pages, 'chapters': chapters[:20], 'total_chapters': len(chapters)}
            doc.close()

        for name, info in results.items():
            print(f"=== {name} ({info['pages']}p, {info['total_chapters']} chapters) ===")
            for title, page in info['chapters']:
                print(f"  {title} (p.{page})")
            print()

    def analyze(self, pdf_path: str, overwrite: bool = False) -> BookProfile | None:
        path = Path(pdf_path)
        if not path.exists():
            print(f"File or directory not found: {pdf_path}")
            sys.exit(1)

        if path.is_dir():
            print(f"Scanning directory: {path}")
            pdf_files = sorted(path.rglob("*.pdf"))
            epub_files = sorted(path.rglob("*.epub"))
            all_files = pdf_files + epub_files
            if not all_files:
                print(f"No PDF or EPUB files found under: {path}")
                return None

            last_profile = None
            for f in all_files:
                try:
                    last_profile = self.analyze(str(f), overwrite)
                except Exception as e:
                    print(f"Failed to analyze {f.name}: {e}")
            return last_profile

        # Early check for books.json existing configuration
        if not overwrite:
            books_path = path.parent / "books.json"
            if books_path.exists():
                try:
                    with open(str(books_path), encoding='utf-8') as f:
                        config = json.load(f)
                    if path.name in config:
                        print(
                            f"  Config for '{path.name}' already exists in books.json. "
                            "Skipping analysis (overwrite=False)."
                        )
                        return None

                except Exception as e:
                    print(f"  Failed to read books.json for skip check: {e}")

        if path.suffix.lower() == ".epub":
            return self._analyze_epub(path)

        doc = fitz.open(str(path))

        profile = BookProfile(
            path=path,
            title=path.name,
            page_count=doc.page_count,
            chapters=[]
        )

        print(f"\n{'=' * 60}")
        print(f"  Analyzing: {path.name} ({doc.page_count}p)")
        print(f"{'=' * 60}\n")

        toc = doc.get_toc()
        if not toc:
            print("No TOC found. Running regex-based chapter detection...")
            chapters = self._detect_chapters_regex(doc)
        else:
            has_part = any("part" in e[1].lower() for e in toc if e[0] == 1)
            if has_part:
                print(f"TOC found ({len(toc)} entries). Part structure detected — showing chapters:\n")
                chapters = self._build_part_chapters(toc, doc.page_count)
            else:
                print(f"TOC found ({len(toc)} entries). Level-1 chapters:\n")
                chapters = self._build_from_toc(toc, doc.page_count)

        header = f"{'':>3} {'Title':60s} {'Pages':>10s}  {'Include?'}"
        print(header)
        print("-" * 85)

        for i, (title, start, end, default) in enumerate(chapters):
            is_excluded = any(ex.lower() in title.lower() for ex in EXCLUDE_TITLES)
            default_include = default and not is_excluded
            default_label = "Y" if default_include else "n"

            label = f"  [{i+1:2d}]"
            pages_str = f"p.{start:3d}-{end-1:<3d}"
            prompt = f" include? [{default_label}] (ENTER=default, n=skip, q=quit): "

            # We assume interactive input, fallback to default if not in terminal
            if sys.stdin.isatty():
                ans = input(f"  {label} {title:60s} {pages_str}  {prompt}").strip().lower()
            else:
                ans = ''

            if ans == '' or ans == 'y':
                include = default_include
            elif ans == 'n':
                include = False
            elif ans == 'q':
                print("Aborted.")
                sys.exit(0)
            else:
                include = True

            profile.chapters.append(ChapterDef(
                title=title,
                start_page=start,
                end_page=end - 1,
                include=include,
            ))

        if sys.stdin.isatty():
            self._verify_offsets(doc, profile)

        profile.body_font_size = self._estimate_body_font(doc)
        doc.close()

        # Save configuration
        self._save_books_config(profile, path.parent)
        print("\nSaved to books.json")
        print(f"Estimated body font size: {profile.body_font_size:.1f}pt")

        return profile

    def _analyze_epub(self, epub_path: Path) -> BookProfile:
        import warnings

        import ebooklib
        from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
        from ebooklib import epub

        warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

        book = epub.read_epub(str(epub_path))
        docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

        profile = BookProfile(
            path=epub_path,
            title=epub_path.name,
            page_count=len(docs),
            chapters=[]
        )

        print(f"\n{'=' * 60}")
        print(f"  Analyzing EPUB: {epub_path.name} ({len(docs)} documents)")
        print(f"{'=' * 60}\n")

        for idx, item in enumerate(docs):
            content = item.get_content()
            soup = BeautifulSoup(content, "lxml")

            # Find title
            title = None
            h1 = soup.find("h1")
            if h1:
                title = h1.get_text().strip()
            if not title:
                title_tag = soup.find("title")
                if title_tag:
                    title = title_tag.get_text().strip()
            if not title:
                title = Path(item.get_name()).stem

            is_excluded = any(ex.lower() in title.lower() for ex in EXCLUDE_TITLES)
            include = not is_excluded

            # Using 1-indexed document positions for start_page / end_page mapping in EPUB
            profile.chapters.append(ChapterDef(
                title=title,
                start_page=idx + 1,
                end_page=idx + 1,
                include=include
            ))

            print(f"  [{idx+1:2d}] {title:60s} (Include: {include})")

        self._save_books_config(profile, epub_path.parent)
        print("\nSaved to books.json")
        return profile

    def _build_part_chapters(self, toc: list, total_pages: int) -> list:
        level1 = [e for e in toc if e[0] == 1]
        result = []
        for i, entry in enumerate(level1):
            level, title, page = entry
            next_l1_page = total_pages
            for j in range(i + 1, len(level1)):
                if level1[j][2] > page:
                    next_l1_page = level1[j][2]
                    break

            is_part = "part" in title.lower()

            if is_part:
                part_children = []
                for e in toc:
                    if e[0] != 2:
                        continue
                    if e[2] >= page and e[2] < next_l1_page:
                        part_children.append(e)

                if part_children:
                    m = re.search(r'(Part|PART)\s+([IVXLCDM]+|\d+)', title)
                    part_prefix = f"Part {m.group(2)}" if m else title.split(".")[0].strip()

                    for ci, (_, ch_title, ch_page) in enumerate(part_children):
                        ch_end = next_l1_page
                        if ci + 1 < len(part_children):
                            ch_end = part_children[ci + 1][2]
                        full_title = f"{part_prefix} - {ch_title}"
                        is_excluded = any(ex.lower() in ch_title.lower() for ex in EXCLUDE_TITLES)
                        result.append((full_title, ch_page, ch_end, not is_excluded))
                else:
                    is_excluded = any(ex.lower() in title.lower() for ex in EXCLUDE_TITLES)
                    result.append((title, page, next_l1_page, not is_excluded))
            else:
                is_excluded = any(ex.lower() in title.lower() for ex in EXCLUDE_TITLES)
                result.append((title, page, next_l1_page, not is_excluded))

        return result

    def _build_from_toc(self, toc: list, total_pages: int) -> list:
        chapters = []
        for i, entry in enumerate(toc):
            level, title, page = entry
            if level != 1:
                continue
            next_page = total_pages
            for j in range(i + 1, len(toc)):
                if toc[j][0] <= level:
                    next_page = toc[j][2]
                    break
            chapters.append((title, page, next_page, True))
        return chapters

    def _detect_chapters_regex(self, doc: fitz.Document) -> list:
        chapters = []
        for i in range(doc.page_count):
            page = doc[i]
            text = page.get_text("text")
            m = re.search(
                r'^(?:Chapter|CHAPTER|Part|PART)\s+(\d+|[IVXLCDM]+)[\.\s]',
                text, re.MULTILINE
            )
            if m:
                next_p = doc.page_count
                for j in range(i + 1, doc.page_count):
                    p2 = doc[j]
                    t2 = p2.get_text("text")
                    if re.search(r'^(?:Chapter|CHAPTER|Part|PART)\s+', t2, re.MULTILINE):
                        next_p = j + 1
                        break
                chapters.append((m.group(0).strip(), i + 1, next_p, True))
        return chapters

    def _verify_offsets(self, doc: fitz.Document, profile: BookProfile):
        print("\n--- Offset Verification ---")
        any_offset = False
        for ch in profile.chapters:
            if not ch.include:
                continue
            offset = self._find_offset(doc, ch)
            if offset != 0:
                any_offset = True
                print(f"  '{ch.title[:50]}' p.{ch.start_page} → actual p.{ch.start_page + offset}")
                fix = input(f"    Apply offset {offset:+d}? [y/N] ").strip().lower()
                if fix.startswith('y'):
                    ch.start_page += offset
                    ch.end_page += offset
        if not any_offset:
            print("  All chapter titles verified (no offset).")

    def _find_offset(self, doc: fitz.Document, ch: ChapterDef) -> int:
        page_idx = ch.start_page - 1
        title_key = ch.title[:40].strip().lower()
        for offset in range(-2, 4):
            pg = page_idx + offset
            if pg < 0 or pg >= doc.page_count:
                continue
            text = doc[pg].get_text("text").lower()
            if title_key in text:
                return offset
        return 0

    def _estimate_body_font(self, doc: fitz.Document) -> float:
        sizes = []
        for pg_idx in [10, 30, 50, 80, 100]:
            if pg_idx >= doc.page_count:
                continue
            page = doc[pg_idx]
            blocks = page.get_text("dict")["blocks"]
            for block in blocks:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        s = span.get("size", 0)
                        if 8 < s < 16:
                            sizes.append(s)
        if not sizes:
            return 11.0
        sizes.sort()
        return sizes[len(sizes) // 2]

    def _save_books_config(self, profile: BookProfile, raw_dir: Path):
        books_path = raw_dir / "books.json"
        config = {}
        if books_path.exists():
            with open(str(books_path), encoding='utf-8') as f:
                config = json.load(f)

        pdf_name = profile.path.name
        existing = config.get(pdf_name)
        if existing:
            if sys.stdin.isatty():
                prompt = f"  Config for '{pdf_name}' already exists in books.json. Overwrite? [y/N] "
                ans = input(prompt).strip().lower()
                if not ans.startswith('y'):
                    print("  Skipped saving to books.json.")
                    return
            else:
                print(
                    f"  Config for '{pdf_name}' already exists in books.json. "
                    "Skipping overwrite (non-interactive mode)."
                )
                return


        chapters = []
        for ch in profile.chapters:
            if not ch.include:
                continue
            chapters.append({
                "title": ch.title,
                "start": ch.start_page,
                "end": ch.end_page + 1,
            })

        config[pdf_name] = {"chapters": chapters}

        tmp = books_path.with_suffix('.json.tmp')
        with open(str(tmp), 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        tmp.rename(books_path)
