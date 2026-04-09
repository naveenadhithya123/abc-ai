import MessageBubble from "./MessageBubble.jsx";

const SUGGESTIONS = [
  { emoji: "📚", text: "Explain Newton's laws of motion simply" },
  { emoji: "💻", text: "Write a Python function to sort a list" },
  { emoji: "🧠", text: "What is the difference between RAM and ROM?" },
  { emoji: "📄", text: "Upload a PDF and ask me to summarize it" },
  { emoji: "🎨", text: "Generate an image of the solar system" },
  { emoji: "🎓", text: "Type /quiz after uploading a document" },
];

export default function ChatWindow({ messages, onSpeakMessage, isSpeaking, speakingText }) {
  const showWelcome = messages.length <= 1 && messages[0]?.id === "welcome-message";

  return (
    <section className="conversation-scroll">
      <div className="conversation-inner">
        {showWelcome ? (
          <div className="welcome-screen">
            <div className="welcome-icon">🎓</div>
            <h2>How can I help you learn today?</h2>
            <p>Ask me anything, attach images or PDFs, use voice input, or try these:</p>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  className="suggestion-chip"
                  onClick={() => {
                    // dispatch a custom event that App.jsx can listen to
                    window.dispatchEvent(new CustomEvent("edu-suggestion", { detail: s.text }));
                  }}
                >
                  <span className="suggestion-emoji">{s.emoji}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onSpeakMessage={onSpeakMessage}
              isSpeaking={isSpeaking}
              speakingText={speakingText}
            />
          ))
        )}
      </div>
    </section>
  );
}
