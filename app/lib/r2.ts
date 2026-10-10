import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

export function getS3(): S3Client {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    const missing: string[] = [];
    if (!accountId) missing.push("R2_ACCOUNT_ID (or CLOUDFLARE_R2_ACCOUNT_ID)");
    if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID (or CLOUDFLARE_R2_ACCESS_KEY_ID)");
    if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY (or CLOUDFLARE_R2_SECRET_ACCESS_KEY)");
    throw new Error(`R2 environment variables are not fully configured. Missing: ${missing.join(", ")}`);
  }

  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true, // Equivalent to Go's UsePathStyle = true
  });
  return s3Client;
}

export async function uploadFilter(name: string, data: Buffer): Promise<string> {
  const bucketName = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || "blockads-filters";
  const publicUrl = process.env.R2_PUBLIC_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL || "https://filter.pwhs.app";
  const key = `${name}.zip`;
  
  await getS3().send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: data,
    ContentType: "application/zip",
  }));
  
  const baseUrl = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
  return `${baseUrl}/${key}`;
}

export async function deleteFilter(name: string): Promise<void> {
  const bucketName = process.env.R2_BUCKET_NAME || "blockads-filters";
  const key = `${name}.zip`;
  
  await getS3().send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  }));
}
