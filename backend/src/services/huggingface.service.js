/**
 * huggingface.service.js
 *
 * ALL calls go through https://router.huggingface.co (the new unified router).
 * The old https://api-inference.huggingface.co is no longer supported.
 *
 * - Chat / Vision / Quiz / Summarize  → HF Router OpenAI-compatible endpoint
 * - Embeddings                        → HF Router OpenAI-compatible endpoint (text-embedding)
 * - Speech-to-Text                    → HF Router OpenAI-compatible endpoint (audio/transcriptions)
 * - Text-to-Speech                    → HF Router OpenAI-compatible endpoint (audio/speech)
 * - Image generation                  → OpenAI (if key set) or Pollinations fallback
 */

import OpenAI from "openai";

const HF_TOKEN = process.env.HF_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── HF Router client (OpenAI-compatible) ──────────────────────────────────────
const hf = HF_TOKEN
  ? new OpenAI({
      baseURL: "https://router.huggingface.co/v1",
      apiKey: HF_TOKEN,
    })
  : null;

// ── Native OpenAI client (optional, for gpt-image-1) ─────────────────────────
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

// ── Model presets (all overridable via .env) ──────────────────────────────────
export const MODEL_PRESETS = {
  chat:        process.env.HF_CHAT_MODEL      || "Qwen/Qwen3-235B-A22B:novita",
  vision:      process.env.HF_VISION_MODEL    || "Qwen/Qwen2.5-VL-7B-Instruct",
  embeddings:  process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2",
  stt:         process.env.HF_STT_MODEL       || "openai/whisper-large-v3-turbo",
  tts:         process.env.HF_TTS_MODEL       || "hexgrad/Kokoro-82M",
  imageGen:    process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
};

function ensureHF() {
  if (!hf) throw new Error("HF_TOKEN is missing in backend/.env");
}

// ── 1. CHAT COMPLETION ────────────────────────────────────────────────────────
export async function chatCompletion({
  messages,
  model = MODEL_PRESETS.chat,
  temperature = 0.3,
  maxTokens = 1200,
}) {
  ensureHF();
  try {
    const completion = await hf.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });
    return completion.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    const message = String(error?.message || "");

    if (/429|rate limit|too many requests|status code \(no body\)/i.test(message)) {
      throw new Error("The AI model is busy right now. Please try again in a few seconds.");
    }

    if (/billing hard limit|insufficient quota/i.test(message)) {
      throw new Error("The AI service quota has been reached. Please check the API billing or try again later.");
    }

    throw error;
  }
}

// ── 2. VISION COMPLETION ──────────────────────────────────────────────────────
export async function visionCompletion({ question, imageUrl, context = "" }) {
  ensureHF();
  const systemText = context
    ? `You are an educational visual tutor. Answer using the image and the study context below.\n\nStudy context:\n${context}`
    : "You are an educational visual tutor. Inspect the image carefully and answer the student.";

  const completion = await hf.chat.completions.create({
    model: MODEL_PRESETS.vision,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: "system", content: systemText },
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── 3. IMAGE TEXT EXTRACTION (OCR-style via vision) ───────────────────────────
export async function extractImageText(imageUrl) {
  if (typeof imageUrl !== "string") return "";
  ensureHF();
  const completion = await hf.chat.completions.create({
    model: MODEL_PRESETS.vision,
    temperature: 0,
    max_tokens: 1200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all readable text from this image. Preserve structure, headings, bullet points, formulas, and code.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

// ── 4. EMBEDDINGS (via HF Router text-embedding endpoint) ─────────────────────
export async function embedTexts(texts) {
  ensureHF();
  // HF Router exposes embeddings at /v1/embeddings — same as OpenAI SDK
  const results = await Promise.all(
    texts.map(async (text) => {
      const response = await hf.embeddings.create({
        model: MODEL_PRESETS.embeddings,
        input: text,
      });
      return response.data?.[0]?.embedding ?? [];
    })
  );
  return results;
}

// ── 5. SUMMARIZE ──────────────────────────────────────────────────────────────
export async function summarizeText(text) {
  return chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You are a study companion. Produce a crisp student-friendly summary with key ideas, formulas, and likely exam focus areas.",
      },
      { role: "user", content: `Summarize this study content:\n\n${text}` },
    ],
    maxTokens: 700,
  });
}

// ── 6. QUIZ GENERATION ────────────────────────────────────────────────────────
function extractJsonBlock(raw) {
  const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("Model did not return valid JSON for quiz.");
  return JSON.parse(match[0]);
}

export async function generateQuiz({ sourceText, title, difficulty, count }) {
  const raw = await chatCompletion({
    messages: [
      {
        role: "system",
        content: "You create accurate educational quizzes. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Create a ${difficulty} quiz with ${count} multiple-choice questions for the topic "${title}".

Return JSON in this exact shape:
{
  "title": "string",
  "questions": [
    {
      "question": "string",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A. ...",
      "explanation": "string"
    }
  ]
}

Study material:
${sourceText.slice(0, 15000)}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 1400,
  });
  return extractJsonBlock(raw);
}

// ── 7. SPEECH-TO-TEXT (Whisper via HF Router audio/transcriptions) ────────────
export async function transcribeAudio(buffer, mimeType = "audio/webm") {
  ensureHF();

  // HF Router supports the OpenAI audio transcription endpoint
  const blob = new Blob([buffer], { type: mimeType });
  const file = new File([blob], "speech.webm", { type: mimeType });

  const transcription = await hf.audio.transcriptions.create({
    model: MODEL_PRESETS.stt,
    file,
  });

  return typeof transcription === "string"
    ? transcription
    : (transcription.text ?? "");
}

// ── 8. TEXT-TO-SPEECH (Kokoro via HF Router audio/speech) ─────────────────────
export async function speakText(text) {
  ensureHF();

  // HF Router supports the OpenAI audio speech endpoint
  const response = await hf.audio.speech.create({
    model: MODEL_PRESETS.tts,
    input: text.slice(0, 4096),
    voice: "af_heart",   // Kokoro voice id — change as desired
  });

  return Buffer.from(await response.arrayBuffer());
}

// ── 9. IMAGE GENERATION ───────────────────────────────────────────────────────

function isEducationalPosterPrompt(prompt = "") {
  return /(plan|roadmap|mind ?map|flowchart|diagram|study|notes|syllabus|learning path|poster|infographic)/i.test(prompt);
}

async function buildImageGenerationPrompt(prompt, conversationContext = "") {
  const rewritten = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "Convert user requests into precise image-generation prompts. Preserve the exact subject and intent. Use recent conversation context only when it clearly helps resolve what the user wants. Do not drift away from the user's latest request. Return one prompt only.",
      },
      {
        role: "user",
        content: conversationContext
          ? `Recent conversation context:\n${conversationContext}\n\nLatest user request:\n${prompt}\n\nRewrite the latest request into one precise image prompt that fits the context.`
          : `Rewrite into a precise image prompt:\n${prompt}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 220,
  });
  return rewritten.replace(/^["']|["']$/g, "").trim() || prompt;
}

async function buildEditedImagePrompt({ instruction, imageUrl }) {
  const prompt = await visionCompletion({
    question: `You are helping an image generation model edit a reference image.
User edit request: ${instruction}
Return ONE detailed generation prompt only. Keep same subject/framing/composition unless explicitly changed. No explanation.`,
    imageUrl,
  });
  return prompt.replace(/^["']|["']$/g, "").trim();
}

function enforceSceneAccuracy(prompt) {
  const lower = prompt.toLowerCase();
  if (/(salon|barber|hair studio)/i.test(lower)) {
    return `${prompt}, wide interior scene, styling chairs, mirrors, haircut stations, barber tools, realistic environment`;
  }
  if (/(shop|store|restaurant|classroom|office|library|room|building)/i.test(lower)) {
    return `${prompt}, wide establishing shot, realistic environment, full location visible`;
  }
  return prompt;
}

// SVG poster generator (no external API needed)
async function generatePosterSpec(prompt) {
  const raw = await chatCompletion({
    messages: [
      {
        role: "system",
        content: "You create clean study posters. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Create a concise educational poster specification for: "${prompt}".
Return JSON:
{
  "title": "short title",
  "subtitle": "one helpful subtitle",
  "sections": [{"heading": "...", "points": ["...", "..."]}]
}
Rules: 4-6 sections, 2-3 short points each, student-friendly.`,
      },
    ],
    temperature: 0.2,
    maxTokens: 900,
  });
  return extractJsonBlock(raw);
}

function escapeSvg(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapSvgText(text = "", maxChars = 28) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) { if (current) lines.push(current); current = word; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function createPosterSvg(spec) {
  const width = 1200, height = 900;
  const sections = (spec.sections || []).slice(0, 6);
  const cardW = 340, cardH = 190;
  const positions = [[80,220],[430,220],[780,220],[80,430],[430,430],[780,430]];

  const cards = sections.map((sec, i) => {
    const [x, y] = positions[i] || [80, 220 + i * 200];
    const heading = escapeSvg(sec.heading || `Step ${i+1}`);
    const points = (sec.points || []).slice(0, 3);
    const textMarkup = points.flatMap((pt, pi) =>
      wrapSvgText(pt, 28).map((line, li) =>
        `<text x="${x+24}" y="${y+72+pi*38+li*18}" font-size="20" fill="#CFE6FF" font-family="Segoe UI,Arial,sans-serif">• ${escapeSvg(line)}</text>`
      )
    ).join("");
    return `<g>
      <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="26" fill="rgba(15,24,42,0.82)" stroke="rgba(98,200,255,0.35)" stroke-width="2"/>
      <text x="${x+24}" y="${y+42}" font-size="26" font-weight="700" fill="#F2F7FF" font-family="Segoe UI,Arial,sans-serif">${heading}</text>
      ${textMarkup}
    </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#081120"/><stop offset="55%" stop-color="#0D1830"/><stop offset="100%" stop-color="#13233E"/>
    </linearGradient>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5EC9FF"/><stop offset="100%" stop-color="#96E6FF"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="1030" cy="110" r="180" fill="rgba(94,201,255,0.12)"/>
  <circle cx="170" cy="760" r="220" fill="rgba(94,201,255,0.08)"/>
  <text x="80" y="92" font-size="52" font-weight="800" fill="#F4F8FF" font-family="Segoe UI,Arial,sans-serif">${escapeSvg(spec.title||"Study Poster")}</text>
  <text x="80" y="138" font-size="24" fill="url(#ac)" font-family="Segoe UI,Arial,sans-serif">${escapeSvg(spec.subtitle||"")}</text>
  ${cards}
</svg>`;
}

export async function generateImageFromPrompt(prompt, options = {}) {
  const { referenceImageUrl, conversationContext = "" } = options;

  // Educational posters → SVG (no API cost)
  if (!referenceImageUrl && isEducationalPosterPrompt(prompt)) {
    const spec = await generatePosterSpec(prompt);
    return { buffer: Buffer.from(createPosterSvg(spec)), mimeType: "image/svg+xml", extension: "svg" };
  }

  // Build the final prompt
  const finalPrompt = referenceImageUrl
    ? await buildEditedImagePrompt({ instruction: prompt, imageUrl: referenceImageUrl })
    : enforceSceneAccuracy(await buildImageGenerationPrompt(prompt, conversationContext));

  // Try OpenAI gpt-image-1 first, but fall back automatically if billing/limits fail.
  if (openai) {
    try {
      const response = await openai.images.generate({
        model: MODEL_PRESETS.imageGen,
        prompt: `high quality, sharp focus, realistic details, clean composition, exact subject match: ${finalPrompt}`,
        size: "1024x1024",
      });
      const image = response.data?.[0];
      if (image?.b64_json) {
        return { buffer: Buffer.from(image.b64_json, "base64"), mimeType: "image/png", extension: "png" };
      }
      if (image?.url) {
        const remote = await fetch(image.url);
        if (!remote.ok) throw new Error(`OpenAI image URL fetch failed ${remote.status}`);
        return { buffer: Buffer.from(await remote.arrayBuffer()), mimeType: "image/png", extension: "png" };
      }
    } catch (_error) {
      // Fall through to the free fallback below.
    }
  }

  // Fallback → Pollinations (free, no key needed)
  const encoded = encodeURIComponent(
    `high quality, sharp focus, realistic: ${finalPrompt}`
  );
  const url = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&nologo=true&safe=true&enhance=true`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Pollinations failed with ${response.status}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: "image/png", extension: "png" };
}

export function isImageGenerationPrompt(prompt = "") {
  const normalized = prompt.trim().toLowerCase();
  return /\b(generate|create)\b\s+.*\b(image|picture|photo|illustration|art|logo|poster|diagram)\b/i.test(normalized);
}
