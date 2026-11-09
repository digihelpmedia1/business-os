import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { ActionError } from "./action";

// Files are never served from a public path: every download goes through an
// authenticated route that checks the caller's access first.
//   STORAGE_DRIVER=db  → bytes stored in PostgreSQL (FileBlob) — zero setup, ≤ 4 MB/file on Vercel
//   STORAGE_DRIVER=s3  → any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage)

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 4) * 1024 * 1024;

const ALLOWED = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "text/plain", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);

function driver() {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "db";
}

async function s3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
}

export async function storeUpload(file: File, userId: string | null, opts: { imagesOnly?: boolean } = {}) {
  if (!file || typeof file === "string" || file.size === 0) throw new ActionError("Choose a file to upload.", { file: "File is required" });
  if (file.size > MAX_UPLOAD_BYTES) throw new ActionError(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime) || (opts.imagesOnly && !mime.startsWith("image/"))) {
    throw new ActionError(`File type ${mime} is not allowed.`, { file: "Unsupported file type" });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const safeName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 150) || "file";
  const key = `${new Date().toISOString().slice(0, 7)}/${randomBytes(12).toString("hex")}-${safeName}`;
  const d = driver();
  if (d === "s3") {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: buffer, ContentType: mime }));
  }
  return db.storedFile.create({
    data: {
      driver: d,
      key,
      fileName: safeName,
      mimeType: mime,
      size: buffer.length,
      sha256,
      uploadedById: userId,
      ...(d === "db" ? { blob: { create: { data: buffer } } } : {}),
    },
  });
}

export async function readStoredFile(fileId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
  const file = await db.storedFile.findUnique({ where: { id: fileId }, include: { blob: true } });
  if (!file) return null;
  if (file.driver === "db") {
    if (!file.blob) return null;
    return { buffer: Buffer.from(file.blob.data), fileName: file.fileName, mimeType: file.mimeType };
  }
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await s3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: file.key }));
  const bytes = await res.Body!.transformToByteArray();
  return { buffer: Buffer.from(bytes), fileName: file.fileName, mimeType: file.mimeType };
}

export async function deleteStoredFile(fileId: string) {
  const file = await db.storedFile.findUnique({ where: { id: fileId } });
  if (!file) return;
  if (file.driver === "s3") {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: file.key }));
  }
  await db.storedFile.delete({ where: { id: fileId } });
}

export async function companyLogo(): Promise<Buffer | null> {
  const settings = await db.companySettings.findUnique({ where: { id: 1 } });
  if (!settings?.logoFileId) return null;
  const f = await readStoredFile(settings.logoFileId);
  if (!f || f.mimeType === "image/svg+xml") return null; // react-pdf can't embed SVG
  return f.buffer;
}
