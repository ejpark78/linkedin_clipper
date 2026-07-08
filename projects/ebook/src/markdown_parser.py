"""HTML to Markdown Converter Module.

This script parses structured XHTML files, separates embedded base64 images into
standalone image files, and converts the clean XHTML structures into standard
GitHub Flavored Markdown (GFM).
"""

import base64
import re
from pathlib import Path

import markdownify
from bs4 import BeautifulSoup


class CustomMarkdownConverter(markdownify.MarkdownConverter):
    """Custom converter to guarantee explicit rendering of certain tags like img."""

    def convert_img(self, el, text, *args, **kwargs):
        src = el.get("src", "")
        alt = el.get("alt", "") or "image"
        # Return standard markdown image format
        return f"![{alt}]({src})"


class HTMLToMarkdownConverter:
    """Converter class to parse clean XHTML, extract images, and generate Markdown."""

    def __init__(self, output_dir: str | Path):
        self.output_dir = Path(output_dir)

    def convert(self, html_path: Path) -> Path:
        """Converts an HTML file to Markdown and saves it with a .md extension in the same directory."""
        if not html_path.exists():
            raise FileNotFoundError(f"HTML file not found: {html_path}")

        print(f"Reading HTML from: {html_path}")
        with open(html_path, encoding="utf-8") as f:
            html_content = f.read()

        soup = BeautifulSoup(html_content, "lxml")

        # 1. Remove <style> and <script> tags entirely so their inner CSS/JS text is not converted to markdown
        for tag in soup(["style", "script"]):
            tag.decompose()

        # 2. Remove page separators (e.g. <div class="page-separator">Page 2</div>)
        for separator in soup.find_all(class_="page-separator"):
            separator.decompose()

        # 3. Extract Base64 Images to files
        self._extract_base64_images(soup, html_path)

        import html

        # 4. Convert to Markdown using CustomMarkdownConverter
        # This guarantees standard Markdown output and keeps image/table tags intact
        markdown_text = CustomMarkdownConverter(
            heading_style=markdownify.ATX,
            bullets="-",
            strip=["script", "style"],
            wrap=False
        ).convert(str(soup))

        # Decode HTML entities into proper Unicode characters
        markdown_text = html.unescape(markdown_text)

        # 5. Clean up markdown text layout
        markdown_text = self._cleanup_markdown(markdown_text)

        # Output Markdown file path (alongside the input HTML)
        md_path = html_path.with_suffix('.md')
        md_path.parent.mkdir(parents=True, exist_ok=True)

        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown_text)

        print(f"Saved Markdown to: {md_path}")
        return md_path

    def _extract_base64_images(self, soup: BeautifulSoup, html_path: Path):
        """Finds all base64-encoded images in the HTML, saves them to an 'images' folder, and updates the src."""
        images_dir = html_path.parent / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        img_tags = soup.find_all("img")
        for idx, img in enumerate(img_tags):
            src = img.get("src", "").strip()
            # Handle potential newlines or tabs inside src attribute value
            src_clean = re.sub(r"\s+", "", src)
            if src_clean.startswith("data:image/"):
                try:
                    # Parse base64 header from cleaned src
                    header, base64_data = src_clean.split(",", 1)
                    # Extract extension (e.g. png, jpeg)
                    ext_match = re.search(r"data:image/(\w+);", header)
                    ext = ext_match.group(1) if ext_match else "png"

                    # Decode base64
                    img_data = base64.b64decode(base64_data)

                    # Target filename (replace spaces with underscores)
                    safe_stem = re.sub(r"\s+", "_", html_path.stem)
                    img_filename = f"{safe_stem}_img_{idx + 1}.{ext}"
                    img_file_path = images_dir / img_filename

                    with open(img_file_path, "wb") as f_img:
                        f_img.write(img_data)

                    # Update src in soup to the relative path
                    img["src"] = f"images/{img_filename}"
                    print(f"Extracted image to: images/{img_filename}")
                except Exception as e:
                    print(f"Error extracting image {idx}: {e}")

    def _cleanup_markdown(self, markdown_text: str) -> str:
        """Removes duplicate empty lines or unnecessary mid-sentence line breaks in Markdown text."""
        # Split text into lines
        lines = markdown_text.splitlines()
        cleaned_lines = []

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # If line is blank, preserve it as a paragraph separator
            if not line:
                cleaned_lines.append("")
                i += 1
                continue

            # Look ahead to see if we should merge the next line
            # If the current line does not end with sentence boundaries (., ?, !, :, etc.)
            # and the next line is not blank, and doesn't start with a header, list item, or code block
            # we merge them.
            merged_line = lines[i]
            while (i + 1 < len(lines)) and lines[i + 1].strip():
                curr_strip = merged_line.strip()
                next_line = lines[i + 1].strip()

                # Check markdown constructs
                is_md_structure = (
                    next_line.startswith("#") or
                    next_line.startswith("-") or
                    next_line.startswith("*") or
                    next_line.startswith("`") or
                    next_line.startswith("[") or
                    re.match(r"^\d+\.", next_line)
                )

                ends_with_sentence = re.search(r"[.?!:;]$", curr_strip)

                if not ends_with_sentence and not is_md_structure:
                    # Merge lines with a space and ensure no double spaces
                    merged_line = merged_line + " " + lines[i + 1].strip()
                    i += 1
                else:
                    break

            cleaned_lines.append(merged_line)
            i += 1

        # Reconstruct markdown text
        result = "\n".join(cleaned_lines)

        # Replace multiple consecutive spaces with a single space
        result = re.sub(r" {2,}", " ", result)
        # Replace multiple consecutive blank lines with a single blank line
        result = re.sub(r"\n{3,}", "\n\n", result)
        return result
