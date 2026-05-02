// LaTeX → PDF compilation via the public latexonline.cc service.
// All failures return null so the caller can fall back to pdf-lib.

const COMPILE_URL = "https://latexonline.cc/compile";
const COMPILE_TIMEOUT_MS = 25000;
const MAX_ENCODED_LEN = 30000;
const MAX_SOURCE_LEN  = 60000;

const PREAMBLE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath, amssymb, amsthm}
\usepackage{geometry}
\geometry{margin=1in}
\usepackage{hyperref}
\usepackage{parskip}
\hypersetup{colorlinks=true, urlcolor=blue, linkcolor=black}
`;

function escapeTitle(s) {
  return String(s || "Document").replace(/([\\&%$#_{}~^])/g, "\\$1");
}

function wrapDocument(content, fileName) {
  if (/\\documentclass\b/.test(content)) return content;
  const title = escapeTitle(fileName);
  return `${PREAMBLE}\\title{${title}}\n\\date{}\n\\begin{document}\n\\maketitle\n${content}\n\\end{document}\n`;
}

function isPdfBuffer(buf) {
  return Buffer.isBuffer(buf)
      && buf.length > 4
      && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/**
 * Compile LaTeX source to a PDF buffer via latexonline.cc.
 * Returns null on any failure — caller is responsible for falling back.
 *
 * @param {string} content   LaTeX body or full document
 * @param {string} fileName  Used as document title when wrapping
 * @returns {Promise<Buffer|null>}
 */
export async function generateLatexPDF(content, fileName) {
  if (!content || typeof content !== "string") return null;
  if (content.length > MAX_SOURCE_LEN) {
    console.warn("[LaTeX] source exceeds size cap, skipping");
    return null;
  }

  const source  = wrapDocument(content, fileName);
  const encoded = encodeURIComponent(source);
  if (encoded.length > MAX_ENCODED_LEN) {
    console.warn("[LaTeX] encoded source too large for compile service");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPILE_TIMEOUT_MS);

  try {
    const res = await fetch(`${COMPILE_URL}?text=${encoded}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[LaTeX] compile returned ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPdfBuffer(buf)) {
      console.warn("[LaTeX] compile response is not a PDF");
      return null;
    }
    return buf;
  } catch (err) {
    console.warn("[LaTeX] compile failed:", err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const LATEX_SIGNALS = [
  /\$[^$\n]{1,200}\$/,                                             // $...$
  /\$\$[\s\S]{1,500}?\$\$/,                                        // $$...$$
  /\\\[[\s\S]{1,500}?\\\]/,                                        // \[...\]
  /\\begin\{(equation|align|gather|matrix|pmatrix|bmatrix|cases|array|tabular)\*?\}/,
  /\\(section|subsection|subsubsection|chapter|paragraph)\{/,
  /\\(frac|sqrt|sum|int|lim|prod|partial|nabla|infty|alpha|beta|gamma|theta|lambda|sigma|omega)\b/,
  /[∀-⋿]/,                                               // mathematical operators
  /[←-⇿]/,                                               // arrows
  /[∑∫∂∇∞≈≠≤≥√π∈∉⊆⊇∪∩⊥∥]/,
];

/**
 * Heuristic — does this content look like it would benefit from LaTeX rendering?
 */
export function shouldUseLatex(content) {
  if (!content || typeof content !== "string") return false;
  if (content.length > MAX_SOURCE_LEN) return false;
  return LATEX_SIGNALS.some((re) => re.test(content));
}
