import { type FC, useEffect, useMemo, useRef } from "react";
import { BotIcon, UserIcon } from "lucide-react";
import { useClaudeChatStore, type ClaudeStreamMessage, type ContentBlock } from "@/stores/claude-chat-store";
import { MarkdownRenderer } from "./markdown-renderer";
import { ToolWidget } from "./tool-widgets";

export const ChatMessages: FC = () => {
  const messages = useClaudeChatStore((s) => s.messages);
  const isStreaming = useClaudeChatStore((s) => s.isStreaming);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Build a map of tool_use_id → tool_result for inline display
  const toolResultMap = useMemo(() => {
    const map = new Map<string, ContentBlock>();
    for (const msg of messages) {
      if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            map.set(block.tool_use_id, block);
          }
        }
      }
    }
    return map;
  }, [messages]);

  // Filter displayable messages
  const displayMessages = useMemo(() => {
    // Collect all assistant text for dedup against result
    const assistantTexts = new Set<string>();
    for (const msg of messages) {
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            assistantTexts.add(block.text.trim());
          }
        }
      }
    }

    return messages.filter((msg) => {
      // Skip system:init
      if (msg.type === "system" && msg.subtype === "init") return false;
      // Skip non-displayable event types (rate_limit_event, etc.)
      if (msg.type !== "user" && msg.type !== "assistant" && msg.type !== "result") return false;
      // Skip user messages that only contain tool_results
      if (msg.type === "user" && msg.message?.content) {
        const hasOnlyToolResults = msg.message.content.every(
          (b) => b.type === "tool_result"
        );
        if (hasOnlyToolResults) return false;
      }
      // Skip result message if its text duplicates an assistant message
      if (msg.type === "result" && msg.result) {
        if (assistantTexts.has(msg.result.trim())) return false;
      }
      return true;
    });
  }, [messages]);

  // Auto-scroll to bottom on new messages or message updates
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [displayMessages]);

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 overflow-y-auto scroll-smooth px-4 py-2"
    >
      {displayMessages.length === 0 && !isStreaming && (
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
          Ask Claude about your LaTeX document...
        </div>
      )}

      {displayMessages.map((msg, idx) => (
        <MessageBubble
          key={idx}
          message={msg}
          toolResultMap={toolResultMap}
        />
      ))}

      {isStreaming && (
        <div className="flex items-center gap-1.5 px-1 py-1.5 text-muted-foreground">
          <div className="flex gap-0.5">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "0ms" }} />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "150ms" }} />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-sm">Thinking...</span>
        </div>
      )}
    </div>
  );
};

// ─── Message Bubble ───

const MessageBubble: FC<{
  message: ClaudeStreamMessage;
  toolResultMap: Map<string, ContentBlock>;
}> = ({ message, toolResultMap }) => {
  console.log(
    `[chat-msg] type=${message.type} subtype=${message.subtype ?? ""} ` +
    `contentTypes=[${message.message?.content?.map((b) => b.type).join(",") ?? "none"}] ` +
    `result=${message.result ? `"${message.result.slice(0, 60)}"` : "none"}`
  );

  if (message.type === "user") {
    return <UserMessage message={message} />;
  }
  if (message.type === "assistant") {
    return <AssistantMessage message={message} toolResultMap={toolResultMap} />;
  }
  if (message.type === "result") {
    return <ResultMessage message={message} />;
  }
  return null;
};

// ─── User Message ───

const UserMessage: FC<{ message: ClaudeStreamMessage }> = ({ message }) => {
  const textContent = message.message?.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!textContent) return null;

  return (
    <div className="flex w-full flex-col items-end py-1.5">
      <div className="max-w-[85%] rounded-xl bg-muted px-3 py-1.5 text-foreground text-sm">
        {textContent}
      </div>
    </div>
  );
};

// ─── Assistant Message ───

const AssistantMessage: FC<{
  message: ClaudeStreamMessage;
  toolResultMap: Map<string, ContentBlock>;
}> = ({ message, toolResultMap }) => {
  const content = message.message?.content;
  if (!content || content.length === 0) return null;

  // Check if any content block would actually render
  const hasRenderableContent = content.some(
    (block) =>
      (block.type === "text" && block.text) ||
      (block.type === "tool_use" && block.id)
  );

  if (!hasRenderableContent) {
    console.log("[chat-msg] AssistantMessage skipped — no renderable content:",
      content.map((b) => ({ type: b.type, hasText: !!b.text, hasId: !!b.id }))
    );
    return null;
  }

  return (
    <div className="w-full py-1.5">
      <div className="px-1 text-foreground text-sm leading-relaxed">
        {content.map((block, idx) => {
          if (block.type === "text" && block.text) {
            return (
              <MarkdownRenderer
                key={idx}
                content={block.text}
                className="prose prose-sm dark:prose-invert max-w-none"
              />
            );
          }
          if (block.type === "tool_use" && block.id) {
            const result = toolResultMap.get(block.id);
            return (
              <ToolWidget
                key={idx}
                toolUse={block}
                toolResult={result}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};

// ─── Result Message ───

const ResultMessage: FC<{ message: ClaudeStreamMessage }> = ({ message }) => {
  const isError = message.is_error || message.subtype === "error";
  const resultText = message.result;

  if (!resultText) return null;

  return (
    <div className="w-full py-1.5">
      <div className="px-1 text-foreground text-sm leading-relaxed">
        {isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {resultText}
          </div>
        ) : (
          <MarkdownRenderer
            content={resultText}
            className="prose prose-sm dark:prose-invert max-w-none"
          />
        )}
      </div>
      {message.cost_usd != null && (
        <div className="mt-1 px-1 text-right text-muted-foreground text-xs">
          Cost: ${message.cost_usd.toFixed(4)}
        </div>
      )}
    </div>
  );
};
