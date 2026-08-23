import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "blockads-filters";
const publicUrl = process.env.R2_PUBLIC_URL || "";

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error("R2 environment variables are not fully configured");
}

export const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true, // Equivalent to Go's UsePathStyle = true
});

export async function uploadFilter(name: string, data: Buffer): Promise<string> {
  const key = `${name}.zip`;
  
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: data,
    ContentType: "application/zip",
  }));
  
  const baseUrl = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
  return `${baseUrl}/${key}`;
}

export async function deleteFilter(name: string): Promise<void> {
  const key = `${name}.zip`;
  
  await s3.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  }));
}
