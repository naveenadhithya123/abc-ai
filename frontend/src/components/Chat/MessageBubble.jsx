import { useEffect, useMemo, useState } from "react";

function renderInline(text) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    return <span key={index}>{part}</span>;
  });
}

function renderRichContent(content) {
  const segments = String(content || "").split("```");

  if (segments.length > 1) {
    return segments.map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) {
        const [firstLine, ...rest] = segment.split("\n");
        const language = firstLine.trim();
        const code = rest.join("\n").trimEnd();

        return (
          <div className="code-block-shell" key={`code-${segmentIndex}`}>
            <div className="code-block-label">{language || "code"}</div>
            <pre className="code-block">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      return <div key={`text-${segmentIndex}`}>{renderTextBlocks(segment)}</div>;
    });
  }

  return renderTextBlocks(content);
}

function renderTextBlocks(content) {
  const lines = String(content || "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#{1,3}\s+/, "");
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(<Tag key={`heading-${index}`}>{renderInline(text)}</Tag>);
      index += 1;
      continue;
    }

    const isMarkdownTable =
      /^\|.*\|$/.test(trimmed) &&
      index + 1 < lines.length &&
      /^\|?(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1].trim());

    if (isMarkdownTable) {
      const parseRow = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());

      const headers = parseRow(trimmed);
      index += 2;
      const rows = [];

      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        rows.push(parseRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div className="table-shell" key={`table-${index}`}>
          <table className="message-table">
            <thead>
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={headerIndex}>{renderInline(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*\u2022]\s+/.test(trimmed)) {
      const items = [];

      while (index < lines.length && /^[-*\u2022]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*\u2022]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];

      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return blocks;
}

export default function MessageBubble({ message, onSpeakMessage, isSpeaking, speakingText }) {
  const [displayedContent, setDisplayedContent] = useState(message.content || "");
  const isUser = message.role === "user";
  const isPending = message.status === "pending";
  const sources = message.sources || [];
  const hasImage = Boolean(message.imageUrl);
  const hasFile = Boolean(message.fileUrl);
  const downloadUrl = message.imageUrl?.includes("/upload/")
    ? message.imageUrl.replace("/upload/", "/upload/fl_attachment/")
    : message.imageUrl;
  const fileDownloadUrl = message.fileUrl?.includes("/upload/")
    ? message.fileUrl.replace("/upload/", "/upload/fl_attachment/")
    : message.fileUrl;
  const canReadAloud =
    !isUser &&
    displayedContent &&
    !message.imageUrl &&
    !isPending &&
    message.messageType !== "image_generation";
  const isCurrentSpeech = canReadAloud && isSpeaking && speakingText === displayedContent.trim();
  const shouldAnimate =
    !isUser &&
    !hasImage &&
    !isPending &&
    message.animate &&
    typeof message.content === "string" &&
    message.content.length > 0;

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedContent(message.content || "");
      return undefined;
    }

    setDisplayedContent("");
    let index = 0;
    const source = message.content || "";
    const timer = window.setInterval(() => {
      index = Math.min(source.length, index + Math.max(4, Math.ceil(source.length / 70)));
      setDisplayedContent(source.slice(0, index));
      if (index >= source.length) {
        window.clearInterval(timer);
      }
    }, 18);

    return () => window.clearInterval(timer);
  }, [message.content, shouldAnimate]);

  const renderedBody = useMemo(
    () => (isUser ? displayedContent : renderRichContent(displayedContent)),
    [displayedContent, isUser],
  );

  return (
    <article className={`message-row ${isUser ? "user" : "assistant"}`}>
      <div
        className={`message-card ${isUser ? "user" : "assistant"} ${isPending ? "pending" : ""} ${
          hasImage ? "has-image" : "text-only"
        }`}
      >
        <div className="message-body">
          {renderedBody}
          {shouldAnimate && displayedContent.length < (message.content || "").length ? (
            <span className="typing-cursor" aria-hidden="true" />
          ) : null}
        </div>

        {message.imageUrl ? (
          <div className="inline-image-card">
            <img src={message.imageUrl} alt="Attachment" />
            <div className="image-status">
              <span>{isPending ? "Processing..." : "Ready"}</span>
              {!isPending ? (
                <a
                  className="image-download-link"
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  Download
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        {hasFile ? (
          <div className="inline-file-card">
            <div className="inline-file-meta">
              <strong>{message.fileName || "generated-file"}</strong>
              <span>{isPending ? "Preparing file..." : "File ready"}</span>
            </div>
            {!isPending ? (
              <a
                className="image-download-link"
                href={fileDownloadUrl}
                target="_blank"
                rel="noreferrer"
                download
              >
                Download
              </a>
            ) : null}
          </div>
        ) : null}

        {sources.length ? (
          <div className="message-sources">
            {sources.map((source) => (
              <span key={`${source.documentId || source.title}-${source.title}`}>
                {source.title}
              </span>
            ))}
          </div>
        ) : null}

        {canReadAloud ? (
          <div className="message-actions">
            <button className="mini-read-button" onClick={() => onSpeakMessage?.(displayedContent)}>
              {isCurrentSpeech ? "Stop reading" : "Read aloud"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
