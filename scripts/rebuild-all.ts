import { getAllFilters, upsertFilter, FilterList } from "../app/lib/db";
import { compileFilterList, validateFilterListURL } from "../app/lib/compiler";
import { uploadFilter } from "../app/lib/r2";

async function main() {
  const args = process.argv.slice(2);
  let limit = 0;
  let search = "";
  let concurrency = 8; // Default 8 parallel workers for 8x speedup

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i].startsWith("--limit=")) {
      limit = parseInt(args[i].split("=")[1], 10);
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

  if (limit <= 0 && process.env.REBUILD_LIMIT) {
    limit = parseInt(process.env.REBUILD_LIMIT, 10) || 0;
  }
  if (process.env.CONCURRENCY) {
    concurrency = parseInt(process.env.CONCURRENCY, 10) || concurrency;
  }

  concurrency = Math.max(1, Math.min(concurrency, 32));

  console.log(`╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     BLOCKADS FILTER REBUILD PIPELINE (TURBO MULTI-WORKER)        ║`);
  console.log(`║     Concurrency: ${concurrency.toString().padEnd(6)} workers | Database Pool: active (max 20)     ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

  const t0 = Date.now();

  try {
    let filters = await getAllFilters();
    console.log(`[*] Total filters in database: ${filters.length.toLocaleString()}`);

    if (search) {
      filters = filters.filter(
        (f) => f.name.toLowerCase().includes(search) || f.url.toLowerCase().includes(search)
      );
      console.log(`[*] Filtered by search '${search}': ${filters.length} matches.`);
    }

    if (limit > 0) {
      filters = filters.slice(0, limit);
      console.log(`[*] Limited execution to top ${filters.length} filters.`);
    }

    const total = filters.length;
    if (total === 0) {
      console.log("No filters to rebuild.");
      process.exit(0);
    }

    let completedCount = 0;
    let succeededCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let queueIndex = 0;

    function formatTime(sec: number): string {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}m ${s.toString().padStart(2, "0")}s`;
    }

    async function worker(workerId: number) {
      while (queueIndex < total) {
        const currentIndex = queueIndex++;
        const filter = filters[currentIndex];
        const taskNum = currentIndex + 1;

        try {
          // 1. Validate URL
          await validateFilterListURL(filter.url);

          // 2. Compile (with contentHash check)
          const result = await compileFilterList(filter.name, filter.url, filter.contentHash);

          if (result.skipped) {
            skippedCount++;
            completedCount++;
            console.log(
              `  [W${workerId}] ⏩ [${taskNum}/${total}] '${filter.name}' unchanged (skipped)`
            );
            continue;
          }

          if (result.ruleCount === 0) {
            throw new Error("No domain rules found in filter list");
          }

          // 3. Upload to R2
          let downloadUrl = await uploadFilter(filter.name, result.zipData);
          downloadUrl = `${downloadUrl}?v=${Math.floor(Date.now() / 1000)}`;

          // 4. Update Database
          await upsertFilter(
            filter.name,
            filter.url,
            downloadUrl,
            result.ruleCount,
            result.fileSize,
            result.contentHash
          );

          succeededCount++;
          completedCount++;

          const elapsedSec = (Date.now() - t0) / 1000;
          const rate = completedCount / Math.max(0.1, elapsedSec);
          const remaining = total - completedCount;
          const etaSec = remaining / Math.max(0.01, rate);

          console.log(
            `  [W${workerId}] ✓ [${taskNum}/${total}] '${filter.name}' ➔ ${result.ruleCount.toLocaleString()} rules (${(result.fileSize / 1024).toFixed(1)} KB) | ` +
            `Done: ${completedCount}/${total} (${((completedCount / total) * 100).toFixed(1)}%) | ` +
            `${rate.toFixed(1)} fil/s | ETA: ${formatTime(etaSec)}`
          );
        } catch (err: any) {
          failedCount++;
          completedCount++;
          console.error(
            `  [W${workerId}] ✗ [${taskNum}/${total}] '${filter.name}' failed: ${err.message}`
          );
        }
      }
    }

    console.log(`\n[*] Spawning ${concurrency} parallel worker threads for turbo processing...\n`);
    const workerPromises = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
    await Promise.all(workerPromises);

    const totalDurationSec = (Date.now() - t0) / 1000;
    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`                    REBUILD SUMMARY REPORT                        `);
    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`Total filters processed: ${completedCount.toLocaleString()} / ${total.toLocaleString()}`);
    console.log(`  ✓ Successfully built & uploaded: ${succeededCount.toLocaleString()}`);
    console.log(`  ⏩ Skipped (identical hash):      ${skippedCount.toLocaleString()}`);
    console.log(`  ✗ Failed / unreachable:           ${failedCount.toLocaleString()}`);
    console.log(`Total time elapsed:              ${formatTime(totalDurationSec)} (${(completedCount / Math.max(0.1, totalDurationSec)).toFixed(1)} filters/sec)`);
    console.log(`══════════════════════════════════════════════════════════════════\n`);
  } catch (err: any) {
    console.error("Fatal rebuild error:", err);
  } finally {
    process.exit(0);
  }
}

main();
