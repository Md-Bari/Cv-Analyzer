/**
 * Renders an uploaded CV with its original formatting and makes it editable.
 *
 * - PDF: each page is drawn to a canvas exactly as-is; an editable, transparent text layer sits on top.
 *   When a line is edited, that span gets the sampled background/text colour of the original so it
 *   paints over the old glyphs, leaving the rest of the page pixel-identical.
 * - DOCX: rendered to styled HTML (fonts, colours, tables, page size) and edited in place.
 */

const PDF_SCALE = 96 / 72; // PDF points -> CSS px, so a page prints at its real paper size

export const CV_CSS = `
.cv-pages { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.cv-page { position: relative; flex: none; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); }
.cv-page > img, .cv-page > canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.cv-text-layer { position: absolute; inset: 0; }
.cv-text-layer > span { position: absolute; white-space: pre; line-height: 1; color: transparent;
  transform-origin: 0 0; outline: none; caret-color: #111; }
.cv-text-layer > span.edited { padding: 0.15em 0.05em; margin: -0.15em -0.05em; }
.cv-pages .docx-wrapper { background: transparent !important; padding: 0 !important; gap: 16px; }
.cv-pages .docx-wrapper > section.docx { box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); margin: 0 !important; outline: none; }
`;

const SCREEN_CSS = `
.cv-text-layer > span { cursor: text; }
.cv-text-layer > span:hover { outline: 1px dashed rgb(79 70 229 / 0.6); }
.cv-text-layer > span:focus { outline: 1px solid rgb(79 70 229); }
.cv-text-layer > span::selection { background: rgb(79 70 229 / 0.3); }
`;

export const CV_SCREEN_CSS = CV_CSS + SCREEN_CSS;

export function cvKind(file: File): "pdf" | "docx" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  return null;
}

/** Renders the file into `container` and returns the width of its widest page in CSS px. */
export async function renderCv(file: File, container: HTMLElement): Promise<number> {
  container.replaceChildren();
  const kind = cvKind(file);
  if (kind === "pdf") return renderPdf(file, container);
  if (kind === "docx") return renderDocx(file, container);
  throw new Error("Only PDF and DOCX files can be edited.");
}

async function renderPdf(file: File, container: HTMLElement): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const measure = document.createElement("canvas").getContext("2d")!;
  const ratio = Math.max(2, window.devicePixelRatio || 1);
  let maxWidth = 0;

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: PDF_SCALE });
      maxWidth = Math.max(maxWidth, viewport.width);

      const pageEl = document.createElement("div");
      pageEl.className = "cv-page";
      pageEl.dataset.ratio = String(ratio);
      pageEl.style.width = `${viewport.width}px`;
      pageEl.style.height = `${viewport.height}px`;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      pageEl.append(canvas);
      await page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;

      const layer = document.createElement("div");
      layer.className = "cv-text-layer";
      pageEl.append(layer);
      container.append(pageEl);

      const content = await page.getTextContent();
      let prev: HTMLSpanElement | null = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (!item.str.trim()) {
          // Whitespace-only items only matter as separators in the extracted text.
          if (prev) prev.dataset.sep = item.hasEOL ? "\n" : prev.dataset.sep || " ";
          continue;
        }
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.hypot(tx[2], tx[3]);
        const style = content.styles[item.fontName];
        const font = fontFor(page.commonObjs, item.fontName, style?.fontFamily);

        const span = document.createElement("span");
        span.textContent = item.str;
        span.contentEditable = "plaintext-only";
        span.spellcheck = true;
        span.dataset.sep = item.hasEOL ? "\n" : "";
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontSize * (style?.ascent || 0.8)}px`;
        span.style.fontSize = `${fontSize}px`;
        span.style.fontFamily = font.family;
        span.style.fontWeight = font.bold ? "bold" : "normal";
        span.style.fontStyle = font.italic ? "italic" : "normal";

        // Stretch the browser's font to the exact width the PDF used, so overlays line up.
        const target = item.width * PDF_SCALE;
        measure.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${fontSize}px ${font.family}`;
        const natural = measure.measureText(item.str).width;
        const scaleX = natural > 0 && target > 0 ? target / natural : 1;
        const angle = Math.atan2(tx[1], tx[0]);
        span.style.transform = `${angle ? `rotate(${angle}rad) ` : ""}scaleX(${scaleX})`;
        span.dataset.width = String(target);
        span.dataset.scale = String(scaleX);
        // Where the line sits in the original PDF, so edits can be written back into the file.
        Object.assign(span.dataset, {
          page: String(n - 1),
          pdfX: String(item.transform[4]),
          pdfY: String(item.transform[5]),
          pdfSize: String(Math.hypot(item.transform[2], item.transform[3])),
          pdfWidth: String(item.width),
          generic: style?.fontFamily ?? "sans-serif",
          bold: font.bold ? "1" : "",
          italic: font.italic ? "1" : "",
          original: item.str,
        });

        layer.append(span);
        prev = span;
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return maxWidth;
}

interface PdfFontObject {
  name?: string;
  bold?: boolean;
  italic?: boolean;
}

function fontFor(objs: { has(id: string): boolean; get(id: string): unknown }, fontName: string, fallback = "sans-serif") {
  const info = (objs.has(fontName) ? objs.get(fontName) : null) as PdfFontObject | null;
  const raw = (info?.name ?? "").replace(/^[A-Z]{6}\+/, ""); // drop subset prefix, e.g. "ABCDEF+Calibri-Bold"
  const [base, variant = ""] = raw.split(/[-,]/);
  const family = base.replace(/(PSMT|MT|PS)$/, "");
  const spaced = family.replace(/([a-z])([A-Z])/g, "$1 $2");
  const families = [...new Set([family, spaced].filter(Boolean))].map((f) => `"${f}"`);
  return {
    family: [...families, fallback].join(", "),
    bold: Boolean(info?.bold) || /bold|black|heavy|semibold|demi/i.test(variant || raw),
    italic: Boolean(info?.italic) || /italic|oblique/i.test(variant || raw),
  };
}

async function renderDocx(file: File, container: HTMLElement): Promise<number> {
  const { renderAsync } = await import("docx-preview");
  await renderAsync(file, container, container, {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
  });
  let maxWidth = 0;
  container.querySelectorAll<HTMLElement>("section.docx").forEach((section) => {
    section.contentEditable = "true";
    section.spellcheck = true;
    maxWidth = Math.max(maxWidth, section.offsetWidth);
  });
  return maxWidth;
}

/** Gives an edited PDF span the original's colours so it covers the glyphs underneath. */
export function markPdfSpanEdited(span: HTMLElement) {
  if (span.classList.contains("edited")) return;
  span.classList.add("edited");
  span.style.minWidth = `${Number(span.dataset.width) / Number(span.dataset.scale || 1)}px`;

  const pageEl = span.closest<HTMLElement>(".cv-page");
  const canvas = pageEl?.querySelector("canvas");
  if (!pageEl || !canvas) return;
  const ratio = Number(pageEl.dataset.ratio) || 1;
  const fontSize = parseFloat(span.style.fontSize);
  const x = Math.max(0, Math.floor(parseFloat(span.style.left) * ratio));
  const y = Math.max(0, Math.floor(parseFloat(span.style.top) * ratio));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(Number(span.dataset.width) * ratio)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(fontSize * ratio)));
  const { data } = canvas.getContext("2d")!.getImageData(x, y, w, h);

  // Background = most common colour in the box; text = the colour furthest from it.
  const counts = new Map<number, { count: number; rgb: number[] }>();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { count: 1, rgb: [data[i], data[i + 1], data[i + 2]] });
  }
  let bg = [255, 255, 255];
  let best = -1;
  counts.forEach(({ count, rgb }) => {
    if (count > best) [bg, best] = [rgb, count];
  });
  let fg = bg[0] + bg[1] + bg[2] > 380 ? [17, 17, 17] : [255, 255, 255];
  let maxDist = 60 * 60;
  for (let i = 0; i < data.length; i += 4) {
    const d = (data[i] - bg[0]) ** 2 + (data[i + 1] - bg[1]) ** 2 + (data[i + 2] - bg[2]) ** 2;
    if (d > maxDist) [maxDist, fg] = [d, [data[i], data[i + 1], data[i + 2]]];
  }
  span.style.backgroundColor = `rgb(${bg.join(" ")})`;
  span.style.color = `rgb(${fg.join(" ")})`;
  span.style.caretColor = span.style.color;
}

/** Plain text of the (possibly edited) CV, used for analysis. */
export function readCvText(container: HTMLElement): string {
  const pdfPages = container.querySelectorAll(".cv-text-layer");
  if (pdfPages.length) {
    return Array.from(pdfPages, (layer) =>
      Array.from(layer.children as HTMLCollectionOf<HTMLElement>, (s) => (s.textContent ?? "") + (s.dataset.sep ?? "")).join(""),
    )
      .join("\n\n")
      .trim();
  }
  return Array.from(container.querySelectorAll<HTMLElement>("section.docx"), (s) => s.innerText)
    .join("\n\n")
    .trim();
}
