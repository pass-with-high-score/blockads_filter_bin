import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Load .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "blockads-filters";
const publicUrl = process.env.R2_PUBLIC_URL || "https://filter.pwhs.app";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("❌ Missing R2 credentials in .env");
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

export interface MockPathRule {
  pattern: string;
  status: number;
  contentType?: string;
  body?: string;
}

export interface WebModule {
  id: string;
  name: string;
  enabled: boolean;
  domains: string[];
  mock_paths: MockPathRule[];
  block_paths: string[];
  cosmetic_css: string[];
  scriptlets: string[];
  scripts: string[];
}

export interface ModulesPackage {
  version: number;
  updatedAt: number;
  modules: WebModule[];
  domainIndex: Record<string, string>; // domain -> module_id
  globalBlockPaths: string[];
}

// Resolve candidate paths for Android repository
const candidateAndroidPaths = [
  process.env.ANDROID_REPO_PATH,
  process.argv[2],
  path.resolve(process.cwd(), "../blockads-android"),
  path.resolve(__dirname, "../../blockads-android"),
  path.resolve(os.homedir(), "AndroidStudioProjects/blockads-android"),
  path.resolve(os.homedir(), "IdeaProjects/blockads-android"),
].filter(Boolean) as string[];

const androidRepo = candidateAndroidPaths.find((p) => fs.existsSync(p));

async function uploadToR2(key: string, body: Buffer | string, contentType: string): Promise<string> {
  const bytes = typeof body === "string" ? Buffer.byteLength(body) : body.length;
  console.log(`  Uploading ${key} (${bytes} bytes)...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=300",
    })
  );
  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}

async function buildAndDeployModules() {
  console.log("==================================================");
  console.log("   BlockAds Modular Rules Compiler & Deployer    ");
  console.log("==================================================");

  const modulesDir = path.resolve(__dirname, "../modules/definitions");
  const scriptsDir = path.resolve(__dirname, "../modules/scripts");

  if (!fs.existsSync(modulesDir)) {
    throw new Error(`Modules directory not found: ${modulesDir}`);
  }

  const moduleFiles = fs.readdirSync(modulesDir).filter((f) => f.endsWith(".json"));
  console.log(`Found ${moduleFiles.length} module definition(s) in ${modulesDir}`);

  const modules: WebModule[] = [];
  const domainIndex: Record<string, string> = {};
  const globalBlockPathsSet = new Set<string>();

  for (const file of moduleFiles) {
    const filePath = path.join(modulesDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const mod: WebModule = JSON.parse(content);

    if (!mod.id || !mod.name) {
      console.warn(`⚠ Skipping invalid module file: ${file}`);
      continue;
    }

    if (mod.enabled === false) {
      console.log(`  - ${mod.name} (${mod.id}) [DISABLED]`);
      continue;
    }

    console.log(`  + Compiled module: ${mod.name} (${mod.id}) - ${mod.domains.length} domain(s)`);
    modules.push(mod);

    for (const d of mod.domains) {
      if (d !== "*") {
        domainIndex[d.toLowerCase()] = mod.id;
      }
    }

    for (const p of mod.block_paths || []) {
      globalBlockPathsSet.add(p);
    }
  }

  // Generate version based on timestamp
  const version = Math.floor(Date.now() / 1000);
  const updatedAt = Date.now();

  const modulesPackage: ModulesPackage = {
    version,
    updatedAt,
    modules,
    domainIndex,
    globalBlockPaths: Array.from(globalBlockPathsSet),
  };

  const modulesJsonStr = JSON.stringify(modulesPackage, null, 2);

  // 1. Upload scripts to R2
  console.log("\n▶ Step 1: Uploading scriptlet & CSS assets to R2...");
  const scriptFiles = fs.readdirSync(scriptsDir);
  for (const sf of scriptFiles) {
    const sfPath = path.join(scriptsDir, sf);
    if (!fs.statSync(sfPath).isFile()) continue;
    const ext = path.extname(sf);
    const contentType =
      ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : "application/octet-stream";

    const content = fs.readFileSync(sfPath);
    await uploadToR2(`browser/${sf}`, content, contentType);
  }

  // 2. Upload modules.json to R2
  console.log("\n▶ Step 2: Uploading rules/modules.json to R2...");
  const modulesUrl = await uploadToR2(
    "rules/modules.json",
    modulesJsonStr,
    "application/json; charset=utf-8"
  );
  console.log(`✓ Modules Manifest URL: ${modulesUrl}`);

  // 3. Generate backward-compatible browser_rules.json
  console.log("\n▶ Step 3: Generating backward-compatible browser_rules.json for legacy clients...");
  let baseAdDomains: string[] = [];
  let gamblingKeywords: string[] = [];

  // Try reading existing browser_rules.json to preserve adDomains
  const legacyRulesPath = path.resolve(__dirname, "../rules/browser_rules.json");
  if (fs.existsSync(legacyRulesPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(legacyRulesPath, "utf-8"));
      baseAdDomains = prev.adDomains || [];
      gamblingKeywords = prev.gamblingKeywords || [];
    } catch {}
  } else if (androidRepo) {
    const androidRulesPath = path.join(androidRepo, "rules/browser_rules.json");
    if (fs.existsSync(androidRulesPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(androidRulesPath, "utf-8"));
        baseAdDomains = prev.adDomains || [];
        gamblingKeywords = prev.gamblingKeywords || [];
      } catch {}
    }
  }

  const legacyBrowserRules = {
    version,
    updatedAt,
    adDomains: baseAdDomains,
    gamblingKeywords,
    adPathPatterns: modulesPackage.globalBlockPaths,
    cosmeticCss: `${publicUrl.replace(/\/$/, "")}/browser/adblock_cosmetic.css`,
    scriptletsJs: `${publicUrl.replace(/\/$/, "")}/browser/adguard_scriptlets.js`,
  };

  const legacyJsonStr = JSON.stringify(legacyBrowserRules, null, 2);
  const browserRulesUrl = await uploadToR2(
    "rules/browser_rules.json",
    legacyJsonStr,
    "application/json; charset=utf-8"
  );
  console.log(`✓ Legacy Browser Rules URL: ${browserRulesUrl}`);

  // 4. Sync files to local Android repo if found
  if (androidRepo) {
    console.log(`\n▶ Step 4: Syncing compiled rules to local Android repository (${androidRepo})...`);
    const androidRulesDir = path.join(androidRepo, "rules");
    const androidAssetsBrowserDir = path.join(androidRepo, "app/src/main/assets/browser");

    fs.mkdirSync(androidRulesDir, { recursive: true });
    fs.mkdirSync(androidAssetsBrowserDir, { recursive: true });

    // Write rules/modules.json & rules/browser_rules.json
    fs.writeFileSync(path.join(androidRulesDir, "modules.json"), modulesJsonStr, "utf-8");
    fs.writeFileSync(path.join(androidRulesDir, "browser_rules.json"), legacyJsonStr, "utf-8");

    // Copy modules.json into assets so the app has offline baseline modules
    fs.writeFileSync(path.join(androidAssetsBrowserDir, "modules.json"), modulesJsonStr, "utf-8");

    console.log("✓ Updated local Android repo: rules/modules.json, rules/browser_rules.json, assets/browser/modules.json");
  }

  console.log("\n==================================================");
  console.log("   🎉 ALL MODULES SUCCESSFULLY COMPILED & DEPLOYED");
  console.log("==================================================");
  console.log(`Modules Spec URL : ${modulesUrl}`);
  console.log(`Legacy Rules URL : ${browserRulesUrl}`);
  console.log(`Version          : ${version}`);
}

buildAndDeployModules().catch((err) => {
  console.error("❌ Fatal error building modules:", err);
  process.exit(1);
});
