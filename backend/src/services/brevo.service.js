function ensureBrevoConfig() {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing in backend/.env");
  }
}

export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  ensureBrevoConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          email: process.env.BREVO_SENDER_EMAIL,
          name: process.env.BREVO_SENDER_NAME || "Edu AI Tutor",
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        attachment: attachments,
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Brevo email request failed.");
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Email request timed out. Please check Brevo configuration and try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
