/**
 * Removes the original text of edited lines from a page's content stream, so the saved PDF contains
 * only the new wording (otherwise an ATS would extract both the old and the new text).
 *
 * Each removed string is replaced by an equivalent positioning offset, so nothing else on the line moves.
 * Anything this can't handle safely (unknown font widths, rotated text) is left in place.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";

export interface TextRun {
  x: number;
  y: number;
  width: number;
  size: number;
}

type Matrix = [number, number, number, number, number, number];
type Value = { raw: string } & (
  | { kind: "num"; num: number }
  | { kind: "str"; bytes: number[] }
  | { kind: "name"; name: string }
  | { kind: "arr"; items: Value[] }
  | { kind: "other" }
);
interface Op {
  op: string;
  args: Value[];
  start: number;
  end: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Returns true if the page's text was rewritten. */
export function removeTextRuns(pdf: PDFDocument, page: PDFPage, runs: TextRun[]): boolean {
  if (!runs.length) return false;
  const source = readContents(pdf, page);
  if (source === null) return false;

  let ops: Op[];
  try {
    ops = parse(source);
  } catch {
    return false;
  }

  const fonts = new Map<string, FontMetrics | null>();
  const fontDicts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const metricsFor = (name: string) => {
    if (!fonts.has(name)) {
      const dict = fontDicts?.lookupMaybe(PDFName.of(name), PDFDict);
      fonts.set(name, dict ? fontMetrics(pdf, dict) : null);
    }
    return fonts.get(name)!;
  };

  const edits: { start: number; end: number; text: string }[] = [];
  let ctm = IDENTITY;
  const stack: Matrix[] = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let font: FontMetrics | null = null;
  let size = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let scale = 1;
  let leading = 0;

  const nums = (args: Value[]) => args.map((a) => (a.kind === "num" ? a.num : 0));
  const moveLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  /** Advances over a string; returns the replacement offset if it lies in an edited run, else null. */
  const show = (bytes: number[]): number | null => {
    const m = mul(tm, ctm);
    const [ux, uy] = [m[4], m[5]];
    let advance = 0;
    if (font) {
      const step = font.twoByte ? 2 : 1;
      for (let i = 0; i + step <= bytes.length; i += step) {
        const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
        const spacing = step === 1 && code === 32 ? wordSpacing : 0;
        advance += (font.width(code) / 1000) * size + charSpacing + spacing;
      }
    }
    advance *= scale;
    tm = mul([1, 0, 0, 1, advance, 0], tm);

    const upright = Math.abs(m[1]) < 1e-3 && Math.abs(m[2]) < 1e-3 && m[0] > 0;
    if (!font || !upright || !size || !scale) return null;
    const hit = runs.some(
      (r) => Math.abs(uy - r.y) < r.size * 0.3 && ux > r.x - r.size * 0.3 && ux < r.x + r.width - r.size * 0.1,
    );
    return hit ? -(advance * 1000) / (size * scale) : null;
  };

  for (const { op, args, start, end } of ops) {
    switch (op) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? IDENTITY;
        break;
      case "cm":
        ctm = mul(nums(args) as Matrix, ctm);
        break;
      case "BT":
        tm = tlm = IDENTITY;
        break;
      case "Tf":
        font = args[0]?.kind === "name" ? metricsFor(args[0].name) : null;
        size = nums(args)[1] ?? 0;
        break;
      case "Tc":
        charSpacing = nums(args)[0];
        break;
      case "Tw":
        wordSpacing = nums(args)[0];
        break;
      case "Tz":
        scale = nums(args)[0] / 100;
        break;
      case "TL":
        leading = nums(args)[0];
        break;
      case "Td":
        moveLine(...(nums(args) as [number, number]));
        break;
      case "TD":
        leading = -nums(args)[1];
        moveLine(...(nums(args) as [number, number]));
        break;
      case "Tm":
        tm = tlm = nums(args) as Matrix;
        break;
      case "T*":
        moveLine(0, -leading);
        break;
      case "Tj":
      case "'":
      case '"': {
        let prefix = "";
        if (op === '"') {
          [wordSpacing, charSpacing] = nums(args);
          prefix = `${args[0].raw} Tw ${args[1].raw} Tc `;
        }
        if (op !== "Tj") {
          moveLine(0, -leading);
          prefix += "T* ";
        }
        const str = args[args.length - 1];
        if (str?.kind !== "str") break;
        const offset = show(str.bytes);
        if (offset !== null) edits.push({ start, end, text: `${prefix}[${fmt(offset)}] TJ` });
        break;
      }
      case "TJ": {
        const arr = args[0];
        if (arr?.kind !== "arr") break;
        let changed = false;
        const parts = arr.items.map((item) => {
          if (item.kind === "num") {
            tm = mul([1, 0, 0, 1, (-item.num / 1000) * size * scale, 0], tm);
            return item.raw;
          }
          if (item.kind !== "str") return item.raw;
          const offset = show(item.bytes);
          if (offset === null) return item.raw;
          changed = true;
          return fmt(offset);
        });
        if (changed) edits.push({ start, end, text: `[${parts.join(" ")}] TJ` });
        break;
      }
    }
  }

  if (!edits.length) return false;
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += source.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  out += source.slice(pos);
  const bytes = Uint8Array.from(out, (c) => c.charCodeAt(0));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(bytes)));
  return true;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** The page's content streams joined as a binary-safe (latin1) string. */
function readContents(pdf: PDFDocument, page: PDFPage): string | null {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  try {
    const parts = refs.map((ref) => {
      const stream = ref instanceof PDFRef ? pdf.context.lookup(ref) : ref;
      if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
      if (stream instanceof PDFStream) return stream.getContents();
      throw new Error("Unexpected content stream");
    });
    return parts.map((p) => Array.from(p, (b) => String.fromCharCode(b)).join("")).join("\n");
  } catch {
    return null;
  }
}

interface FontMetrics {
  twoByte: boolean;
  width: (code: number) => number;
}

function fontMetrics(pdf: PDFDocument, dict: PDFDict): FontMetrics | null {
  const num = (v: unknown) => {
    const resolved = v instanceof PDFRef ? pdf.context.lookup(v) : v;
    return resolved instanceof PDFNumber ? resolved.asNumber() : 0;
  };
  const subtype = dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();

  if (subtype === "/Type0") {
    const descendant = dict.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookup(0, PDFDict);
    if (!descendant) return null;
    const dw = num(descendant.get(PDFName.of("DW"))) || 1000;
    const widths = new Map<number, number>();
    const w = descendant.lookupMaybe(PDFName.of("W"), PDFArray)?.asArray() ?? [];
    for (let i = 0; i < w.length; ) {
      const first = num(w[i]);
      const next = w[i + 1] instanceof PDFRef ? pdf.context.lookup(w[i + 1]) : w[i + 1];
      if (next instanceof PDFArray) {
        next.asArray().forEach((v, j) => widths.set(first + j, num(v)));
        i += 2;
      } else {
        const last = num(next);
        for (let c = first; c <= last; c++) widths.set(c, num(w[i + 2]));
        i += 3;
      }
    }
    return { twoByte: true, width: (code) => widths.get(code) ?? dw };
  }

  const widthsArr = dict.lookupMaybe(PDFName.of("Widths"), PDFArray);
  if (!widthsArr) return null; // standard 14 fonts without widths: leave their text alone
  const firstChar = num(dict.get(PDFName.of("FirstChar")));
  const widths = widthsArr.asArray().map(num);
  const descriptor = dict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  const missing = descriptor ? num(descriptor.get(PDFName.of("MissingWidth"))) : 0;
  // Type3 widths are in glyph space; convert to the usual 1/1000 text-space units.
  const fontMatrix = dict.lookupMaybe(PDFName.of("FontMatrix"), PDFArray);
  const k = subtype === "/Type3" && fontMatrix ? num(fontMatrix.get(0)) * 1000 : 1;
  return { twoByte: false, width: (code) => (widths[code - firstChar] ?? missing) * k };
}

/** Minimal content-stream tokenizer: enough to find text operators and their operands. */
function parse(s: string): Op[] {
  const ops: Op[] = [];
  const isWs = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
  const isDelim = (c: string) => "()<>[]{}/%".includes(c);
  let i = 0;
  let operands: Value[] = [];
  let opStart = -1;
  const containers: { items: Value[]; start: number; kind: "arr" | "dict" }[] = [];

  const push = (v: Value, start: number) => {
    if (containers.length) containers[containers.length - 1].items.push(v);
    else {
      if (opStart < 0) opStart = start;
      operands.push(v);
    }
  };

  while (i < s.length) {
    const c = s[i];
    const start = i;
    if (isWs(c)) {
      i++;
    } else if (c === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    } else if (c === "(") {
      const bytes: number[] = [];
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "\\") {
          const n = s[i + 1];
          const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (n in map) {
            bytes.push(map[n]);
            i += 2;
          } else if (/[0-7]/.test(n)) {
            const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)![0];
            bytes.push(parseInt(oct, 8) & 255);
            i += 1 + oct.length;
          } else if (n === "\r" || n === "\n") {
            i += n === "\r" && s[i + 2] === "\n" ? 3 : 2;
          } else {
            i += 1;
          }
          continue;
        }
        if (ch === "(") depth++;
        if (ch === ")" && --depth === 0) {
          i++;
          break;
        }
        bytes.push(ch.charCodeAt(0));
        i++;
      }
      push({ kind: "str", bytes, raw: s.slice(start, i) }, start);
    } else if (c === "<" && s[i + 1] === "<") {
      containers.push({ items: [], start, kind: "dict" });
      i += 2;
    } else if (c === ">" && s[i + 1] === ">") {
      i += 2;
      const done = containers.pop();
      if (done) push({ kind: "other", raw: s.slice(done.start, i) }, done.start);
    } else if (c === "<") {
      const close = s.indexOf(">", i);
      const hex = s.slice(i + 1, close).replace(/[^0-9a-fA-F]/g, "");
      const padded = hex.length % 2 ? hex + "0" : hex;
      const bytes = Array.from({ length: padded.length / 2 }, (_, k) => parseInt(padded.slice(k * 2, k * 2 + 2), 16));
      i = close + 1;
      push({ kind: "str", bytes, raw: s.slice(start, i) }, start);
    } else if (c === "[") {
      containers.push({ items: [], start, kind: "arr" });
      i++;
    } else if (c === "]") {
      i++;
      const done = containers.pop();
      if (done) push({ kind: "arr", items: done.items, raw: s.slice(done.start, i) }, done.start);
    } else if (c === "/") {
      i++;
      while (i < s.length && !isWs(s[i]) && !isDelim(s[i])) i++;
      push({ kind: "name", name: s.slice(start + 1, i), raw: s.slice(start, i) }, start);
    } else {
      while (i < s.length && !isWs(s[i]) && !isDelim(s[i])) i++;
      const word = s.slice(start, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        push({ kind: "num", num: parseFloat(word), raw: word }, start);
      } else if (containers.length || word === "true" || word === "false" || word === "null") {
        push({ kind: "other", raw: word }, start);
      } else {
        ops.push({ op: word, args: operands, start: opStart < 0 ? start : opStart, end: i });
        operands = [];
        opStart = -1;
        if (word === "BI") {
          // Skip inline image data, which is binary: jump past "ID ... EI".
          const id = s.indexOf("ID", i);
          const ei = s.slice(id + 3).search(/\sEI(\s|$)/);
          if (id < 0 || ei < 0) throw new Error("Malformed inline image");
          i = id + 3 + ei + 3;
        }
      }
    }
  }
  return ops;
}
