import { createHmac } from "node:crypto";

const UU_RESULT_HOSTNAME = "img.uuapi.net";
const UU_RESULT_PATH_PREFIX = "/uu-image-temp/";
const DEFAULT_TTL_SECONDS = 120;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 300;

export type ResultImageRelayConfig = {
  endpoint: string;
  secret: string;
  ttlSeconds: number;
};

export function createResultImageRelayConfig(
  endpointValue?: string,
  secretValue?: string,
  ttlValue?: string | number,
): ResultImageRelayConfig | undefined {
  const endpoint = String(endpointValue || "").trim();
  const secret = String(secretValue || "").trim();
  if (!endpoint && !secret) return undefined;
  if (!endpoint || !secret) {
    throw new Error(
      "RESULT_IMAGE_RELAY_URL and RESULT_IMAGE_RELAY_SECRET must be configured together",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "RESULT_IMAGE_RELAY_SECRET must contain at least 32 characters",
    );
  }

  const relayUrl = new URL(endpoint);
  if (
    relayUrl.protocol !== "https:" ||
    relayUrl.username ||
    relayUrl.password
  ) {
    throw new Error(
      "RESULT_IMAGE_RELAY_URL must be a credential-free HTTPS URL",
    );
  }
  if (relayUrl.search || relayUrl.hash) {
    throw new Error(
      "RESULT_IMAGE_RELAY_URL must not include a query or fragment",
    );
  }

  const parsedTtl = Number(ttlValue || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Number.isSafeInteger(parsedTtl)
    ? Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, parsedTtl))
    : DEFAULT_TTL_SECONDS;

  return { endpoint: relayUrl.toString(), secret, ttlSeconds };
}

export function isRelayEligibleResultUrl(value: string | URL) {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.hostname.toLowerCase() === UU_RESULT_HOSTNAME &&
      url.pathname.startsWith(UU_RESULT_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

export function resultImageDownloadUrl(
  value: string,
  config?: ResultImageRelayConfig,
  now = Date.now(),
) {
  if (!config || !isRelayEligibleResultUrl(value)) return value;
  const target = new URL(value).toString();
  const expires = Math.floor(now / 1000) + config.ttlSeconds;
  const signature = createHmac("sha256", config.secret)
    .update(relaySignaturePayload(target, expires))
    .digest("hex");
  const relayUrl = new URL(config.endpoint);
  relayUrl.searchParams.set("target", target);
  relayUrl.searchParams.set("expires", String(expires));
  relayUrl.searchParams.set("signature", signature);
  return relayUrl.toString();
}

export function relaySignaturePayload(target: string, expires: number) {
  return `GET\n${expires}\n${target}`;
}
