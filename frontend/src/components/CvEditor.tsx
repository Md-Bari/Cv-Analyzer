"use client";

import { useEffect, useRef, useState } from "react";
import StepHeader from "./StepHeader";
import { downloadCvPdf } from "@/lib/exportCv";
import { CV_SCREEN_CSS, markPdfSpanEdited, readCvText, renderCv } from "@/lib/renderCv";

interface CvEditorProps {
  file: File | null;
  edited: boolean;
  /** Called with the text of the freshly rendered file before any edits, or null if it could not be shown. */
  onLoad: (text: string | null) => void;
  onTextChange: (text: string) => void;
  missingKeywords: string[];
  text: string;
}

export default function CvEditor({ file, edited, onLoad, onTextChange, missingKeywords, text }: CvEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  // Outcome of the latest render, tagged with what was rendered so stale results are ignored.
  const [rendered, setRendered] = useState<{ file: File; version: number; error: string | null } | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep the latest callback without re-rendering the document when the parent re-renders.
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    const container = pagesRef.current;
    if (!container) return;
    container.replaceChildren();
    if (!file) return;
    let cancelled = false;
    renderCv(file, container)
      .then((width) => {
        if (cancelled) return;
        setPageWidth(width);
        setRendered({ file, version, error: null });
        onLoadRef.current(readCvText(container));
      })
      .catch((err) => {
        if (cancelled) return;
        container.replaceChildren();
        setRendered({ file, version, error: err instanceof Error ? err.message : "Could not display this file." });
        onLoadRef.current(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file, version]);

  // Scale pages down to fit the panel width.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !pageWidth) return;
    const observer = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 32) / pageWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageWidth]);

  function handleInput(e: React.FormEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.parentElement?.classList.contains("cv-text-layer")) markPdfSpanEdited(target);
    onTextChange(readCvText(pagesRef.current!));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // A PDF line is a single positioned span; a new line would break the layout.
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && target.parentElement?.classList.contains("cv-text-layer")) e.preventDefault();
  }

  function insertKeyword(keyword: string) {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const editable = anchor && (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("[contenteditable]");
    if (!selection || !editable || !pagesRef.current?.contains(editable)) {
      setHint("Click in your CV where the keyword should go, then pick it.");
      return;
    }
    setHint(null);
    const before = anchor.textContent?.slice(0, selection.anchorOffset) ?? "";
    const spacer = before && !/[\s(,/]$/.test(before) ? (/,\s*$/.test(before) ? " " : ", ") : "";
    // execCommand keeps the browser's undo stack and fires the input event.
    document.execCommand("insertText", false, spacer + keyword);
  }

  const current = rendered && rendered.file === file && rendered.version === version ? rendered : null;
  const status = !file ? "idle" : !current ? "loading" : current.error ? "error" : "ready";
  const error = current?.error;

  async function savePdf() {
    if (!file || !pagesRef.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      await downloadCvPdf(file, pagesRef.current, `${file.name.replace(/\.[^.]+$/, "")}-edited`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not create the PDF.");
    } finally {
      setSaving(false);
    }
  }

  const pendingKeywords = missingKeywords.filter((k) => !text.toLowerCase().includes(k.toLowerCase()));
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <section className="card flex h-[85vh] min-h-0 flex-col lg:h-full">
      <style>{CV_SCREEN_CSS}</style>
      <div className="flex items-start justify-between gap-4">
        <StepHeader step={3} title="Edit your CV" subtitle="Click any text to edit it — the original layout is kept" />
        <div className="flex shrink-0 gap-1 text-sm">
          {edited && (
            <ToolButton onClick={() => setVersion((v) => v + 1)} title="Discard your edits">
              Reset
            </ToolButton>
          )}
          <button
            type="button"
            disabled={status !== "ready" || saving}
            onClick={savePdf}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-1 font-medium text-accent hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {saving && <span className="size-3 animate-spin rounded-full border-2 border-accent/40 border-t-accent" />}
            {saving ? "Saving…" : "Download PDF"}
          </button>
        </div>
      </div>

      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto rounded-xl bg-surface-2 p-4">
        <div
          ref={pagesRef}
          className="cv-pages"
          style={{ zoom }}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          suppressContentEditableWarning
        />
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
            {status === "loading" && (
              <>
                <span className="size-5 animate-spin rounded-full border-2 border-muted/40 border-t-muted" />
                Rendering your CV…
              </>
            )}
            {status === "idle" && "Upload your CV on the left to edit it here with its original formatting."}
            {status === "error" && <span className="text-bad">{error}</span>}
          </div>
        )}
      </div>

      <p className="mt-1 flex justify-between text-xs text-muted">
        <span>
          {saveError ? (
            <span className="text-bad">{saveError}</span>
          ) : (
            edited && <span className="font-medium text-accent">Edited — analysis will use your changes</span>
          )}
        </span>
        <span>{status === "ready" && `${words} words`}</span>
      </p>

      {pendingKeywords.length > 0 && (
        <div className="mt-3 shrink-0 border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium text-muted">
            Missing keywords — click in your CV, then pick one to insert (only add skills you really have)
          </p>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {pendingKeywords.map((k) => (
              <button
                key={k}
                type="button"
                // Keep the caret in the CV instead of moving focus to this button.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertKeyword(k)}
                className="rounded-full border border-bad/30 bg-bad/10 px-2.5 py-0.5 text-xs font-medium text-bad hover:bg-bad/20"
              >
                + {k}
              </button>
            ))}
          </div>
          {hint && <p className="mt-2 text-xs text-warn">{hint}</p>}
        </div>
      )}
    </section>
  );
}

function ToolButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-md px-2.5 py-1 font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  );
}
