import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "blockads-filters";
const publicUrl = process.env.R2_PUBLIC_URL || "https://filter.pwhs.app";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2 credentials in .env");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});

// Resolve Android repo path dynamically from CLI args, env var, or common directory layouts
const candidatePaths = [
  process.env.ANDROID_REPO_PATH,
  process.argv[2],
  path.resolve(process.cwd(), "../blockads-android"),
  path.resolve(__dirname, "../../blockads-android"),
  path.resolve(os.homedir(), "AndroidStudioProjects/blockads-android"),
  path.resolve(os.homedir(), "IdeaProjects/blockads-android"),
].filter(Boolean) as string[];

const androidRepo = candidatePaths.find((p) => fs.existsSync(p));

if (!androidRepo) {
  console.error(
    "❌ Error: Could not find blockads-android repository directory.\n" +
    "Please provide the path via ANDROID_REPO_PATH env var or as a CLI argument:\n" +
    "  npx tsx scripts/upload-browser-rules-to-r2.ts <path-to-blockads-android>\n"
  );
  process.exit(1);
}

console.log(`Using Android repo: ${androidRepo}`);
const cosmeticCssPath = path.join(androidRepo, "app/src/main/assets/browser/adblock_cosmetic.css");
const scriptletsJsPath = path.join(androidRepo, "app/src/main/assets/browser/adguard_scriptlets.js");
const browserRulesPath = path.join(androidRepo, "rules/browser_rules.json");

async function uploadToR2(key: string, body: Buffer | string, contentType: string) {
  console.log(`Uploading ${key} (${typeof body === "string" ? Buffer.byteLength(body) : body.length} bytes) to R2 [${bucketName}]...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=300", // cache 5 mins at CDN
    })
  );
  const url = `${publicUrl.replace(/\/$/, "")}/${key}`;
  console.log(`✓ Uploaded: ${url}`);
  return url;
}

async function main() {
  console.log("== Uploading browser rules & assets to Cloudflare R2 ==");

  // 1. Upload adblock_cosmetic.css
  const cosmeticCssContent = fs.readFileSync(cosmeticCssPath);
  const cosmeticUrl = await uploadToR2(
    "browser/adblock_cosmetic.css",
    cosmeticCssContent,
    "text/css; charset=utf-8"
  );

  // 2. Upload adguard_scriptlets.js
  const scriptletsJsContent = fs.readFileSync(scriptletsJsPath);
  const scriptletsUrl = await uploadToR2(
    "browser/adguard_scriptlets.js",
    scriptletsJsContent,
    "application/javascript; charset=utf-8"
  );

  // 3. Read & update browser_rules.json
  const rawRules = fs.readFileSync(browserRulesPath, "utf-8");
  const rulesObj = JSON.parse(rawRules);

  const prevVersion = rulesObj.version || 17;
  const newVersion = prevVersion + 1;

  rulesObj.version = newVersion;
  rulesObj.updatedAt = Date.now();
  rulesObj.cosmeticCss = cosmeticUrl;
  rulesObj.scriptletsJs = scriptletsUrl;

  const updatedJsonStr = JSON.stringify(rulesObj, null, 2);

  // Save back to local repo
  fs.writeFileSync(browserRulesPath, updatedJsonStr, "utf-8");
  console.log(`✓ Updated local ${browserRulesPath} to version ${newVersion}`);

  // 4. Upload browser_rules.json to R2
  const rulesUrl = await uploadToR2(
    "rules/browser_rules.json",
    updatedJsonStr,
    "application/json; charset=utf-8"
  );

  console.log("\n== COMPLETED SUCCESSFULLY ==");
  console.log(`Rules URL: ${rulesUrl}`);
  console.log(`Cosmetic CSS URL: ${cosmeticUrl}`);
  console.log(`Scriptlets JS URL: ${scriptletsUrl}`);
}

main().catch((err) => {
  console.error("Error running upload:", err);
  process.exit(1);
});
