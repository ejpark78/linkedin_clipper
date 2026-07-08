"""pdf_to_html.py — Convert PDF documents directly to HTML with PyMuPDF.

Extracts styled HTML structures including embedded images and text alignment.
"""

import argparse
import sys
from pathlib import Path

import fitz


class HTMLConverter:
    """Converter to output high fidelity HTML files from PDF documents."""

    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def convert(self, pdf_path: Path) -> Path:
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        doc = fitz.open(str(pdf_path))
        html_pages = []

        # HTML boilerplate structure with styling wrapper
        html_pages.append("<!DOCTYPE html>\n<html>\n<head>")
        html_pages.append('  <meta charset="utf-8">')
        html_pages.append(f"  <title>{pdf_path.stem}</title>")
        html_pages.append("""  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background-color: #f7f9fc;
      margin: 0;
      padding: 40px 20px;
      color: #333;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background-color: #ffffff;
      padding: 50px 60px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
      border-radius: 8px;
    }
    .page-separator {
      border-top: 1px dashed #ccc;
      margin: 40px 0;
      text-align: center;
      color: #999;
      font-size: 12px;
      user-select: none;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 20px auto;
    }
  </style>""")

        html_pages.append("</head>\n<body>\n<div class='container'>")

        import html

        for idx, page in enumerate(doc):
            if idx > 0:
                html_pages.append(f"<div class='page-separator'>Page {idx + 1}</div>")

            page_dict = page.get_text("dict")

            # Calculate font sizes to determine heading threshold
            sizes = []
            for block in page_dict.get("blocks", []):
                if block.get("type") == 0:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            sizes.append(span.get("size", 10.0))

            sizes.sort()
            median_size = sizes[len(sizes) // 2] if sizes else 10.0
            heading_threshold = median_size * 1.25

            seen_texts = set()

            img_counter = 0
            for block in page_dict.get("blocks", []):
                if block.get("type") == 0:  # Text block
                    block_text_parts = []
                    block_sizes = []
                    is_bold = False

                    for line in block.get("lines", []):
                        line_text_parts = []
                        for span in line.get("spans", []):
                            span_text = span.get("text", "")
                            if not span_text.strip():
                                continue

                            # Deduplicate shadow/duplicate texts written in close coordinates
                            bbox = span.get("bbox", (0, 0, 0, 0))
                            # Rounding to 1 decimal place to catch tiny overlaps
                            coord_key = (round(bbox[0], 1), round(bbox[1], 1), span_text.strip())
                            if coord_key in seen_texts:
                                continue
                            seen_texts.add(coord_key)

                            line_text_parts.append(span_text)
                            block_sizes.append(span.get("size", 10.0))
                            if span.get("flags", 0) & 16:
                                is_bold = True

                        if line_text_parts:
                            line_text = "".join(line_text_parts)
                            block_text_parts.append(line_text)

                    if not block_text_parts:
                        continue

                    # Merge lines in block with spaces, avoiding consecutive spaces
                    block_text = " ".join([p.strip() for p in block_text_parts if p.strip()])
                    if not block_text:
                        continue

                    avg_size = sum(block_sizes) / len(block_sizes) if block_sizes else median_size
                    escaped_text = html.escape(block_text)

                    if is_bold and avg_size < heading_threshold:
                        escaped_text = f"<strong>{escaped_text}</strong>"

                    if avg_size >= heading_threshold * 1.5:
                        html_pages.append(f"<h1>{escaped_text}</h1>")
                    elif avg_size >= heading_threshold:
                        html_pages.append(f"<h2>{escaped_text}</h2>")
                    else:
                        html_pages.append(f"<p>{escaped_text}</p>")

                elif block.get("type") == 1:  # Image block
                    image_bytes = block.get("image")
                    ext = block.get("ext", "png")
                    if image_bytes:
                        import re
                        img_counter += 1

                        images_dir = pdf_path.parent / "images"
                        images_dir.mkdir(parents=True, exist_ok=True)

                        safe_stem = re.sub(r"\s+", "_", pdf_path.stem)
                        img_filename = f"{safe_stem}_page_{idx + 1}_img_{img_counter}.{ext}"
                        img_file_path = images_dir / img_filename

                        img_file_path.write_bytes(image_bytes)
                        html_pages.append(f'<img src="images/{img_filename}" alt="image" />')

        html_pages.append("</div>\n</body>\n</html>")
        doc.close()

        output_path = pdf_path.with_suffix('.html')
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(html_pages), encoding="utf-8")
        print(f"  ✓ Saved HTML: {output_path}")
        return output_path


def main():
    parser = argparse.ArgumentParser(description="Convert PDF directly to HTML.")
    parser.add_argument("--input", required=True, help="Input PDF filepath")
    parser.add_argument("--output", default="output", help="Output directory")

    args = parser.parse_args()

    input_path = Path(args.input)
    converter = HTMLConverter(args.output)

    try:
        converter.convert(input_path)
        print("Conversion completed successfully.")
    except Exception as e:
        print(f"Error during conversion: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
