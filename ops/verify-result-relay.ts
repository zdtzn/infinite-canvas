import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";

const relayUrl = String(process.env.RESULT_IMAGE_RELAY_URL || "").trim();
const secret = String(process.env.RESULT_IMAGE_RELAY_SECRET || "").trim();
if (!relayUrl || secret.length < 32) {
  throw new Error("Result image relay environment is incomplete");
}

const database = new Database("/data/app.sqlite", { readonly: true });
const rows = database
  .query("SELECT payload_json FROM jobs")
  .all() as Array<{ payload_json: string }>;
const now = Date.now();
let target = "";

for (const row of rows) {
  try {
    const job = JSON.parse(row.payload_json);
    const images = Array.isArray(job?.result?.images) ? job.result.images : [];
    const image = images.find((candidate: any) => {
      if (candidate?.persisted !== false || typeof candidate?.dataUrl !== "string") {
        return false;
      }
      const expiresAt = Date.parse(String(candidate.expiresAt || ""));
      return (
        isAllowedTarget(candidate.dataUrl) &&
        (!Number.isFinite(expiresAt) || expiresAt > now + 60_000)
      );
    });
    if (image) {
      target = new URL(image.dataUrl).toString();
      break;
    }
  } catch {
    // Ignore malformed historical rows and continue looking for a valid result.
  }
}

if (!target) {
  throw new Error("No unexpired deferred UU result is available for relay verification");
}

const expires = Math.floor(now / 1000) + 120;
const signature = createHmac("sha256", secret)
  .update(`GET\n${expires}\n${target}`)
  .digest("hex");
const requestUrl = new URL(relayUrl);
requestUrl.searchParams.set("target", target);
requestUrl.searchParams.set("expires", String(expires));
requestUrl.searchParams.set("signature", signature);

const startedAt = Date.now();
const response = await fetch(requestUrl, { signal: AbortSignal.timeout(45_000) });
const bytes = new Uint8Array(await response.arrayBuffer());
if (!response.ok) {
  throw new Error(`Result relay returned HTTP ${response.status}`);
}
const mimeType = response.headers.get("content-type") || "";
if (!mimeType.startsWith("image/") || !bytes.byteLength) {
  throw new Error("Result relay did not return a valid image response");
}

console.log(
  JSON.stringify({
    status: response.status,
    bytes: bytes.byteLength,
    mimeType,
    durationMs: Date.now() - startedAt,
  }),
);

function isAllowedTarget(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "img.uuapi.net" &&
      url.pathname.startsWith("/uu-image-temp/")
    );
  } catch {
    return false;
  }
}
