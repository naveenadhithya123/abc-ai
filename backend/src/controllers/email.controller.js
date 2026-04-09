import { sendEmail } from "../services/brevo.service.js";
import { buildAnswerPdf } from "../utils/pdfGenerator.js";

export async function sendAnswerEmail(req, res) {
  try {
    const { to, subject, answer, question, attachPdf = false } = req.body;

    if (!to || !answer) {
      return res.status(400).json({ error: "to and answer are required." });
    }

    const safeQuestion = question || "AI Tutor Answer";
    const attachments = attachPdf
      ? [
          {
            name: "ai-tutor-answer.pdf",
            content: buildAnswerPdf({
              title: subject ?? "AI Tutor Answer",
              question: safeQuestion,
              answer,
            }).toString("base64"),
          },
        ]
      : [];

    const response = await sendEmail({
      to,
      subject: subject ?? "AI Tutor Answer",
      html: `
        <h2>AI Tutor Answer</h2>
        ${question ? `<p><strong>Question:</strong> ${question}</p>` : ""}
        <p><strong>Answer:</strong></p>
        <div>${answer.replace(/\n/g, "<br />")}</div>
      `,
      text: question
        ? `Question: ${question}\n\nAnswer:\n${answer}`
        : `Answer:\n${answer}`,
      attachments,
    });

    return res.json({ success: true, response });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
