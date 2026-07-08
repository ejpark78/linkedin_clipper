"""Tests for PDFAnalyzer — mocking directory scans and overwrite skip checks."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.analyzer import PDFAnalyzer
from src.split_chapter import BookProfile


@pytest.fixture
def temp_raw_dir(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    return raw


def test_analyze_directory_recursion(temp_raw_dir):
    # Setup dummy files
    pdf1 = temp_raw_dir / "test1.pdf"
    pdf2 = temp_raw_dir / "test2.pdf"
    epub = temp_raw_dir / "test3.epub"

    pdf1.write_text("dummy pdf 1")
    pdf2.write_text("dummy pdf 2")
    epub.write_text("dummy epub 3")

    analyzer = PDFAnalyzer()
    original_analyze = analyzer.analyze

    # Mock self.analyze calls for individual files to avoid actual parsing
    with patch.object(analyzer, 'analyze') as mock_analyze:
        def side_effect(path, overwrite=False):
            if Path(path).is_dir():
                return original_analyze(path, overwrite)
            return BookProfile(Path(path), Path(path).name, 10, [])
        mock_analyze.side_effect = side_effect

        # Analyze the directory
        analyzer.analyze(str(temp_raw_dir))

        # Verify it was called for each file
        assert mock_analyze.call_count == 4  # noqa: S101 # 1 for dir + 3 for files
        called_paths = [call[0][0] for call in mock_analyze.call_args_list if call[0][0] != str(temp_raw_dir)]
        assert str(pdf1) in called_paths  # noqa: S101
        assert str(pdf2) in called_paths  # noqa: S101
        assert str(epub) in called_paths  # noqa: S101



def test_overwrite_skip_logic_false(temp_raw_dir):
    pdf_path = temp_raw_dir / "existing.pdf"
    pdf_path.write_text("dummy")

    # Create books.json with existing configuration for existing.pdf
    books_json = temp_raw_dir / "books.json"
    existing_config = {
        "existing.pdf": {
            "chapters": [
                {"title": "Chapter 1", "start": 1, "end": 10}
            ]
        }
    }
    books_json.write_text(json.dumps(existing_config, ensure_ascii=False))

    analyzer = PDFAnalyzer()

    # Execute analyze with overwrite=False, should return None and skip
    result = analyzer.analyze(str(pdf_path), overwrite=False)
    assert result is None  # noqa: S101



def test_overwrite_skip_logic_true(temp_raw_dir):
    pdf_path = temp_raw_dir / "existing.pdf"
    pdf_path.write_text("dummy")

    books_json = temp_raw_dir / "books.json"
    existing_config = {
        "existing.pdf": {
            "chapters": [
                {"title": "Chapter 1", "start": 1, "end": 10}
            ]
        }
    }
    books_json.write_text(json.dumps(existing_config, ensure_ascii=False))

    analyzer = PDFAnalyzer()

    # Mock the actual fitz document opening to verify it goes past the skip check
    with patch('fitz.open') as mock_fitz_open:
        mock_doc = MagicMock()
        mock_doc.page_count = 50
        mock_doc.get_toc.return_value = []

        # mock page get_text to return dict or string depending on format type
        mock_page = MagicMock()
        def page_get_text(format_type="text"):
            if format_type == "dict":
                return {"blocks": []}
            return ""
        mock_page.get_text.side_effect = page_get_text
        mock_doc.__getitem__.return_value = mock_page

        mock_fitz_open.return_value = mock_doc

        with patch.object(analyzer, '_save_books_config'):
            # Execute analyze with overwrite=True
            result = analyzer.analyze(str(pdf_path), overwrite=True)

            # Should not be skipped, fitz.open must be called
            mock_fitz_open.assert_called_once_with(str(pdf_path))
            assert result is not None  # noqa: S101
            assert result.title == "existing.pdf"  # noqa: S101
