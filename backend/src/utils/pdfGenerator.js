function escapePdfText(text = "") {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapText(text = "", maxLineLength = 88) {
  const lines = [];

  for (const paragraph of String(text).split(/\r?\n/)) {
    const trimmed = paragraph.trim();

    if (!trimmed) {
      lines.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLineLength) {
        if (current) {
          lines.push(current);
        }
        current = word;
      } else {
        current = next;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function buildCenteredWordContent(text = "") {
  const safe = escapePdfText(String(text || "").trim() || "Document");
  return [
    "BT",
    "/F1 36 Tf",
    "190 420 Td",
    `(${safe}) Tj`,
    "ET",
  ].join("\n");
}

export function buildAnswerPdf({ title = "AI Tutor Answer", question = "", answer = "" }) {
  const normalizedAnswer = String(answer || "").trim();
  const isSingleWord = normalizedAnswer && !/\s/.test(normalizedAnswer);

  if (!title && !question && isSingleWord) {
    const stream = buildCenteredWordContent(normalizedAnswer);
    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj",
      `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`,
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj",
    ];

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${object}\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";

    for (let index = 1; index <= objects.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
  }

  const lines = [
    title,
    "",
    ...(question ? [`Question: ${question}`, ""] : []),
    ...wrapText(answer || "No answer was available."),
  ].slice(0, 38);

  let y = 760;
  const contentLines = [
    "BT",
    "/F1 20 Tf",
    `50 ${y} Td`,
    `(${escapePdfText(lines[0] || title)}) Tj`,
    "ET",
  ];

  y -= 34;

  for (const line of lines.slice(1)) {
    if (y < 60) {
      break;
    }

    if (!line) {
      y -= 10;
      continue;
    }

    contentLines.push(
      "BT",
      "/F1 12 Tf",
      `50 ${y} Td`,
      `(${escapePdfText(line)}) Tj`,
      "ET",
    );
    y -= 18;
  }

  const stream = contentLines.join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
