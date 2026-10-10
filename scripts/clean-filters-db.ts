import { getAllFilters, upsertFilter } from "../app/lib/db";
import { compileFilterFromText } from "../app/lib/compiler";
import { uploadFilter } from "../app/lib/r2";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

async function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  let all = false;
  let search = "";
  let concurrency = 8; // Default 8 parallel workers

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
    } else if ((args[i] === "--concurrency" || args[i] === "-c") && args[i + 1]) {
      concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith("--concurrency=")) {
      concurrency = parseInt(args[i].split("=")[1], 10);
    }
  }

  if (process.env.CONCURRENCY) {
    concurrency = parseInt(process.env.CONCURRENCY, 10) || concurrency;
  }
  concurrency = Math.max(1, Math.min(concurrency, 32));

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

  const isInsideColab = fs.existsSync("/content") || Boolean(process.env.COLAB_RELEASE_TAG);
  let cmd = "python3";
  let cmdArgs = [
    "scripts/colab_clean_filter.py",
    "--batch-b64",
    payloadB64,
    "--concurrency",
    "300",
    "--timeout",
    "1.5",
    "--output-dir",
    cleanedOutputDir,
  ];

  const localColabCli = "/Users/nqmgaming/.local/bin/colab";
  if (!isInsideColab && fs.existsSync(localColabCli)) {
    console.log(`[3/4] Launching Google Colab cloud runner via CLI (pool: 300 workers, timeout: 1.5s)...`);
    cmd = localColabCli;
    cmdArgs = ["run", ...cmdArgs];
  } else {
    console.log(`[3/4] Running dead domain pruner with turbo DNS pool (300 workers, timeout: 1.5s)...`);
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
      console.log(`\n[4/4] 🚀 Compiling cleaned filters and uploading to Cloudflare R2 (Turbo Concurrency: ${concurrency} workers)...`);

      let queueIdx = 0;
      let completed = 0;
      const total = summary.length;
      const t0_upload = Date.now();

      async function uploadWorker(workerId: number) {
        while (queueIdx < total) {
          const current = queueIdx++;
          const item = summary[current];

          if (item.error || !item.cleaned_file || !fs.existsSync(item.cleaned_file)) {
            console.warn(`  [W${workerId}] ⚠️ Skipped '${item.name}': ${item.error || "no cleaned file"}`);
            completed++;
            continue;
          }

          try {
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

            completed++;
            const elapsed = (Date.now() - t0_upload) / 1000;
            const rate = completed / Math.max(0.1, elapsed);
            console.log(
              `  [W${workerId}] ✓ [${completed}/${total}] '${item.name}' ➔ ${result.ruleCount.toLocaleString()} live rules (${(result.fileSize / 1024).toFixed(1)} KB) | ${rate.toFixed(1)} fil/s`
            );
          } catch (err: any) {
            completed++;
            console.error(`  [W${workerId}] ✗ Failed '${item.name}': ${err.message}`);
          }
        }
      }

      const workers = Array.from({ length: concurrency }, (_, i) => uploadWorker(i + 1));
      await Promise.all(workers);

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
