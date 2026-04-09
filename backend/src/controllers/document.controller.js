import { uploadBuffer } from "../services/cloudinary.service.js";
import { embedTexts, summarizeText } from "../services/huggingface.service.js";
import { extractTextFromBuffer } from "../services/ocr.service.js";
import { saveDocument, saveDocumentChunks } from "../services/supabase.service.js";
import { extractPdfText } from "../utils/pdfParser.js";
import { chunkText } from "../utils/textChunks.js";

function isSoftOcrLimitError(message = "") {
  return /large file|1024\s*kb|1\s*mb|maximum permissible file size/i.test(String(message));
}

export async function uploadDocument(req, res) {
  try {
    const file = req.file;
    const { userId } = req.body;

    if (!file) {
      return res.status(400).json({ error: "A file is required." });
    }

    const uploaded = await uploadBuffer(file.buffer, {
      folder: "edu-ai/documents",
      filename: file.originalname,
      mimeType: file.mimetype,
      resourceType: "auto",
    });

    let extractedText = "";
    let extractionNote = "";
    let summary = "";

    if (file.mimetype === "application/pdf") {
      try {
        extractedText = await extractPdfText(file.buffer);

        if (!extractedText?.trim()) {
          extractedText = await extractTextFromBuffer(
            file.buffer,
            file.originalname,
            file.mimetype,
          );
        }
      } catch (error) {
        extractionNote =
          isSoftOcrLimitError(error.message || "")
            ? "Ready"
            : error.message || "OCR extraction failed for this PDF.";
      }
    } else if (file.mimetype.startsWith("text/")) {
      extractedText = file.buffer.toString("utf8");
    } else if (file.mimetype.startsWith("image/")) {
      try {
        extractedText = await extractTextFromBuffer(
          file.buffer,
          file.originalname,
          file.mimetype,
        );
      } catch (error) {
        extractionNote =
          isSoftOcrLimitError(error.message || "")
            ? "Ready"
            : error.message || "OCR extraction failed for this image.";
      }
    } else {
      extractedText = file.buffer.toString("utf8");
    }

    if (extractedText) {
      try {
        summary = await summarizeText(extractedText.slice(0, 12000));
      } catch (error) {
        summary =
          extractedText.slice(0, 1200) ||
          "The file was uploaded, but automatic summarization was limited.";
        extractionNote ||= error.message || "Summarization was limited for this file.";
      }
    } else {
      summary =
        extractionNote && extractionNote !== "Ready"
          ? extractionNote
          : "The file was uploaded successfully. Ask me to summarize or explain it.";
    }

    const document = await saveDocument({
      user_id: userId ?? null,
      title: file.originalname,
      file_url: uploaded.secureUrl,
      mime_type: file.mimetype,
      extracted_text: extractedText,
      summary,
    });

    const chunks = chunkText(extractedText);

    if (document?.id && userId && chunks.length > 0) {
      try {
        const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
        await saveDocumentChunks(
          document.id,
          userId,
          chunks.map((chunk, index) => ({
            chunk_index: index,
            content: chunk.content,
            embedding: embeddings[index],
          })),
        );
      } catch (error) {
        extractionNote ||= error.message || "Document embeddings were skipped.";
      }
    }

    return res.json({
      document,
      summary,
      extractedText,
      chunkCount: chunks.length,
      fileUrl: uploaded.secureUrl,
      extractionNote,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
