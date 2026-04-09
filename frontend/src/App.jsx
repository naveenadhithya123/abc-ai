import { useEffect, useMemo, useRef, useState } from "react";
import Login from "./components/Auth/Login.jsx";
import Signup from "./components/Auth/Signup.jsx";
import ChatWindow from "./components/Chat/ChatWindow.jsx";
import InputBar from "./components/Chat/InputBar.jsx";
import SidebarHistory from "./components/Chat/SidebarHistory.jsx";
import { useChat } from "./hooks/useChat.js";
import { useFileUpload } from "./hooks/useFileUpload.js";
import { useSpeech } from "./hooks/useSpeech.js";
import {
  bootstrapProfile,
  generateQuiz,
  sendAnswerEmail,
} from "./services/api.js";
import { supabase } from "./services/supabase.js";

const authEnabled = import.meta.env.VITE_ENABLE_AUTH === "true";

const AI_SPACES = [
  { id: "study", name: "Study AI", subtitle: "Concepts, exams, learning plans" },
  { id: "coding", name: "Code AI", subtitle: "Programming, debugging, web apps" },
  { id: "images", name: "Image AI", subtitle: "Generate and edit images only" },
  { id: "documents", name: "Document AI", subtitle: "PDFs, notes, summaries" },
  { id: "creator", name: "Document Creator AI", subtitle: "Generate PDF, Word, and text files" },
];

const MODE_PLACEHOLDERS = {
  study: "Ask a study question, topic doubt, or learning plan",
  coding: "Ask for code, debugging, website creation, or DSA help",
  images: "Ask like: generate an image of a classroom",
  documents: "Upload a PDF and ask about the document",
  creator: "Ask me to create a PDF, DOC, TXT, notes, or study handout",
};

function inferChatMode(chat) {
  const latestMode = [...(chat.messages || [])]
    .reverse()
    .find((message) => message.metadata?.mode)?.metadata?.mode;

  if (latestMode) {
    return latestMode;
  }

  const title = String(chat.title || "").toLowerCase();

  if (/\b(image|picture|photo|poster|illustration|art)\b/.test(title)) {
    return "images";
  }

  if (/\b(code|coding|html|css|javascript|react|node|python|java|portfolio|bug|debug|dsa)\b/.test(title)) {
    return "coding";
  }

  if (/\b(pdf|document|notes|summary|chapter|lecture|file)\b/.test(title)) {
    return "documents";
  }

  if (/\b(create pdf|create doc|word file|document creator|make pdf|make doc|generate file)\b/.test(title)) {
    return "creator";
  }

  return "study";
}

function looksLikeImageRequest(text) {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\b(generate|create)\b\s+.*\b(image|picture|photo|illustration|art|logo|poster|diagram)\b/i.test(
    normalized,
  );
}

function parseEmailIntent(text, lastAssistantAnswer, lastQuestion) {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (!emailMatch || !/\b(send|mail|email)\b/i.test(text)) {
    return null;
  }

  const to = emailMatch[0];
  const attachPdf = /\bpdf\b/i.test(text);
  const naturalMatch = text.match(
    /^(?:send|mail|email)\s+(.+?)\s+(?:to\s+(?:this\s+)?email|to)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*$/i,
  );

  const explicitAnswer = naturalMatch?.[1]?.trim();
  const answer =
    explicitAnswer && !/\b(answer|latest answer)\b/i.test(explicitAnswer)
      ? explicitAnswer
      : lastAssistantAnswer || "No previous answer was available.";

  return {
    to,
    attachPdf,
    answer,
    question: explicitAnswer && answer === explicitAnswer ? "" : lastQuestion,
    subject: attachPdf ? "AI Tutor Answer PDF" : "AI Tutor Answer",
  };
}

export default function App() {
  const [authMode, setAuthMode] = useState("login");
  const [session, setSession] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeMode, setActiveMode] = useState("study");
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [composerValue, setComposerValue] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [activeDocumentIds, setActiveDocumentIds] = useState([]);
  const fileInputRef = useRef(null);

  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;

  const {
    chats,
    currentChatId,
    messages,
    isLoading,
    lastAssistantAnswer,
    loadHistory,
    startNewChat,
    openChat,
    sendMessage,
    appendAssistantMessage,
  } = useChat({ userId });

  const { uploadDocument, uploadImage, uploadState } = useFileUpload();
  const {
    isRecording,
    audioLevel,
    transcript,
    isSpeaking,
    speakingText,
    startRecording,
    stopRecording,
    speak,
  } = useSpeech();

  useEffect(() => {
    if (!supabase || !authEnabled) {
      return undefined;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        await bootstrapProfile({
          id: nextSession.user.id,
          email: nextSession.user.email,
          fullName: nextSession.user.user_metadata?.full_name || "",
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) {
      loadHistory();
    }
  }, [userId]);

  const canUseApp = !authEnabled || !!session || !supabase;

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => inferChatMode(chat) === activeMode);
  }, [activeMode, chats]);

  function handleNewChat() {
    startNewChat();
    setPendingAttachments([]);
    setActiveDocumentIds([]);
    setComposerValue("");
  }

  async function attachFile(file) {
    setIsUploadingAttachment(true);
    const optimisticAttachment = {
      id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      type: file.type.startsWith("image/") ? "image" : "document",
      status: "uploading",
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    };

    setPendingAttachments((previous) => [...previous, optimisticAttachment]);

    try {
      const result = file.type.startsWith("image/")
        ? await uploadImage(file)
        : await uploadDocument(file, userId);

      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.id === optimisticAttachment.id
            ? {
                ...item,
                status: "ready",
                imageUrl: result.imageUrl || result.fileUrl || "",
                documentId: result.document?.id || null,
                summary: result.summary || "",
                extractedText: result.extractedText || "",
                note:
                  result.document?.id || result.imageUrl
                    ? "Ready"
                    : result.extractionNote || result.fallbackNote || "",
              }
            : item,
        ),
      );

      if (result.document?.id) {
        setActiveDocumentIds((previous) =>
          previous.includes(result.document.id) ? previous : [...previous, result.document.id],
        );
      }

      if (file.type.startsWith("image/")) {
        const autoSummary = result.answer || result.summary;
        if (autoSummary) {
          appendAssistantMessage({
            id: `assistant-image-upload-${Date.now()}`,
            role: "assistant",
          content: autoSummary,
          status: "done",
          animate: true,
          metadata: { mode: activeMode },
          messageType: "chat",
        });
        }
      }
    } catch (error) {
      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.id === optimisticAttachment.id
            ? { ...item, status: "error", error: error.message }
            : item,
        ),
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  async function handleFilePicker(event) {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      await attachFile(file);
    }
    event.target.value = "";
  }

  async function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) {
      return;
    }

    event.preventDefault();
    for (const file of files) {
      await attachFile(file);
    }
  }

  function removeAttachment(id) {
    const removed = pendingAttachments.find((item) => item.id === id);
    setPendingAttachments((previous) => previous.filter((item) => item.id !== id));

    if (removed?.documentId) {
      setActiveDocumentIds((previous) =>
        previous.filter((documentId) => documentId !== removed.documentId),
      );
    }
  }

  async function handleMic() {
    if (isRecording) {
      setIsProcessingAction(true);
      const text = await stopRecording();
      if (text) {
        setComposerValue(text);
      }
      setIsProcessingAction(false);
      return;
    }

    await startRecording(false);
  }

  async function handleSend() {
    let draftValue = composerValue;

    if (isRecording) {
      setIsProcessingAction(true);
      const text = await stopRecording();
      if (text) {
        const nextValue = `${draftValue}${draftValue ? " " : ""}${text}`.trim();
        setComposerValue(nextValue);
        draftValue = nextValue;
        setIsProcessingAction(false);
        if (!nextValue) {
          return;
        }
      } else {
        setIsProcessingAction(false);
      }
    }

    const hasUploadingAttachments = pendingAttachments.some((item) => item.status === "uploading");

    if (isLoading || isProcessingAction || hasUploadingAttachments) {
      return;
    }

    const trimmed = draftValue.trim();
    const readyDocs = pendingAttachments
      .filter((item) => item.status === "ready" && item.type === "document")
      .map((item) => item.documentId)
      .filter(Boolean);
    const documentIds = [...new Set([...activeDocumentIds, ...readyDocs])];
    const readyImage = pendingAttachments.find(
      (item) => item.status === "ready" && item.type === "image",
    );
    const imageContext = [readyImage?.summary, readyImage?.extractedText]
      .filter(Boolean)
      .join("\n\n");

    if (!trimmed && !readyImage) {
      return;
    }

    setIsProcessingAction(true);
    setComposerValue("");

    const asksQuiz = /^\/quiz\b/i.test(trimmed);
    const emailIntent = /^\/email\s+/i.test(trimmed)
      ? (() => {
          const match = trimmed.match(/^\/email\s+([^\s]+)\s*(.*)$/i);
          if (!match) {
            return null;
          }
          return {
            to: match[1],
            attachPdf: /\bpdf\b/i.test(match[2] || ""),
            answer: lastAssistantAnswer || "No previous answer was available.",
            question: lastQuestion,
            subject: /\bpdf\b/i.test(match[2] || "") ? "AI Tutor Answer PDF" : "AI Tutor Answer",
          };
        })()
      : parseEmailIntent(trimmed, lastAssistantAnswer, lastQuestion);
    const asksImage = looksLikeImageRequest(trimmed);

    setLastQuestion(trimmed);

    if (asksQuiz) {
      const sourceText =
        pendingAttachments.find((item) => item.extractedText)?.extractedText || "";
      const quizResult = await generateQuiz({
        sourceText,
        title: "Study Quiz",
        difficulty: "medium",
        count: 5,
      });

      appendAssistantMessage({
        id: `assistant-quiz-${Date.now()}`,
        role: "assistant",
        content: `Quiz ready:\n\n${quizResult.quiz.questions
          .map(
            (item, index) =>
              `${index + 1}. ${item.question}\nOptions: ${item.options.join(", ")}\nAnswer: ${item.answer}`,
          )
          .join("\n\n")}`,
        status: "done",
      });

      setIsProcessingAction(false);
      return;
    }

    if (emailIntent) {
      try {
        await sendAnswerEmail(emailIntent);
        appendAssistantMessage({
          id: `assistant-email-${Date.now()}`,
          role: "assistant",
          content: emailIntent.attachPdf
            ? `Sent the answer to ${emailIntent.to} with a PDF attachment.`
            : `Sent the answer to ${emailIntent.to}.`,
          status: "done",
        });
      } catch (error) {
        appendAssistantMessage({
          id: `assistant-email-error-${Date.now()}`,
          role: "assistant",
          content:
            error.message ||
            "I could not send the email right now. Please check the email configuration and try again.",
          status: "done",
        });
      } finally {
        setIsProcessingAction(false);
      }
      return;
    }

    const optimisticAssistant = {
      id: `assistant-pending-${Date.now()}`,
      role: "assistant",
      content: asksImage ? "Generating image..." : "Thinking...",
      imageUrl: "",
      messageType: asksImage ? "image_generation" : "chat",
      status: "pending",
    };

    try {
      await sendMessage({
        content: trimmed,
        documentIds,
        imageUrl: readyImage?.imageUrl || undefined,
        imageContext: imageContext || undefined,
        forceImageGeneration: asksImage,
        optimisticAssistant,
        mode: activeMode,
      });

      setPendingAttachments([]);
    } finally {
      setIsProcessingAction(false);
    }
  }

  function handleOpenChat(chat) {
    openChat(chat);
    setPendingAttachments([]);
    setActiveMode(inferChatMode(chat));
    const linkedDocumentIds = [
      ...new Set(
        (chat.messages || [])
          .flatMap((message) => message.metadata?.documentIds || [])
          .filter(Boolean),
      ),
    ];
    setActiveDocumentIds(linkedDocumentIds);
  }

  if (!canUseApp) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>AI Hackathon</h1>
          <p>Sign in to save chats, attachments, and folders in Supabase.</p>
          {authMode === "login" ? (
            <Login onSwitch={() => setAuthMode("signup")} />
          ) : (
            <Signup onSwitch={() => setAuthMode("login")} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chatgpt-shell">
      <aside className={`left-rail ${sidebarOpen ? "open" : "collapsed"}`}>
        <div className="sidebar-top">
            <button className="icon-button" onClick={() => setSidebarOpen((value) => !value)}>
              {sidebarOpen ? "<<" : ">>"}
            </button>
            {sidebarOpen ? (
            <button className="new-chat-button" onClick={handleNewChat}>
              New chat
            </button>
          ) : null}
        </div>

        {sidebarOpen ? (
          <>
            <div className="sidebar-panel sidebar-tools-panel">
              <div className="sidebar-section-head">
                <span>AI Spaces</span>
                <span className="sidebar-section-note">Specialist assistants</span>
              </div>
              <div className="folder-list folder-grid">
                {AI_SPACES.map((folder) => (
                  <button
                    key={folder.id}
                    className={`folder-chip ${activeMode === folder.id ? "active" : ""}`}
                    onClick={() => {
                      setActiveMode(folder.id);
                      handleNewChat();
                    }}
                  >
                    <span className="folder-chip-title">{folder.name}</span>
                    <span className="folder-chip-subtitle">{folder.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sidebar-panel sidebar-history-panel">
              <div className="sidebar-section-head">
                <span>Recent Chats</span>
                <span className="sidebar-section-count">{filteredChats.length}</span>
              </div>
              <SidebarHistory
                chats={filteredChats}
                currentChatId={currentChatId}
                onSelectChat={handleOpenChat}
              />
            </div>
          </>
        ) : null}
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div>
            <h1>AI Hackathon</h1>
            <p>{AI_SPACES.find((space) => space.id === activeMode)?.subtitle || "Advanced AI workspace"}</p>
          </div>
          <div className="topbar-actions">
            <div className="user-badge">{userEmail || "Guest mode"}</div>
          </div>
        </header>

        <ChatWindow
          messages={messages}
          onSpeakMessage={speak}
          isSpeaking={isSpeaking}
          speakingText={speakingText}
        />

        <InputBar
          value={composerValue}
          onChange={setComposerValue}
          onSend={handleSend}
          onPaste={handlePaste}
          disabled={isLoading}
          isRecording={isRecording}
          audioLevel={audioLevel}
          transcript={transcript}
          uploadState={uploadState}
          attachments={pendingAttachments}
          onRemoveAttachment={removeAttachment}
          onOpenFilePicker={() => fileInputRef.current?.click()}
          onMic={handleMic}
          isBusy={isLoading || isProcessingAction}
          hasUploadingAttachments={isUploadingAttachment || pendingAttachments.some((item) => item.status === "uploading")}
          placeholder={MODE_PLACEHOLDERS[activeMode]}
        />

        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.txt,.md,.png,.jpg,.jpeg,image/*"
          onChange={handleFilePicker}
        />
      </main>
    </div>
  );
}
