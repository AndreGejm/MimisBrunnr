#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk
from tkinter.scrolledtext import ScrolledText


class MimirCliError(RuntimeError):
    pass


class MimirReviewClient:
    def __init__(self, repo_root: Path, node_executable: str = "node") -> None:
        self.repo_root = repo_root
        self.node_executable = node_executable
        self.cli_entry = repo_root / "apps" / "mimir-cli" / "dist" / "main.js"

    def list_review_queue(self) -> list[dict]:
        response = self._run_cli("list-review-queue", {})
        return response.get("data", {}).get("items", [])

    def read_review_note(self, draft_note_id: str) -> dict:
        response = self._run_cli("read-review-note", {"draftNoteId": draft_note_id})
        return response.get("data", {})

    def accept_note(self, draft_note_id: str) -> dict:
        response = self._run_cli("accept-note", {"draftNoteId": draft_note_id})
        return response.get("data", {})

    def reject_note(self, draft_note_id: str) -> dict:
        response = self._run_cli("reject-note", {"draftNoteId": draft_note_id})
        return response.get("data", {})

    def _run_cli(self, command: str, payload: dict) -> dict:
        if not self.cli_entry.exists():
            raise MimirCliError(
                f"Could not find built mimir-cli entrypoint at {self.cli_entry}. "
                "Run `corepack pnpm build` in the repo first."
            )

        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as handle:
            json.dump(payload, handle)
            request_path = Path(handle.name)

        try:
            try:
                completed = subprocess.run(
                    [self.node_executable, str(self.cli_entry), command, "--input", str(request_path)],
                    cwd=str(self.repo_root),
                    capture_output=True,
                    text=True,
                    check=False,
                )
            except FileNotFoundError as error:
                raise MimirCliError(
                    f"Could not find Node executable `{self.node_executable}`. "
                    "Set MAB_REVIEW_NODE_EXECUTABLE or install Node on PATH."
                ) from error
        finally:
            request_path.unlink(missing_ok=True)

        stdout = completed.stdout.strip()
        stderr = completed.stderr.strip()

        try:
            response = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError as error:
            raise MimirCliError(
                f"Failed to parse mimir-cli output for {command}: {error}\n{stdout or stderr}"
            ) from error

        if completed.returncode != 0 or response.get("ok") is False:
            error = response.get("error", {})
            message = error.get("message") or stderr or f"{command} failed."
            raise MimirCliError(message)

        return response


class ReviewApp(tk.Tk):
    def __init__(self, client: MimirReviewClient) -> None:
        super().__init__()
        self.client = client
        self.title("mimir Review Queue")
        self.geometry("1120x760")
        self.minsize(920, 640)

        self.queue: list[dict] = []
        self.current_index = 0
        self.current_note: dict | None = None

        self.status_var = tk.StringVar(value="Loading review queue...")
        self.position_var = tk.StringVar(value="0 / 0")
        self.title_var = tk.StringVar(value="")
        self.meta_var = tk.StringVar(value="")
        self.warning_var = tk.StringVar(value="")
        self._busy = False

        self._build_layout()
        self._load_queue()

    def _build_layout(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        header = ttk.Frame(self, padding=12)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)

        ttk.Label(
            header,
            text="Governed Note Review",
            font=("Segoe UI", 16, "bold"),
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(header, textvariable=self.position_var).grid(row=0, column=1, sticky="e")

        content = ttk.Frame(self, padding=(12, 0, 12, 12))
        content.grid(row=1, column=0, sticky="nsew")
        content.columnconfigure(0, weight=1)
        content.rowconfigure(3, weight=1)

        ttk.Label(
            content,
            textvariable=self.title_var,
            font=("Segoe UI", 14, "bold"),
            wraplength=980,
        ).grid(row=0, column=0, sticky="w", pady=(0, 4))
        ttk.Label(content, textvariable=self.meta_var, wraplength=980).grid(
            row=1, column=0, sticky="w", pady=(0, 4)
        )
        ttk.Label(
            content,
            textvariable=self.warning_var,
            wraplength=980,
            foreground="#8a5a00",
        ).grid(row=2, column=0, sticky="w", pady=(0, 8))

        self.body_text = ScrolledText(
            content,
            wrap="word",
            font=("Consolas", 10),
            state="disabled",
        )
        self.body_text.grid(row=3, column=0, sticky="nsew")

        actions = ttk.Frame(self, padding=(12, 0, 12, 12))
        actions.grid(row=2, column=0, sticky="ew")
        actions.columnconfigure(3, weight=1)

        self.previous_button = ttk.Button(actions, text="Previous", command=self._show_previous)
        self.previous_button.grid(row=0, column=0, padx=(0, 8))
        self.next_button = ttk.Button(actions, text="Next", command=self._show_next)
        self.next_button.grid(row=0, column=1)
        self.refresh_button = ttk.Button(actions, text="Refresh", command=self._refresh_queue)
        self.refresh_button.grid(row=0, column=2, padx=(8, 0))

        ttk.Label(actions, textvariable=self.status_var).grid(row=0, column=3, sticky="w", padx=12)

        self.reject_button = ttk.Button(actions, text="Reject", command=self._reject_current)
        self.reject_button.grid(row=0, column=4, padx=(8, 8))
        self.accept_button = ttk.Button(actions, text="Accept", command=self._accept_current)
        self.accept_button.grid(row=0, column=5)

    def _load_queue(self, preserve_note_id: str | None = None) -> None:
        self._set_busy(True)
        self._set_status("Loading review queue...")
        self.update_idletasks()

        try:
            self.queue = self.client.list_review_queue()
        except MimirCliError as error:
            messagebox.showerror("Review Queue Error", str(error), parent=self)
            self.queue = []
            self.current_index = 0
            self._render_empty("Could not load the review queue.")
            self._set_busy(False)
            return

        if not self.queue:
            self.current_index = 0
            self._render_empty("No review notes are waiting.")
            self._set_busy(False)
            return

        if preserve_note_id:
            for index, item in enumerate(self.queue):
                if item.get("draftNoteId") == preserve_note_id:
                    self.current_index = index
                    break
            else:
                self.current_index = min(self.current_index, len(self.queue) - 1)
        else:
            self.current_index = min(self.current_index, len(self.queue) - 1)

        self._show_current_note()

    def _show_current_note(self) -> None:
        if not self.queue:
            self._render_empty("No review notes are waiting.")
            return

        self._set_busy(True)
        queue_item = self.queue[self.current_index]
        draft_note_id = queue_item["draftNoteId"]
        self._set_status(f"Loading {draft_note_id}...")
        self.update_idletasks()

        try:
            self.current_note = self.client.read_review_note(draft_note_id)
        except MimirCliError as error:
            messagebox.showerror("Review Note Error", str(error), parent=self)
            self.current_note = None
            self._render_empty("Could not read the selected review note.")
            self._set_busy(False)
            return

        note = self.current_note
        self.position_var.set(f"{self.current_index + 1} / {len(self.queue)}")
        self.title_var.set(note.get("title", "(untitled review note)"))
        self.meta_var.set(
            " | ".join(
                part
                for part in [
                    note.get("draftNoteId", ""),
                    note.get("targetCorpus", ""),
                    note.get("noteType", ""),
                    note.get("scope", ""),
                    note.get("reviewState", ""),
                ]
                if part
            )
        )
        warnings = note.get("warnings", [])
        self.warning_var.set("Warnings: " + "; ".join(item.get("message", "") for item in warnings) if warnings else "")
        self._set_body(note.get("body", ""))
        self._update_navigation_state()
        self._set_status("Review queue ready.")
        self._set_busy(False)

    def _show_previous(self) -> None:
        if not self._busy and self.current_index > 0:
            self.current_index -= 1
            self._show_current_note()

    def _show_next(self) -> None:
        if not self._busy and self.current_index < len(self.queue) - 1:
            self.current_index += 1
            self._show_current_note()

    def _refresh_queue(self) -> None:
        preserve_note_id = self.current_note.get("draftNoteId") if self.current_note else None
        self._load_queue(preserve_note_id=preserve_note_id)

    def _accept_current(self) -> None:
        self._run_action("accept")

    def _reject_current(self) -> None:
        self._run_action("reject")

    def _run_action(self, action: str) -> None:
        if not self.current_note:
            return

        draft_note_id = self.current_note.get("draftNoteId")
        if not draft_note_id:
            return

        action_label = "Accept" if action == "accept" else "Reject"
        self._set_busy(True)
        self._set_status(f"{action_label}ing {draft_note_id}...")
        self.update_idletasks()

        try:
            if action == "accept":
                result = self.client.accept_note(draft_note_id)
                self._set_status(self._format_action_status("Accepted", draft_note_id, result))
            else:
                result = self.client.reject_note(draft_note_id)
                self._set_status(self._format_action_status("Rejected", draft_note_id, result))
        except MimirCliError as error:
            messagebox.showerror(f"{action_label} Error", str(error), parent=self)
            self._set_status(f"{action_label} failed.")
            self._set_busy(False)
            return

        self._load_queue()

    def _format_action_status(self, verb: str, draft_note_id: str, result: dict) -> str:
        details: list[str] = []
        canonical_path = result.get("canonicalPath")
        archived_path = result.get("archivedPath") or result.get("archivedDraftPath")
        if canonical_path:
            details.append(f"Canonical note: {canonical_path}")
        if archived_path:
            details.append(f"Archived at: {archived_path}")
        steps = result.get("steps")
        if isinstance(steps, list) and steps:
            details.append(
                "Steps: "
                + " | ".join(
                    f"{step.get('step', 'unknown')}: {step.get('status', 'unknown')}"
                    for step in steps
                    if isinstance(step, dict)
                )
            )
        suffix = f" {' '.join(details)}" if details else ""
        return f"{verb} {draft_note_id}.{suffix}"

    def _render_empty(self, message: str) -> None:
        self.position_var.set("0 / 0")
        self.title_var.set("No review notes")
        self.meta_var.set("")
        self.warning_var.set("")
        self.current_note = None
        self._set_body(message)
        self._update_navigation_state()
        self._set_status(message)

    def _set_body(self, body: str) -> None:
        self.body_text.configure(state="normal")
        self.body_text.delete("1.0", tk.END)
        self.body_text.insert("1.0", body)
        self.body_text.configure(state="disabled")

    def _update_navigation_state(self) -> None:
        has_queue = bool(self.queue)
        self.previous_button.configure(
            state=tk.NORMAL if not self._busy and has_queue and self.current_index > 0 else tk.DISABLED
        )
        self.next_button.configure(
            state=tk.NORMAL
            if not self._busy and has_queue and self.current_index < len(self.queue) - 1
            else tk.DISABLED
        )
        self.refresh_button.configure(state=tk.NORMAL if not self._busy else tk.DISABLED)
        button_state = tk.NORMAL if not self._busy and has_queue and self.current_note else tk.DISABLED
        self.accept_button.configure(state=button_state)
        self.reject_button.configure(state=button_state)

    def _set_status(self, message: str) -> None:
        self.status_var.set(message)

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        self._update_navigation_state()


def main() -> None:
    repo_root = Path(
        os.environ.get("MAB_REVIEW_REPO_ROOT", str(Path(__file__).resolve().parents[1]))
    )
    node_executable = os.environ.get("MAB_REVIEW_NODE_EXECUTABLE", "node")
    client = MimirReviewClient(repo_root, node_executable=node_executable)
    app = ReviewApp(client)
    app.mainloop()


if __name__ == "__main__":
    main()
