import { v4 as uuid } from "uuid";
import {
  buildConversationMessages,
  buildTutorSystemPrompt,
  extractTitleFromPrompt,
} from "../utils/promptBuilder.js";
import {
  chatCompletion,
  generateImageFromPrompt,
  isImageGenerationPrompt,
  visionCompletion,
} from "../services/huggingface.service.js";
import { uploadBuffer } from "../services/cloudinary.service.js";
import { buildGeneratedDocument, hasLiteralContentRequest } from "../utils/documentGenerator.js";
import {
  createChat,
  getDocumentsByIds,
  listDocumentChunks,
  listChatsByUser,
  saveMessage,
} from "../services/supabase.service.js";

function isCodingPrompt(message = "") {
  const normalized = String(message).toLowerCase();
  return /\b(code|coding|program|function|class|bug|debug|fix|algorithm|dsa|data structure|react|node|express|html|css|javascript|typescript|java|python|sql|api|portfolio|website|web page|app)\b/i.test(
    normalized,
  );
}

function isDocumentPrompt(message = "") {
  const normalized = String(message).toLowerCase();
  return /\b(pdf|document|doc|notes|chapter|lecture|file|summary|summarize|extract|explain this pdf|question from pdf|content|image|screenshot)\b/i.test(
    normalized,
  );
}

function isCreatorPrompt(message = "") {
  const normalized = String(message).toLowerCase();
  return /\b(create|generate|make|build)\b.*\b(pdf|doc|docx|word|text file|txt|worksheet|handout|notes|document|file)\b/i.test(
    normalized,
  ) || /\b(pdf|doc|docx|word|txt|text file|document|file)\b/i.test(normalized);
}

function scoreChunk(content = "", query = "") {
  const normalizedContent = content.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);

  let score = 0;

  for (const token of tokens) {
    if (normalizedContent.includes(token)) {
      score += token.length > 5 ? 3 : 2;
    }
  }

  if (normalizedContent.includes(query.toLowerCase())) {
    score += 8;
  }

  return score;
}

function buildImageConversationContext(history = []) {
  return history
    .filter((item) => item?.role && item?.content)
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
}

function isSimpleChatPrompt(message = "") {
  const normalized = String(message).trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^(hi|hello|hey|hii|helo|good morning|good afternoon|good evening|okay|ok|thanks|thank you|yo|sup|what's up|whats up)$/.test(
    normalized,
  );
}

function buildSimpleChatReply(message = "") {
  const normalized = String(message).trim().toLowerCase();

  if (/^thanks|^thank you/.test(normalized)) {
    return "You're welcome. If you want, ask your next question and I'll help right away.";
  }

  if (/^okay|^ok$/.test(normalized)) {
    return "Okay. Tell me what you want to do next, and I'll help you step by step.";
  }

  return "Hi. What would you like help with today: study, coding, documents, file creation, quiz prep, or images?";
}

function buildModeRefusal(mode = "study") {
  if (mode === "coding") {
    return "I'm Code AI. I can help with coding, debugging, algorithms, websites, apps, and programming concepts only.";
  }

  if (mode === "images") {
    return "I'm Image AI. I can create or edit images for you. Ask like `generate an image of ...` or `create an image of ...`.";
  }

  if (mode === "documents") {
    return "I'm Document AI. I work with PDFs, notes, screenshots, summaries, and document-based questions. Upload a file or ask something about a document.";
  }

  if (mode === "creator") {
    return "I'm Creator AI. I create downloadable PDF, DOC-style, and TXT study files for you.";
  }

  return "";
}

function mapChatError(error) {
  const message = String(error?.message || "");

  if (/429|rate limit|too many requests|status code \(no body\)/i.test(message)) {
    return "The AI model is busy right now. Please try again in a few seconds.";
  }

  if (/billing hard limit|insufficient quota/i.test(message)) {
    return "The AI service quota has been reached. Please check the API billing or try again later.";
  }

  if (/not supported by any provider/i.test(message)) {
    return "That analysis model is unavailable right now. Please try a simpler text-based question or upload a clearer text image.";
  }

  return message || "Something went wrong while generating the answer.";
}

function buildImageContextPrompt(message = "", imageContext = "") {
  return `Image context:\n${imageContext || "No text could be extracted from the image."}\n\nStudent request:\n${message || "Summarize this image in a simple way."}`;
}

function getLastCreatorUserPrompt(history = []) {
  const previousUserMessages = [...history]
    .reverse()
    .filter((item) => item?.role === "user" && item?.content)
    .map((item) => item.content);

  return previousUserMessages.find((content) =>
    /\b(create|generate|make|build)\b.*\b(pdf|doc|docx|word|text file|txt|worksheet|handout|notes|document|file)\b/i.test(
      content,
    ),
  ) || "";
}

export async function sendMessage(req, res) {
  try {
    const {
      chatId,
      userId,
      message,
      history = [],
      documentIds = [],
      imageUrl,
      imageContext = "",
      forceImageGeneration = false,
      mode = "study",
    } = req.body;

    if (!message && !imageUrl) {
      return res.status(400).json({ error: "message or imageUrl is required." });
    }

    const activeChatId = chatId ?? uuid();
    let contextChunks = [];
    let retrievedContext = "";

    const wantsGeneratedImage =
      Boolean(forceImageGeneration) ||
      (typeof message === "string" && isImageGenerationPrompt(message));

    if (message && documentIds.length > 0 && userId) {
      const chunks = await listDocumentChunks(userId, documentIds, 120);
      contextChunks = chunks
        .map((chunk) => ({
          ...chunk,
          similarity: scoreChunk(chunk.content, message),
        }))
        .filter((chunk) => chunk.similarity > 0)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 6);

      retrievedContext = contextChunks
        .map(
          (chunk, index) =>
            `Source ${index + 1} (${chunk.document_title ?? "Document"}): ${chunk.content}`,
        )
        .join("\n\n");

      if (!retrievedContext) {
        const documents = await getDocumentsByIds(userId, documentIds);
        retrievedContext = documents
          .map((document, index) => {
            const fallbackText =
              document.extracted_text?.trim() || document.summary?.trim() || "";

            if (!fallbackText) {
              return "";
            }

            return `Document ${index + 1} (${document.title}): ${fallbackText.slice(0, 4000)}`;
          })
          .filter(Boolean)
          .join("\n\n");
      }
    }

    const systemPrompt = buildTutorSystemPrompt(mode);
    const messages = buildConversationMessages({
      systemPrompt,
      history,
      userMessage: message,
      retrievedContext,
    });

    const modeRefusal =
      mode === "coding" && message && !isCodingPrompt(message)
        ? buildModeRefusal("coding")
        : mode === "images" && !wantsGeneratedImage
          ? buildModeRefusal("images")
          : mode === "documents" &&
              message &&
              !documentIds.length &&
              !imageUrl &&
              !isDocumentPrompt(message)
            ? buildModeRefusal("documents")
            : mode === "creator" && message && !isCreatorPrompt(message)
              ? buildModeRefusal("creator")
              : "";

    let answer = "";
    let generatedImageUrl = null;
    let generatedFileUrl = null;
    let generatedFileName = null;
    let messageType = "chat";

    if (modeRefusal && !isSimpleChatPrompt(message)) {
      answer = modeRefusal;
    } else if (!wantsGeneratedImage && !imageUrl && isSimpleChatPrompt(message)) {
      answer = buildSimpleChatReply(message);
    } else if (mode === "creator") {
      const previousCreatorPrompt = getLastCreatorUserPrompt(history);
      const creatorPrompt = previousCreatorPrompt
        ? `${previousCreatorPrompt}\n\nFollow-up correction: ${message}`
        : message;

      let generatedContent = "";

      if (!hasLiteralContentRequest(creatorPrompt)) {
        generatedContent = await chatCompletion({
          messages: buildConversationMessages({
            systemPrompt,
            history,
            userMessage: `${creatorPrompt}

Create the final file content only.
Do not explain how to make the file.
Do not add instructions.
If the user asks for one word or one short sentence only, output exactly that content only.`,
            retrievedContext,
          }),
          maxTokens: 1800,
        });
      }

      const generatedDocument = buildGeneratedDocument({
        prompt: creatorPrompt,
        content: generatedContent,
      });

      const uploadedFile = await uploadBuffer(generatedDocument.buffer, {
        folder: "edu-ai/generated-files",
        filename: generatedDocument.filename,
        mimeType: generatedDocument.mimeType,
        resourceType: "raw",
      });

      generatedFileUrl = uploadedFile.secureUrl;
      generatedFileName = generatedDocument.filename;
      messageType = "generated_document";
      answer = `Your file is ready. I created ${generatedDocument.filename} for you.`;
    } else if (wantsGeneratedImage) {
      const conversationContext = buildImageConversationContext(history);
      const generatedAsset = await generateImageFromPrompt(message, {
        referenceImageUrl: imageUrl || undefined,
        conversationContext,
      });

      const uploaded = await uploadBuffer(generatedAsset.buffer, {
        folder: "edu-ai/generated",
        filename: `generated-${Date.now()}.${generatedAsset.extension}`,
        mimeType: generatedAsset.mimeType,
        resourceType: "image",
      });

      generatedImageUrl = uploaded.secureUrl;
      messageType = "image_generation";
      answer = imageUrl
        ? "Here is the edited image based on your reference."
        : "Here is the generated image.";
    } else if (imageUrl && imageContext) {
      answer = await chatCompletion({
        messages: [
          {
            role: "system",
            content:
              "You are helping a student understand an uploaded image. Use the extracted text or the existing image summary first. If the context is limited, still help clearly without inventing details.",
          },
          {
            role: "user",
            content: buildImageContextPrompt(message, imageContext),
          },
        ],
        maxTokens: 900,
      });
    } else if (imageUrl) {
      try {
        answer = await visionCompletion({
          question: message || "Explain this image for a student.",
          imageUrl,
          context: retrievedContext,
        });
      } catch (_error) {
        answer =
          "I can see the uploaded image is attached, but advanced visual analysis is limited right now. If the image contains text, try uploading a clearer version or tell me exactly what you want me to explain.";
      }
    } else {
      answer = await chatCompletion({ messages });
    }

    if (userId) {
      await createChat({
        id: activeChatId,
        user_id: userId,
        title: extractTitleFromPrompt(message || "New chat"),
      });

      if (message) {
        await saveMessage({
          chat_id: activeChatId,
          role: "user",
          content: message,
          metadata: {
            imageUrl: imageUrl ?? null,
            imageContext: imageContext || null,
            documentIds,
            mode,
          },
        });
      }

      await saveMessage({
        chat_id: activeChatId,
        role: "assistant",
        content: answer,
        metadata: {
          imageUrl: generatedImageUrl,
          fileUrl: generatedFileUrl,
          fileName: generatedFileName,
          messageType,
          mode,
          sources: contextChunks.map((chunk) => ({
            id: chunk.document_id,
            title: chunk.document_title,
            similarity: chunk.similarity,
          })),
        },
      });
    }

    return res.json({
      chatId: activeChatId,
      answer,
      generatedImageUrl,
      generatedFileUrl,
      generatedFileName,
      messageType,
      sources: contextChunks.map((chunk) => ({
        documentId: chunk.document_id,
        title: chunk.document_title,
        similarity: chunk.similarity,
      })),
    });
  } catch (error) {
    const friendlyError = mapChatError(error);
    const statusCode = /busy right now|quota has been reached/i.test(friendlyError) ? 503 : 500;
    return res.status(statusCode).json({ error: friendlyError });
  }
}

export async function getChatHistory(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "userId is required." });
    }

    const chats = await listChatsByUser(userId);
    return res.json({ chats });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
