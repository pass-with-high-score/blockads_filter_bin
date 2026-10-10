import { getAllFilters } from "../app/lib/db";
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
    } else if (args[i] === "--all") {
      all = true;
    } else if (args[i] === "--search" && args[i + 1]) {
      search = args[i + 1].toLowerCase();
      i++;
    }
  }

  console.log(`[1/3] Fetching filters from PostgreSQL database...`);
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
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const batchJsonPath = path.join(tmpDir, "db_filters_batch.json");
  fs.writeFileSync(batchJsonPath, JSON.stringify(batchData, null, 2), "utf-8");
  
  // Gzip + Base64 payload for self-contained transfer to Colab VM
  const zlib = await import("zlib");
  const payloadB64 = zlib.gzipSync(Buffer.from(JSON.stringify(batchData))).toString("base64");
  console.log(`[2/3] Prepared payload (${(payloadB64.length / 1024).toFixed(1)} KB) for ${batchData.length} filters.`);

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
  ];

  const localColabCli = "/Users/nqmgaming/.local/bin/colab";
  if (!isInsideColab && fs.existsSync(localColabCli)) {
    console.log(`[3/3] Launching Google Colab cloud runner via CLI (concurrency: 600, timeout: 2.0s)...`);
    cmd = localColabCli;
    cmdArgs = ["run", ...cmdArgs];
  } else {
    console.log(`[3/3] Running dead domain pruner natively with python3 (concurrency: 600, timeout: 2.0s)...`);
  }

  const child = spawn(cmd, cmdArgs, { stdio: "inherit" });

  child.on("close", (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("Error running database cleaner:", err);
  process.exit(1);
});
