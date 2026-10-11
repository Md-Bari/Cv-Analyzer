/**
 * Builds a PDF of the edited CV and downloads it directly (no print dialog).
 *
 * - PDF: the original file is modified in place. Unedited content (vector text, links, graphics) is
 *   untouched; each edited line's old text is removed from the file, its area painted with the sampled
 *   background colour, and the new text drawn on top.
 * - DOCX: each rendered page is captured as an image, with an invisible text layer so ATS can read it.
 */
import type { PDFDocument, PDFFont } from "pdf-lib";
import { cvKind } from "./renderCv";

const PX_TO_PT = 72 / 96;

export async function downloadCvPdf(file: File, container: HTMLElement, baseName: string) {
  const bytes = cvKind(file) === "pdf" ? await exportPdf(file, container) : await exportDocx(container);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function exportPdf(file: File, container: HTMLElement): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const { rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = lib;
  const [{ removeTextRuns }, pdf] = await Promise.all([
    import("./pdfText"),
    lib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true }),
  ]);
  const pages = pdf.getPages();
  const fonts = new Map<string, Promise<PDFFont>>();
  const spans = Array.from(container.querySelectorAll<HTMLElement>(".cv-text-layer > span.edited"));

  // Drop the old wording from the file first, so text extraction only sees the new version.
  pages.forEach((page, index) => {
    const runs = spans
      .filter((s) => Number(s.dataset.page) === index)
      .map((s) => ({
        x: Number(s.dataset.pdfX),
        y: Number(s.dataset.pdfY),
        width: Number(s.dataset.pdfWidth),
        size: Number(s.dataset.pdfSize),
      }));
    if (!runs.length) return;
    removeTextRuns(pdf, page, runs);
    // Isolate the original drawing state so our coordinates are plain page space.
    const start = pdf.context.register(pdf.context.contentStream([pushGraphicsState()]));
    const end = pdf.context.register(pdf.context.contentStream([popGraphicsState()]));
    page.node.wrapContentStreams(start, end);
  });

  for (const span of spans) {
    const d = span.dataset;
    const page = pages[Number(d.page)];
    if (!page) continue;

    const x = Number(d.pdfX);
    const y = Number(d.pdfY);
    const size = Number(d.pdfSize);
    const width = Number(d.pdfWidth);
    const [br, bg, bb] = parseRgb(span.style.backgroundColor) ?? [255, 255, 255];
    const [fr, fg, fb] = parseRgb(span.style.color) ?? [0, 0, 0];

    page.drawRectangle({
      x: x - size * 0.05,
      y: y - size * 0.28,
      width: width + size * 0.1,
      height: size * 1.25,
      color: rgb(br / 255, bg / 255, bb / 255),
    });

    const font = await standardFont(pdf, fonts, lib.StandardFonts, d.generic ?? "", !!d.bold, !!d.italic);
    const text = encodable(font, span.textContent ?? "");
    if (!text.trim()) continue;
    // Match the original line's character width, as the editor does on screen.
    const natural = font.widthOfTextAtSize(encodable(font, d.original ?? ""), size);
    const scaleX = natural > 0 && width > 0 ? width / natural : 1;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scaleX, 0, 0, 1, x, y));
    page.drawText(text, { x: 0, y: 0, size, font, color: rgb(fr / 255, fg / 255, fb / 255) });
    page.pushOperators(popGraphicsState());
  }
  return pdf.save();
}

type StandardFontName = (typeof import("pdf-lib"))["StandardFonts"][keyof (typeof import("pdf-lib"))["StandardFonts"]];

function standardFont(
  pdf: PDFDocument,
  cache: Map<string, Promise<PDFFont>>,
  names: (typeof import("pdf-lib"))["StandardFonts"],
  generic: string,
  bold: boolean,
  italic: boolean,
) {
  const family = /mono/i.test(generic) ? "Courier" : generic === "serif" ? "Times" : "Helvetica";
  const variants: Record<string, StandardFontName[]> = {
    Helvetica: [names.Helvetica, names.HelveticaOblique, names.HelveticaBold, names.HelveticaBoldOblique],
    Times: [names.TimesRoman, names.TimesRomanItalic, names.TimesRomanBold, names.TimesRomanBoldItalic],
    Courier: [names.Courier, names.CourierOblique, names.CourierBold, names.CourierBoldOblique],
  };
  const name = variants[family][(bold ? 2 : 0) + (italic ? 1 : 0)];
  if (!cache.has(name)) cache.set(name, pdf.embedFont(name));
  return cache.get(name)!;
}

/** Standard PDF fonts only cover WinAnsi; approximate anything else so saving never fails. */
function encodable(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  return Array.from(text, (ch) => {
    if (supported.has(ch.codePointAt(0)!)) return ch;
    const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return plain && Array.from(plain).every((c) => supported.has(c.codePointAt(0)!)) ? plain : "?";
  }).join("");
}

function parseRgb(value: string) {
  const m = value.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

async function exportDocx(container: HTMLElement): Promise<Uint8Array> {
  const [{ domToCanvas }, lib] = await Promise.all([import("modern-screenshot"), import("pdf-lib")]);
  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);

  for (const section of container.querySelectorAll<HTMLElement>("section.docx")) {
    const width = section.offsetWidth;
    const height = section.offsetHeight;
    const canvas = await domToCanvas(section, { scale: 2, width, height, backgroundColor: "#ffffff" });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not capture the page."))), "image/png"),
    );
    const image = await pdf.embedPng(await blob.arrayBuffer());
    const page = pdf.addPage([width * PX_TO_PT, height * PX_TO_PT]);
    page.drawImage(image, { x: 0, y: 0, width: width * PX_TO_PT, height: height * PX_TO_PT });

    // Invisible text over each word keeps the PDF searchable and ATS-readable.
    const box = section.getBoundingClientRect();
    const k = width / box.width; // undo the editor's zoom
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const r = range.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const size = r.height * k * PX_TO_PT * 0.8;
        page.drawText(encodable(font, match[0]), {
          x: (r.left - box.left) * k * PX_TO_PT,
          y: (height - (r.bottom - box.top) * k) * PX_TO_PT + size * 0.25,
          size,
          font,
          opacity: 0,
        });
      }
    }
  }
  return pdf.save();
}
