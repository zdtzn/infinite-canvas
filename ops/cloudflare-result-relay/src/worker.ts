const MAX_SIGNATURE_LIFETIME_SECONDS = 300;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;
const UU_RESULT_HOSTNAME = "img.uuapi.net";
const UU_RESULT_PATH_PREFIX = "/uu-image-temp/";

type Env = {
  RESULT_IMAGE_RELAY_SECRET?: string;
};

class RelayRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/health") {
      return json({ status: "ok" });
    }

    let target: URL;
    try {
      target = await verifyRelayRequest(request, env);
    } catch (error) {
      if (error instanceof RelayRequestError) {
        return json({ error: error.message }, error.status);
      }
      return json({ error: "Invalid relay request" }, 400);
    }

    try {
      const response = await fetch(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        return json({ error: "Upstream redirects are not allowed" }, 502);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return json({ error: "Upstream image is unavailable" }, 502);
      }

      const declaredLength = Number(
        response.headers.get("content-length") || 0,
      );
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        await response.body?.cancel();
        return json({ error: "Upstream image is too large" }, 413);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
        return json({ error: "Upstream image is empty or too large" }, 413);
      }
      const mimeType = detectImageMimeType(bytes);
      if (!mimeType) {
        return json(
          { error: "Upstream response is not a supported image" },
          415,
        );
      }

      return new Response(bytes, {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Length": String(bytes.byteLength),
          "Content-Type": mimeType,
          "Content-Disposition": "inline",
          "Content-Security-Policy": "default-src 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Length, Content-Type",
        },
      });
    } catch {
      return json({ error: "Unable to fetch upstream image" }, 502);
    }
  },
};

export async function verifyRelayRequest(
  request: Request,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== "/fetch") {
    throw new RelayRequestError(404, "Not found");
  }
  if (request.method !== "GET") {
    throw new RelayRequestError(405, "Method not allowed");
  }

  const secret = String(env.RESULT_IMAGE_RELAY_SECRET || "");
  if (secret.length < 32) {
    throw new RelayRequestError(503, "Relay secret is not configured");
  }
  const targetValue = requestUrl.searchParams.get("target") || "";
  const expiresValue = requestUrl.searchParams.get("expires") || "";
  const signature = (
    requestUrl.searchParams.get("signature") || ""
  ).toLowerCase();
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires)) {
    throw new RelayRequestError(400, "Invalid expiry");
  }
  if (expires < nowSeconds) {
    throw new RelayRequestError(403, "Relay request has expired");
  }
  if (expires > nowSeconds + MAX_SIGNATURE_LIFETIME_SECONDS) {
    throw new RelayRequestError(403, "Relay request lifetime is too long");
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new RelayRequestError(403, "Invalid signature");
  }

  const target = parseAllowedTarget(targetValue);
  const expected = await hmacHex(
    secret,
    relaySignaturePayload(target.toString(), expires),
  );
  if (!constantTimeEqual(signature, expected)) {
    throw new RelayRequestError(403, "Invalid signature");
  }
  return target;
}

function parseAllowedTarget(value: string) {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new RelayRequestError(400, "Invalid target URL");
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.port ||
    target.hash ||
    target.hostname.toLowerCase() !== UU_RESULT_HOSTNAME ||
    !target.pathname.startsWith(UU_RESULT_PATH_PREFIX)
  ) {
    throw new RelayRequestError(403, "Target URL is not allowed");
  }
  return target;
}

function relaySignaturePayload(target: string, expires: number) {
  return `GET\n${expires}\n${target}`;
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function detectImageMimeType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(ascii(bytes, 8, 12))
  ) {
    return "image/avif";
  }
  return undefined;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
