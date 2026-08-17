const CODE_KEYWORD_RE =
  /^\s*(public|private|protected|static|final|async|export|function|class|interface|enum|struct|def|fn|func|let|const|var|void|int|float|double|long|char|boolean|bool|byte|short|String|string|package|import|from|using|#include)\b/;

const TYPE_DECL_RE =
  /^(?:public|private|protected|static|final|const\s+)*\s*(?:String|string|int|double|float|long|char|boolean|bool|void|var|let|byte|short|auto|class|interface|enum|struct)\s+[A-Za-z_]\w*/;

const ASSIGN_RE = /^\s*[\w$.]+\s*[+\-*/%]?=\s*\S/;
const SIGNATURE_RE =
  /^(?:public|private|protected|static|final|async\s+)*(?:class|interface|enum|struct|function|def|fn|func|void)\s+\w+\s*[({]/;
const COURSE_CODE_RE = /^[A-Z]{2,8}\d{3,6}(\s*[-–:|]\s*[\w .-]{1,20})?$/i;
const SKIP_LINK_TEXT_RE = /skip to (the )?(main )?content/i;

export function normalizeCodeText(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*\d+\s*[|:]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCodeLine(t: string): boolean {
  if (t.length < 5 || t.length > 400) return false;
  if (/^(package|import|from|using|#include)\s/.test(t)) return true;
  if (CODE_KEYWORD_RE.test(t) && /[;{}=()]/.test(t)) return true;
  if (TYPE_DECL_RE.test(t) && /[;{}=]/.test(t)) return true;
  if (SIGNATURE_RE.test(t)) return true;
  if (ASSIGN_RE.test(t) && /[;={}()+\-*/]/.test(t)) return true;
  if (/\b(String|int|double|float|long|char|boolean|bool|var)\s*\[\s*\]/.test(t)) {
    return true;
  }
  if (/\/\//.test(t) && /[=;()[\]{}]/.test(t)) return true;
  if (/[{};]\s*(\/\/.*)?$/.test(t) && !/[.!?]\s+[A-Z]/.test(t)) {
    if (/[=()]/.test(t) || TYPE_DECL_RE.test(t) || CODE_KEYWORD_RE.test(t)) {
      return true;
    }
    if (/;$/.test(t) && t.length <= 80 && !/\s+(the|and|or|is|to|of|a|an)\s+/i.test(t)) {
      return true;
    }
  }

  const symbols = (t.match(/[{}\[\]();=<>]/g) || []).length;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (symbols >= 3 && symbols / t.length >= 0.06) return true;
  if (symbols >= 4 && words < 24 && /;/.test(t)) return true;
  return false;
}

export function looksLikeCode(text: string): boolean {
  const t = normalizeCodeText(text);
  if (t.length < 5 || t.length > 8000) return false;

  // Long blobs are whole slides/sections. Only treat as code if the block
  // itself starts like source, not merely because a lesson mentions `class Foo`.
  if (t.length > 220) {
    if (/^(package|import|using|#include)\s/.test(t)) return true;
    const braces = (t.match(/[;{}]/g) || []).length;
    if (CODE_KEYWORD_RE.test(t) && braces >= 3) return true;
    const symbols = (t.match(/[{}\[\]();=<>]/g) || []).length;
    return symbols >= 8 && symbols / t.length >= 0.08;
  }

  return looksLikeCodeLine(t);
}

export function shouldSkipText(text: string): boolean {
  const t = normalizeCodeText(text);
  if (!t) return true;
  if (SKIP_LINK_TEXT_RE.test(t)) return true;
  if (COURSE_CODE_RE.test(t)) return true;
  if (looksLikeCode(t)) return true;
  return false;
}
