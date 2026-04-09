import { buildAnswerPdf } from "./pdfGenerator.js";

function sanitizeFilenamePart(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "document";
}

function slugFromDate() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function buildShortFilename(format = "pdf", prompt = "") {
  const normalized = String(prompt).toLowerCase();
  let prefix = "study-file";

  if (/\b(note|notes|summary|summar(y|ise|ize)|handout)\b/.test(normalized)) {
    prefix = "study-note";
  } else if (/\b(resume|cv)\b/.test(normalized)) {
    prefix = "resume";
  } else if (/\b(letter)\b/.test(normalized)) {
    prefix = "letter";
  } else if (/\b(worksheet|quiz)\b/.test(normalized)) {
    prefix = "worksheet";
  }

  return `${prefix}-${slugFromDate()}.${format}`;
}

function extractLiteralFileContent(prompt = "", fallback = "") {
  const text = String(prompt);

  const quotedMatch =
    text.match(/(?:only|just)\s+(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/contains?\s+(?:only\s+)?(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/with\s+only\s+(?:the\s+)?word\s+["“']([^"”']+)["”']/i) ||
    text.match(/contains?\s+["“']([^"”']+)["”']\s+(?:alone|only)/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainWordMatch =
    text.match(/(?:only|just)\s+(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/contains?\s+(?:only\s+)?(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/with\s+only\s+(?:the\s+)?word\s+([a-z0-9_-]+)/i) ||
    text.match(/contains?\s+([a-z0-9_-]+)\s+(?:alone|only)/i);

  if (plainWordMatch?.[1]) {
    return plainWordMatch[1].trim();
  }

  return String(fallback || "").trim();
}

export function hasLiteralContentRequest(prompt = "") {
  const text = String(prompt || "");
  return /(?:only|just)\s+(?:the\s+)?word\b/i.test(text) ||
    /contains?\s+(?:only\s+)?(?:the\s+)?word\b/i.test(text) ||
    /with\s+only\s+(?:the\s+)?word\b/i.test(text) ||
    /contains?\s+["â€œ'][^"â€']+["â€']\s+(?:alone|only)/i.test(text);
}

function htmlToWordDocument(title, content) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
    <pre style="font-family:Segoe UI, Arial, sans-serif; white-space:pre-wrap; line-height:1.6;">${content}</pre>
  </body>
</html>`;
}

export function inferDocumentFormat(prompt = "") {
  const normalized = String(prompt).toLowerCase();

  if (/\bpdf\b/.test(normalized)) {
    return "pdf";
  }

  if (/\b(word|docx?|ms word)\b/.test(normalized)) {
    return "doc";
  }

  if (/\btxt|text file|plain text\b/.test(normalized)) {
    return "txt";
  }

  return "pdf";
}

export function buildGeneratedDocument({ prompt, content }) {
  const format = inferDocumentFormat(prompt);
  const finalContent = extractLiteralFileContent(prompt, content) || "Generated study file";
  const title = prompt || "Generated study file";
  const filename = buildShortFilename(format, prompt);

  if (format === "txt") {
    return {
      buffer: Buffer.from(finalContent, "utf8"),
      filename,
      mimeType: "text/plain",
    };
  }

  if (format === "doc") {
    return {
      buffer: Buffer.from(htmlToWordDocument(title, finalContent), "utf8"),
      filename,
      mimeType: "application/msword",
    };
  }

  return {
    buffer: buildAnswerPdf({
      title: hasLiteralContentRequest(prompt) ? "" : title,
      question: "",
      answer: finalContent,
    }),
    filename,
    mimeType: "application/pdf",
  };
}
