export type ChatProtocol = "responses" | "chat-completions" | "gemini";

export type ChatProtocolImage = {
  mimeType: string;
  base64: string;
};

export type ChatProtocolMessage = {
  role: "user" | "assistant";
  content: string;
  images: ChatProtocolImage[];
};

export type ChatStreamState = {
  buffer: string;
  text: string;
  completed: boolean;
  error?: string;
};

export function buildOpenAiResponsesChatBody(
  model: string,
  system: string,
  messages: ChatProtocolMessage[],
) {
  return {
    model,
    input: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.map((message) => ({
        role: message.role,
        content: message.images.length
          ? [
              { type: "input_text", text: message.content || "请分析这张图片。" },
              ...message.images.map((image) => ({
                type: "input_image",
                image_url: imageDataUrl(image),
              })),
            ]
          : message.content,
      })),
    ],
    stream: true,
  };
}

export function buildOpenAiChatCompletionBody(
  model: string,
  system: string,
  messages: ChatProtocolMessage[],
) {
  return {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.map((message) => ({
        role: message.role,
        content: message.images.length
          ? [
              { type: "text", text: message.content || "请分析这张图片。" },
              ...message.images.map((image) => ({
                type: "image_url",
                image_url: { url: imageDataUrl(image) },
              })),
            ]
          : message.content,
      })),
    ],
    stream: true,
  };
}

export function buildGeminiChatBody(
  system: string,
  messages: ChatProtocolMessage[],
) {
  return {
    ...(system
      ? { systemInstruction: { parts: [{ text: system }] } }
      : {}),
    contents: messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        ...(message.content || !message.images.length
          ? [{ text: message.content || "请分析这张图片。" }]
          : []),
        ...message.images.map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.base64 },
        })),
      ],
    })),
  };
}

export function consumeChatStream(
  protocol: ChatProtocol,
  state: ChatStreamState,
  chunk: string,
  onDelta?: (delta: string) => void,
  flush = false,
) {
  state.buffer += chunk;
  for (;;) {
    const match = state.buffer.match(/\r?\n\r?\n/);
    if (!match) break;
    const index = match.index ?? 0;
    consumeBlock(protocol, state, state.buffer.slice(0, index), onDelta);
    state.buffer = state.buffer.slice(index + match[0].length);
  }
  if (flush && state.buffer.trim()) {
    consumeBlock(protocol, state, state.buffer, onDelta);
    state.buffer = "";
  }
}

export function chatPayloadText(protocol: ChatProtocol, payload: unknown) {
  const root = record(payload);
  if (!root) return "";
  if (protocol === "gemini") return geminiText(root);
  if (protocol === "chat-completions") return chatCompletionText(root);
  return responsesText(root);
}

export function chatPayloadError(payload: unknown) {
  const root = record(payload);
  if (!root) return "";
  const error = record(root.error);
  const response = record(root.response);
  const responseError = record(response?.error);
  const promptFeedback = record(root.promptFeedback);
  return firstText(
    root.msg,
    error?.message,
    responseError?.message,
    promptFeedback?.blockReason,
  );
}

function consumeBlock(
  protocol: ChatProtocol,
  state: ChatStreamState,
  block: string,
  onDelta?: (delta: string) => void,
) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.completed = true;
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    state.error = "上游返回了无法解析的流式内容";
    return;
  }
  const error = chatPayloadError(payload);
  if (error) {
    state.error = error;
    return;
  }
  const root = record(payload);
  if (!root) return;

  let delta = "";
  if (protocol === "responses") {
    if (root.type === "response.completed" || root.type === "response.output_text.done") {
      state.completed = true;
      if (root.type === "response.completed") return;
    }
    if (root.type === "response.failed" || root.type === "response.incomplete") {
      state.error = chatPayloadError(root) || "上游未能完成本次回应";
      return;
    }
    if (root.type === "response.output_text.delta")
      delta = stringValue(root.delta);
    else if (root.type === "response.output_text.done" && !state.text)
      delta = stringValue(root.text);
    else if (!state.text) delta = responsesText(root);
  } else if (protocol === "chat-completions") {
    delta = chatCompletionDelta(root);
    if (!delta && !state.text) delta = chatCompletionText(root);
    if (Array.isArray(root.choices) && root.choices.some((item) => stringValue(record(item)?.finish_reason))) state.completed = true;
  } else {
    delta = geminiText(root);
    if (Array.isArray(root.candidates) && root.candidates.some((item) => stringValue(record(item)?.finishReason))) state.completed = true;
  }

  if (!delta) return;
  state.text += delta;
  onDelta?.(delta);
}

function responsesText(root: Record<string, unknown>) {
  const direct = stringValue(root.output_text);
  if (direct) return direct;
  const output = Array.isArray(root.output) ? root.output : [];
  return output
    .flatMap((item) => {
      const message = record(item);
      return Array.isArray(message?.content) ? message.content : [];
    })
    .map((item) => stringValue(record(item)?.text))
    .join("");
}

function chatCompletionDelta(root: Record<string, unknown>) {
  if (!Array.isArray(root.choices)) return "";
  for (const item of root.choices) {
    const delta = record(record(item)?.delta);
    const text = contentText(delta?.content);
    if (text) return text;
  }
  return "";
}

function chatCompletionText(root: Record<string, unknown>) {
  if (!Array.isArray(root.choices)) return "";
  for (const item of root.choices) {
    const message = record(record(item)?.message);
    const text = contentText(message?.content);
    if (text) return text;
  }
  return "";
}

function geminiText(root: Record<string, unknown>) {
  if (!Array.isArray(root.candidates)) return "";
  return root.candidates
    .flatMap((candidate) => {
      const content = record(record(candidate)?.content);
      return Array.isArray(content?.parts) ? content.parts : [];
    })
    .map((part) => stringValue(record(part)?.text))
    .join("");
}

function contentText(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const part = record(item);
      return firstText(part?.text, part?.content);
    })
    .join("");
}

function imageDataUrl(image: ChatProtocolImage) {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
