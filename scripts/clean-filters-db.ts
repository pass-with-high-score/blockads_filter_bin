import { getAllFilters, upsertFilter } from "../app/lib/db";
import { compileFilterFromText } from "../app/lib/compiler";
import { uploadFilter } from "../app/lib/r2";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  let limit = 10; // Default to 10 filters for quick inspection unless specified
  let all = false;
  let search = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith("--limit=")) {
      limit = parseInt(args[i].split("=")[1], 10);
    } else if (args[i] === "--all") {
      all = true;
    } else if (args[i] === "--search" && args[i + 1]) {
      search = args[i + 1].toLowerCase();
      i++;
    } else if (args[i].startsWith("--search=")) {
      search = args[i].split("=")[1].toLowerCase();
    }
  }

  console.log(`[1/4] Fetching filters from PostgreSQL database...`);
  let filters = await getAllFilters();
  console.log(`Total filters in database: ${filters.length}`);

  if (search) {
    filters = filters.filter(
      (f) => f.name.toLowerCase().includes(search) || f.url.toLowerCase().includes(search)
    );
    console.log(`Filtered by search '${search}': ${filters.length} matches.`);
  }

  if (!all) {
    filters = filters.slice(0, limit);
    console.log(`Selected top ${filters.length} filters (use --all to scan all 1,800+ filters or --limit N).`);
  }

  const batchData = filters.map((f) => ({
    name: f.name,
    url: f.url,
  }));

  const tmpDir = path.join(process.cwd(), "tmp");
  const cleanedOutputDir = path.join(tmpDir, "cleaned_filters");
  if (!fs.existsSync(cleanedOutputDir)) {
    fs.mkdirSync(cleanedOutputDir, { recursive: true });
  }

  const batchJsonPath = path.join(tmpDir, "db_filters_batch.json");
  fs.writeFileSync(batchJsonPath, JSON.stringify(batchData, null, 2), "utf-8");
  
  // Gzip + Base64 payload for self-contained transfer to Colab VM
  const zlib = await import("zlib");
  const payloadB64 = zlib.gzipSync(Buffer.from(JSON.stringify(batchData))).toString("base64");
  console.log(`[2/4] Prepared payload (${(payloadB64.length / 1024).toFixed(1)} KB) for ${batchData.length} filters.`);

  // Detect environment: If running directly inside Colab / server, run python3 directly.
  // Otherwise, if local and colab CLI exists, offload to Colab VM.
  const isInsideColab = fs.existsSync("/content") || Boolean(process.env.COLAB_RELEASE_TAG);
  let cmd = "python3";
  let cmdArgs = [
    "scripts/colab_clean_filter.py",
    "--batch-b64",
    payloadB64,
    "--concurrency",
    "600",
    "--timeout",
    "2.0",
    "--output-dir",
    cleanedOutputDir,
  ];

  const localColabCli = "/Users/nqmgaming/.local/bin/colab";
  if (!isInsideColab && fs.existsSync(localColabCli)) {
    console.log(`[3/4] Launching Google Colab cloud runner via CLI (concurrency: 600, timeout: 2.0s)...`);
    cmd = localColabCli;
    cmdArgs = ["run", ...cmdArgs];
  } else {
    console.log(`[3/4] Running dead domain pruner natively with python3 (concurrency: 600, timeout: 2.0s)...`);
  }

  const child = spawn(cmd, cmdArgs, { stdio: "inherit" });

  child.on("close", async (code) => {
    if (code !== 0) {
      console.error(`DNS pruning process exited with code ${code}`);
      process.exit(code || 1);
    }

    const summaryPath = path.join(cleanedOutputDir, "batch_summary.json");
    if (!fs.existsSync(summaryPath)) {
      console.log(`[✓] DNS liveness pass complete.`);
      process.exit(0);
    }

    try {
      const summary: any[] = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
      console.log(`\n[4/4] 🚀 Compiling cleaned filters and uploading to Cloudflare R2...`);

      for (let i = 0; i < summary.length; i++) {
        const item = summary[i];
        if (item.error || !item.cleaned_file || !fs.existsSync(item.cleaned_file)) {
          console.warn(`  ⚠️ Skipped '${item.name}': ${item.error || "no cleaned file"}`);
          continue;
        }

        console.log(`\n▶ [${i + 1}/${summary.length}] Building cleaned package for '${item.name}'...`);
        const cleanedText = fs.readFileSync(item.cleaned_file, "utf-8");
        const result = await compileFilterFromText(item.name, item.url, cleanedText);

        let downloadUrl = await uploadFilter(item.name, result.zipData);
        downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;

        await upsertFilter(
          item.name,
          item.url,
          downloadUrl,
          result.ruleCount,
          result.fileSize,
          result.contentHash
        );

        console.log(
          `  ✓ Uploaded to R2: ${downloadUrl} (${result.ruleCount.toLocaleString()} live rules, ${(result.fileSize / 1024).toFixed(1)} KB)`
        );
      }

      console.log(`\n✨ All ${summary.length} cleaned filters have been built, uploaded to R2, and recorded in Database!`);
    } catch (err: any) {
      console.error("Error during compilation / R2 upload phase:", err);
    }

    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Error running database cleaner:", err);
  process.exit(1);
});
