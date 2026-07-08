"""PDF ebook process entrypoint.

Refactored to merge commands and entrypoint into a single file and remove translation features.
Implemented with clean OOP structures (EbookPipeline and EbookCLI).
"""

import argparse
import json
import sys
from pathlib import Path

from .analyzer import PDFAnalyzer
from .html_parser import HTMLConverter
from .markdown_parser import HTMLToMarkdownConverter
from .split_chapter import BookProfile, ChapterDef, ChapterSplitter, get_output_path


class EbookPipeline:
    """Core domain business logic runner for the ebook processing pipeline."""

    def __init__(self, raw_dir: str, out_dir: str):
        self.raw_dir = Path(raw_dir)
        self.out_dir = Path(out_dir)

    def load_books_config(self, books_json_path: Path) -> dict:
        if books_json_path.exists():
            with open(str(books_json_path), encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _collect_files(self, suffixes: list[str], *dirs: str) -> list[Path]:
        files = []
        for suf in suffixes:
            for d in dirs:
                search_dir = Path(d)
                if search_dir.exists():
                    files.extend(list(search_dir.glob(f"**/*.{suf}")))
        files = [p for p in files if "raw" not in p.resolve().parts]
        files = list({p.resolve(): p for p in files}.values())
        return files

    def _resolve_file_arg(self, name: str, data_dir: str) -> Path | None:
        p = Path(name)
        if p.exists():
            return p
        alt = Path(data_dir) / name
        if alt.exists():
            return alt
        return None

    def run_summary(self) -> None:
        PDFAnalyzer().dump_all_summaries(str(self.out_dir))

    def run_analyze(self, target: str | None, overwrite: bool) -> None:
        if target is True or target == "all" or target == "" or target is None:
            target_path = self.raw_dir
        else:
            resolved = self._resolve_file_arg(target, str(self.raw_dir))
            if resolved:
                target_path = resolved
            else:
                target_path = Path(target)
                if not target_path.exists():
                    # Fallback to output directory check
                    resolved_out = self._resolve_file_arg(target, str(self.out_dir))
                    if resolved_out:
                        target_path = resolved_out

        if not target_path.exists():
            print(f"Path not found: {target if target else self.raw_dir}")
            sys.exit(1)

        PDFAnalyzer().analyze(str(target_path), overwrite=overwrite)

    def run_to_html(self) -> None:
        files = self._collect_files(["pdf", "epub"], str(self.out_dir))
        if not files:
            print(f"No PDF/EPUB files found in {self.out_dir}")
            return

        for f in files:
            print(f"Converting {f.name} to HTML...")
            if f.suffix.lower() == ".epub":
                import ebooklib
                from ebooklib import epub

                book = epub.read_epub(str(f))
                out_dir = f.parent
                docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))
                for item in docs:
                    content = item.get_content()
                    name = Path(item.get_name()).name
                    ch_path = out_dir / name
                    ch_path.write_bytes(content)
                    print(f"  ✓ Extracted HTML: {name}")
                book.close()
            else:
                converter = HTMLConverter(str(f.parent))
                converter.convert(f)

    def run_to_md(self) -> None:
        files = self._collect_files(["html", "pdf", "epub"], str(self.out_dir))
        if not files:
            print(f"No HTML/PDF/EPUB files found in {self.out_dir}")
            return

        for f in files:
            print(f"Converting {f.name} to Markdown...")
            if f.suffix.lower() == ".epub":
                import ebooklib
                from ebooklib import epub

                book = epub.read_epub(str(f))
                docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))
                md_converter = HTMLToMarkdownConverter(str(f.parent))
                for item in docs:
                    content = item.get_content()
                    name = Path(item.get_name()).name
                    html_path = f.parent / name
                    html_path.write_bytes(content)
                    print(f"  Extracted HTML: {name}")
                    md_converter.convert(html_path)
                book.close()
            elif f.suffix.lower() == ".pdf":
                print(f"  Converting PDF→HTML→MD: {f.name}")
                html_converter = HTMLConverter(str(f.parent))
                html_path = html_converter.convert(f)
                md_converter = HTMLToMarkdownConverter(str(f.parent))
                md_converter.convert(html_path)
            else:
                converter = HTMLToMarkdownConverter(str(f.parent))
                converter.convert(f)

    def run_split(self) -> None:
        books_cfg = self.load_books_config(self.raw_dir / "books.json")

        source_files = list(self.raw_dir.glob("*.pdf")) + list(self.raw_dir.glob("*.epub"))
        if not source_files:
            print(f"No PDF/EPUB files found in {self.raw_dir}")
            return

        splitter = ChapterSplitter(str(self.raw_dir), str(self.out_dir))

        for src in source_files:
            name = src.name
            print(f"\nProcessing {name}...")

            cfg = books_cfg.get(name)
            if not cfg:
                print(f"  No configuration found for {name}. Skip.")
                continue

            chapters = []
            for item in cfg["chapters"]:
                if isinstance(item, list) or isinstance(item, tuple):
                    title, start, end = item
                    include = True
                else:
                    title = item["title"]
                    start = item["start"]
                    end = item["end"]
                    include = item.get("include", True)

                chapters.append(ChapterDef(
                    title=title,
                    start_page=start,
                    end_page=end - 1,
                    include=include,
                ))

            profile = BookProfile(
                path=src,
                title=get_output_path(name),
                page_count=0,
                chapters=chapters,
            )

            splitter.split(name, profile)


class EbookCLI:
    """CLI Driver class that parses user arguments and routes to the EbookPipeline."""

    def __init__(self):
        self.parser = argparse.ArgumentParser(description="Ebook PDF Process Pipeline.")
        self._setup_arguments()

    def _setup_arguments(self) -> None:
        self.parser.add_argument("--raw", default="data/raw", help="Directory of raw PDF/EPUB files")
        self.parser.add_argument("--path", default="data/output", help="Working path for inputs and outputs")

        self.parser.add_argument("--summary", action="store_true", help="Print summary of all PDFs")
        self.parser.add_argument(
            "--analyze",
            nargs="?",
            const="all",
            default=None,
            help="Analyze specified PDF/EPUB structure or directory",
        )
        self.parser.add_argument(
            "--overwrite",
            action="store_true",
            default=False,
            help="Overwrite existing configuration in books.json if already analyzed",
        )
        self.parser.add_argument(
            "--to-html",
            action="store_true",
            help="Convert all PDF/EPUB files under data directory to HTML",
        )
        self.parser.add_argument(
            "--to-md",
            action="store_true",
            help="Convert all HTML/PDF/EPUB files under data directory to Markdown",
        )
        self.parser.add_argument(
            "--split",
            action="store_true",
            help="Split PDF/EPUB into chapter files",
        )

    def run(self) -> None:
        args = self.parser.parse_args()
        pipeline = EbookPipeline(raw_dir=args.raw, out_dir=args.path)

        if args.summary:
            pipeline.run_summary()
            sys.exit(0)
        elif args.to_html:
            pipeline.run_to_html()
            sys.exit(0)
        elif args.to_md:
            pipeline.run_to_md()
            sys.exit(0)
        elif args.split:
            pipeline.run_split()
            sys.exit(0)
        elif args.analyze is not None or "--analyze" in sys.argv:
            pipeline.run_analyze(target=args.analyze, overwrite=args.overwrite)
            sys.exit(0)
        else:
            self.parser.print_help()


def main():
    cli = EbookCLI()
    cli.run()


if __name__ == "__main__":
    main()
