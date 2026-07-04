"""
Textual 기반 Midnight Commander 스타일 TUI for OpenKB Compiler.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, ScrollableContainer, Vertical
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    Input,
    RadioButton,
    RadioSet,
    Select,
    Static,
    Tree,
)
from textual.widgets.tree import TreeNode

from openkb import (  # noqa: E402  # local src/openkb.py, not installed package
    PROJECT_ROOT,
    RAW_STORE,
    LLMClient,
)


class DirectoryTree(Tree):
    """파일 시스템 트리 뷰 (Space/Click으로 선택)."""

    def __init__(self, **kwargs) -> None:
        super().__init__("data", **kwargs)
        self._selected: set[str] = set()

    def on_mount(self) -> None:
        self._populate()

    def _populate(self) -> None:
        self.clear()
        root = self.root
        root.data = str(PROJECT_ROOT)
        root.label = f"📁 {PROJECT_ROOT.name}"
        if PROJECT_ROOT.exists():
            self._add_items(root, PROJECT_ROOT, depth=0)
        root.expand()

    def _add_items(self, node: TreeNode, path: Path, depth: int = 0) -> None:
        if depth > 3:
            return
        try:
            children = sorted(
                path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())
            )
        except PermissionError:
            return
        for child in children:
            if child.name.startswith("."):
                continue
            if child.is_dir():
                branch = node.add(f"📁 {child.name}", data=str(child))
                self._add_items(branch, child, depth + 1)

    def on_tree_node_selected(self, event: Tree.NodeSelected) -> None:
        path = event.node.data
        if path and Path(path).is_dir():
            self._toggle_node(event.node)

    def _toggle_node(self, node: TreeNode) -> None:
        path = node.data
        if not path:
            return
        if path in self._selected:
            self._selected.discard(path)
            node.label = node.label.replace("☑ ", "📁 ", 1) if "☑ " in str(node.label) else node.label
        else:
            self._selected.add(path)
            node.label = node.label.replace("📁 ", "☑ ", 1) if "📁 " in str(node.label) else node.label

    def get_selected_paths(self) -> list[str]:
        return [p for p in sorted(self._selected)]


class EngineRadio(RadioSet):
    """LLM 엔진 선택 라디오 그룹."""

    def on_mount(self) -> None:
        self.pressed_index = 0

    def watch_pressed_index(self, index: int) -> None:
        self.pressed_index = index


class ModelSelect(Select):
    """엔진별 모델 선택 드롭다운."""

    def __init__(self, prompt: str = "Model", **kwargs) -> None:
        super().__init__([], prompt=prompt, **kwargs)

    def populate(self, engine: str, api_key: str | None = None) -> None:
        models: list[tuple[str, str]] = []
        if engine == "llama.cpp":
            for label, path in LLMClient.find_gguf_models():
                models.append((f"{label} │ {path}", path))
            if not models:
                models.append(("(캐시된 모델 없음)", ""))
        else:
            fetched = LLMClient.list_models(engine, api_key)
            for m in fetched:
                models.append((m, m))
            if not models:
                models.append(("(모델 없음)", ""))
        models.insert(0, ("-- 선택 --", ""))
        self.set_options(models)
        if len(models) > 1:
            self.value = models[1][1]


class CompileResult(ModalScreen[None]):
    """컴파일 결과 화면."""

    def __init__(self, output: str) -> None:
        super().__init__()
        self._output = output

    def compose(self) -> ComposeResult:
        yield Static(self._output, id="result")

    CSS = """
    #result {
        padding: 2;
        margin: 2;
        border: solid $accent;
        min-width: 50;
        max-width: 80;
    }
    Screen {
        align: center middle;
    }
    """


class OpenKbConfig(App[dict]):  # type: ignore[type-arg]
    """MC 스타일 OpenKB 컴파일 설정 TUI."""

    CSS = """
    Screen {
        layout: grid;
        grid-size: 2 1;
        grid-rows: 1fr;
    }
    #tree-pane {
        border: ascii $primary;
        padding: 0 1;
    }
    #tree-pane > Tree {
        height: 100%;
    }
    #config-pane {
        border: ascii $primary;
        padding: 0 1;
        overflow-y: auto;
    }
    #config-pane > * {
        margin: 0 0 1 0;
    }
    .section-label {
        text-style: bold;
        background: $accent 20%;
        padding: 0 1;
    }
    .inline-group {
        height: auto;
    }
    .inline-group > * {
        width: 1fr;
    }
    Input, Select {
        width: 100%;
    }
    #action-bar {
        dock: bottom;
        height: 3;
        padding: 0 2;
        border-top: ascii $primary;
        align: center middle;
    }
    #action-bar Button {
        margin: 0 1;
    }
    Footer {
        display: none;
    }
    """

    BINDINGS = [
        ("f5", "compile", "F5: Compile"),
        ("escape", "exit", "Esc: Exit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._result: dict = {}

    def compose(self) -> ComposeResult:
        with Vertical(id="tree-pane"):
            yield Static(" 📁 Sources ", classes="section-label")
            yield DirectoryTree(id="dir-tree")

        with ScrollableContainer(id="config-pane"):
            yield Static(" 🔧 LLM Engine ", classes="section-label")
            yield RadioSet(
                RadioButton("Ollama", value=True, id="rb-ollama"),
                RadioButton("llama.cpp", id="rb-llamacpp"),
                RadioButton("Unsloth Studio", id="rb-unsloth"),
                id="engine-radio",
            )

            yield Static(" 🤖 Model ", classes="section-label")
            yield ModelSelect(id="model-select", prompt="Model")

            yield Static(" 📅 Date Range ", classes="section-label")
            with Horizontal(classes="inline-group"):
                yield Input(placeholder="from (YYYY-MM-DD)", id="date-from")
                yield Input(placeholder="to (YYYY-MM-DD)", id="date-to")

            yield Static(" 📁 Output Path ", classes="section-label")
            yield Input(value=str(RAW_STORE), id="output-path")

            yield Static(" 🧪 Sample Limit ", classes="section-label")
            yield Input(placeholder="blank = all", id="sample-limit")

            with Horizontal(id="action-bar"):
                yield Button("▶ Compile", id="btn-compile", variant="primary")
                yield Button("✕ Exit", id="btn-exit", variant="error")

    def on_mount(self) -> None:
        self._refresh_models()

    def on_radio_set_changed(self, event: RadioSet.Changed) -> None:
        if event.radio_set.id == "engine-radio":
            self._refresh_models()

    def _get_engine(self) -> str:
        rb = self.query_one("#engine-radio", RadioSet)
        labels = {0: "ollama", 1: "llama.cpp", 2: "unsloth"}
        return labels.get(rb.pressed_index, "ollama")

    def _get_api_key(self) -> str | None:
        return None

    def _refresh_models(self) -> None:
        engine = self._get_engine()
        select = self.query_one("#model-select", ModelSelect)
        select.populate(engine, self._get_api_key())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-compile":
            self._do_compile()
        elif event.button.id == "btn-exit":
            self.exit({})

    def action_compile(self) -> None:
        self._do_compile()

    def action_exit(self) -> None:
        self.exit({})

    def _gather_selections(self) -> dict:
        result: dict = {}
        result["engine"] = self._get_engine()

        ms = self.query_one("#model-select", ModelSelect)
        result["model"] = str(ms.value) if ms.value else None

        tree = self.query_one("#dir-tree", DirectoryTree)
        sel_paths = tree.get_selected_paths()
        if sel_paths:
            result["input_paths"] = tuple(sel_paths)

        df = self.query_one("#date-from", Input)
        dt = self.query_one("#date-to", Input)
        result["date_from"] = df.value.strip() or None
        result["date_to"] = dt.value.strip() or None

        out = self.query_one("#output-path", Input)
        result["output_path"] = out.value.strip() or None

        sample = self.query_one("#sample-limit", Input)
        result["sample"] = int(sample.value.strip()) if sample.value.strip().isdigit() else None

        result["no_clean"] = False
        result["no_cache"] = False
        result["api_key"] = None
        result["llama_port"] = 8080

        return result

    @work
    async def _do_compile(self) -> None:
        selections = self._gather_selections()
        self._result = selections
        import sys

        from .openkb import compile_command
        sys.stdout.flush()
        self.push_screen(CompileResult("▶ Compiling..."))

        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, compile_command, **selections)
            self._result = selections
            self.pop_screen()
            self.exit(selections)
        except Exception as e:
            self.pop_screen()
            self.push_screen(CompileResult(f"❌ Error:\n{e}"))


def run_tui() -> dict:
    """Run the Textual TUI and return selections dict."""
    app = OpenKbConfig()
    result = app.run()
    if result is None:
        return {}
    return result
