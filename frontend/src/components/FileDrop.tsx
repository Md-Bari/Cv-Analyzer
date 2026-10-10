"use client";

import { useRef, useState } from "react";

interface FileDropProps {
  file: File | null;
  onChange: (file: File | null) => void;
  accept: string[];
  hint: string;
}

export default function FileDrop({ file, onChange, accept, hint }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(candidate: File | undefined) {
    if (!candidate) return;
    const ext = candidate.name.slice(candidate.name.lastIndexOf(".")).toLowerCase();
    if (!accept.includes(ext)) {
      setError(`Unsupported file type. Use ${accept.join(", ")}.`);
      return;
    }
    setError(null);
    onChange(candidate);
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-bold uppercase text-accent">
          {file.name.split(".").pop()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-foreground"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-line hover:border-accent hover:bg-surface-2"
        }`}
      >
        <svg className="size-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        <span className="text-sm font-medium">
          Drop a file here or <span className="text-accent">browse</span>
        </span>
        <span className="text-xs text-muted">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(",")}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
