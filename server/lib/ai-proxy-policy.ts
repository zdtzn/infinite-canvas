import type { ProviderProtocol } from "./url-policy";

export type ProxyRequestKind = "read" | "audio" | "video" | "text";

export function proxyRequestKind(
  method: string,
  protocol: ProviderProtocol,
  path: string,
): ProxyRequestKind | null {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;

  if (protocol === "gemini") {
    if (
      ["GET", "HEAD"].includes(normalizedMethod) &&
      /^\/models(?:\/[^/]+)?$/.test(normalizedPath)
    )
      return "read";
    if (
      normalizedMethod === "POST" &&
      /^\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(
        normalizedPath,
      )
    )
      return "text";
    return null;
  }

  if (
    ["GET", "HEAD"].includes(normalizedMethod) &&
    /^\/(?:models(?:\/[^/]+)?|videos\/[^/]+(?:\/content)?|contents\/generations\/tasks\/[^/]+)$/.test(
      normalizedPath,
    )
  )
    return "read";
  if (normalizedMethod !== "POST") return null;
  if (normalizedPath === "/responses") return "text";
  if (normalizedPath === "/audio/speech") return "audio";
  if (
    normalizedPath === "/videos" ||
    normalizedPath === "/contents/generations/tasks"
  )
    return "video";
  return null;
}

export function proxyPathModel(protocol: ProviderProtocol, path: string) {
  if (protocol !== "gemini") return "";
  const match = `/${path.replace(/^\/+/, "")}`.match(
    /^\/models\/([^/]+):(?:generateContent|streamGenerateContent)$/,
  );
  if (!match) return "";
  try {
    return decodeURIComponent(match[1])
      .replace(/^models\//, "")
      .trim();
  } catch {
    return "";
  }
}
