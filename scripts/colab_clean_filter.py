#!/usr/bin/env python3
"""
Colab-powered Filter List Dead Domain Pruner & Batch Cleaner
------------------------------------------------------------
Executes high-concurrency DNS resolution to prune dead/NXDOMAIN
domains from Adblock / DNS filter lists, drastically reducing .trie
and .bloom binary footprint before compilation.
"""

import argparse
import asyncio
import concurrent.futures
import json
import os
import re
import socket
import sys
import time
import urllib.request

DOMAIN_REGEX = re.compile(
    r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)

def parse_domain_line(line: str) -> str:
    line = line.strip()
    if not line or line.startswith(("#", "!")) or line.startswith("@@"):
        return ""
    if any(marker in line for marker in ("##", "#@#", "#?#", "#$#", "#%#")):
        return ""
    if re.search(r"[\$\/\\\*]", line) and not line.startswith("||"):
        return ""

    domain = ""
    if line.startswith("||"):
        domain = line[2:]
        if re.search(r"[\/\*\?]", domain):
            return ""
        dollar_idx = domain.find("$")
        if dollar_idx != -1:
            options = domain[dollar_idx + 1:].split(",")
            for opt in options:
                opt = opt.strip()
                if opt in ("", "important", "empty", "mp4"):
                    continue
                return ""
            domain = domain[:dollar_idx]
        carrot_idx = domain.find("^")
        if carrot_idx != -1:
            domain = domain[:carrot_idx]
    elif line.startswith(("0.0.0.0 ", "0.0.0.0\t", "127.0.0.1 ", "127.0.0.1\t")):
        parts = line.split()
        if len(parts) >= 2:
            candidate = parts[1].strip()
            if candidate not in ("0.0.0.0", "127.0.0.1", "localhost", "broadcasthost"):
                domain = candidate
    elif "." in line and " " not in line and "\t" not in line:
        domain = line

    domain = domain.strip().lower()
    if domain.startswith("*."):
        domain = domain[2:]
    if DOMAIN_REGEX.match(domain):
        return domain
    return ""

# High-performance DNS resolution engine with 300 concurrent workers
DNS_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=300)
GLOBAL_DNS_CACHE: dict[str, bool] = {}

def sync_resolve_domain(domain: str) -> bool:
    try:
        socket.gethostbyname(domain)
        return True
    except Exception:
        return False

async def check_domain_liveness(
    domain: str,
    semaphore: asyncio.Semaphore,
    loop: asyncio.AbstractEventLoop,
    timeout_sec: float = 1.5
) -> tuple[str, bool, bool]:
    # 1. Global in-memory cache hit (0ms instant return across multiple filters)
    if domain in GLOBAL_DNS_CACHE:
        return domain, GLOBAL_DNS_CACHE[domain], True

    async with semaphore:
        try:
            is_alive = await asyncio.wait_for(
                loop.run_in_executor(DNS_EXECUTOR, sync_resolve_domain, domain),
                timeout=timeout_sec
            )
            GLOBAL_DNS_CACHE[domain] = is_alive
            return domain, is_alive, False
        except Exception:
            GLOBAL_DNS_CACHE[domain] = False
            return domain, False, False

async def filter_live_domains(
    domains: list[str],
    concurrency: int = 300,
    label: str = "",
    timeout_sec: float = 1.5
) -> tuple[list[str], list[str]]:
    loop = asyncio.get_running_loop()
    semaphore = asyncio.Semaphore(max(100, min(concurrency, 500)))
    tasks = [check_domain_liveness(d, semaphore, loop, timeout_sec) for d in domains]
    
    alive = []
    dead = []
    total = len(tasks)
    cache_hits = 0
    
    prefix = f"[{label}] " if label else "[*] "
    cached_count = sum(1 for d in domains if d in GLOBAL_DNS_CACHE)
    print(
        f"{prefix}Turbo DNS scan for {total:,} domains (pool: 300 workers, cache: {cached_count:,} hits, timeout: {timeout_sec}s)...",
        flush=True
    )
    
    completed = 0
    t0 = time.time()
    step_interval = max(100, total // 15)
    
    for fut in asyncio.as_completed(tasks):
        d, is_alive, from_cache = await fut
        if is_alive:
            alive.append(d)
        else:
            dead.append(d)
        if from_cache:
            cache_hits += 1
        completed += 1
        
        if completed % step_interval == 0 or completed == total:
            elapsed = time.time() - t0
            rate = completed / max(0.001, elapsed)
            percent = (completed / total) * 100
            print(
                f"    ↳ Progress: {completed:,}/{total:,} ({percent:.1f}%) — {rate:.0f} checks/sec | Cache: {cache_hits:,} | Alive: {len(alive):,} | Dead: {len(dead):,}",
                flush=True
            )

    return alive, dead

def run_async_pipeline(
    domains: list[str],
    concurrency: int = 300,
    label: str = "",
    timeout_sec: float = 1.5
) -> tuple[list[str], list[str]]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, filter_live_domains(domains, concurrency, label, timeout_sec))
        return future.result()

def process_filter_content(
    content: str,
    concurrency: int = 600,
    label: str = "",
    timeout_sec: float = 2.0
):
    lines = content.splitlines()
    unique_domains = []
    seen = set()
    css_rules = []
    scriptlet_rules = []

    for line in lines:
        raw = line.strip()
        if not raw:
            continue
        if "##+js(" in raw or "#%#//scriptlet(" in raw:
            scriptlet_rules.append(raw)
            continue
        if raw.startswith("##") and not raw.startswith("##+js") and not raw.startswith("##^"):
            css_rules.append(raw)
            continue
        d = parse_domain_line(raw)
        if d and d not in seen:
            seen.add(d)
            unique_domains.append(d)

    if not unique_domains:
        return unique_domains, [], css_rules, scriptlet_rules

    alive_domains, dead_domains = run_async_pipeline(unique_domains, concurrency, label, timeout_sec)
    return alive_domains, dead_domains, css_rules, scriptlet_rules

def main():
    parser = argparse.ArgumentParser(description="Prune dead domains from filter lists on Colab VM")
    parser.add_argument("--url", help="Single filter list URL to download and clean")
    parser.add_argument("--file", help="Local filter list file to clean")
    parser.add_argument("--batch-json", help="Path to JSON file containing list of filters: [{\"name\": \"...\", \"url\": \"...\"}]")
    parser.add_argument("--batch-b64", help="Base64-gzipped JSON string containing list of filters")
    parser.add_argument("--concurrency", type=int, default=600, help="Concurrent DNS lookups (default: 600)")
    parser.add_argument("--timeout", type=float, default=2.0, help="DNS lookup timeout per domain in seconds (default: 2.0)")
    parser.add_argument("--output", help="Optional path to save cleaned domains")
    parser.add_argument("--output-json", help="Optional path to write JSON summary of results")
    parser.add_argument("--output-dir", help="Directory to save all cleaned filter files in batch mode")
    args = parser.parse_args()

    batch_items = None
    if args.batch_b64:
        import base64
        import gzip
        try:
            raw_json = gzip.decompress(base64.b64decode(args.batch_b64)).decode("utf-8")
            batch_items = json.loads(raw_json)
        except Exception as e:
            print(f"[!] Failed to decode --batch-b64: {e}", flush=True)
            sys.exit(1)
    elif args.batch_json:
        if not os.path.exists(args.batch_json):
            print(f"[!] Batch file not found: {args.batch_json}", flush=True)
            sys.exit(1)
        with open(args.batch_json, "r", encoding="utf-8") as f:
            batch_items = json.load(f)

    if batch_items is not None:
        print(f"╔══════════════════════════════════════════════════════════════════╗", flush=True)
        print(f"║     COLAB BATCH DEAD DOMAIN PRUNING (DATABASE FILTERS)           ║", flush=True)
        print(f"║     Total filters: {len(batch_items):<10} | Concurrency: {args.concurrency:<6} | Timeout: {args.timeout}s  ║", flush=True)
        print(f"╚══════════════════════════════════════════════════════════════════╝\n", flush=True)

        total_checked = 0
        total_alive = 0
        total_dead = 0
        batch_results = []
        t_batch_start = time.time()

        for idx, item in enumerate(batch_items, 1):
            name = item.get("name", f"filter_{idx}")
            url = item.get("url", "")
            print(f"\n▶ [{idx}/{len(batch_items)}] Fetching '{name}' ({url})...", flush=True)
            try:
                t0_dl = time.time()
                req = urllib.request.Request(url, headers={"User-Agent": "BlockAds-Filter-Cleaner/1.0"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    content = resp.read().decode("utf-8", errors="ignore")
                dl_time = time.time() - t0_dl
                print(f"  ✓ Downloaded {len(content)/1024:.1f} KB in {dl_time:.2f}s", flush=True)
                
                alive, dead, css, scriptlets = process_filter_content(
                    content,
                    concurrency=args.concurrency,
                    label=name,
                    timeout_sec=args.timeout
                )
                tot = len(alive) + len(dead)
                total_checked += tot
                total_alive += len(alive)
                total_dead += len(dead)
                pct_dead = (len(dead) / tot * 100) if tot > 0 else 0

                clean_file_path = ""
                if args.output_dir:
                    os.makedirs(args.output_dir, exist_ok=True)
                    clean_file_path = os.path.join(args.output_dir, f"{name}.txt")
                    with open(clean_file_path, "w", encoding="utf-8") as out:
                        for d in alive:
                            out.write(f"||{d}^\n")
                        for c in css:
                            out.write(f"{c}\n")
                        for s in scriptlets:
                            out.write(f"{s}\n")

                print(f"  ✅ Filter '{name}' complete: {tot:,} checked | {len(alive):,} Alive | {len(dead):,} Pruned ({pct_dead:.1f}%)", flush=True)

                batch_results.append({
                    "name": name,
                    "url": url,
                    "cleaned_file": clean_file_path,
                    "total_domains": tot,
                    "alive_domains": len(alive),
                    "dead_domains": len(dead),
                    "reduction_pct": round(pct_dead, 1),
                    "css_rules": len(css),
                    "scriptlets": len(scriptlets)
                })
            except Exception as e:
                print(f"  ✗ Failed for {url}: {e}", flush=True)
                batch_results.append({
                    "name": name,
                    "url": url,
                    "error": str(e)
                })

        t_batch_elapsed = time.time() - t_batch_start
        print("\n" + "=" * 65, flush=True)
        print("                 DATABASE BATCH SUMMARY                           ", flush=True)
        print("=" * 65, flush=True)
        print(f"Filters processed:           {len(batch_items):,}", flush=True)
        print(f"Total domains checked:       {total_checked:,}", flush=True)
        print(f"Active / Live domains:       {total_alive:,} ({(total_alive/max(1, total_checked))*100:.1f}%)", flush=True)
        print(f"Dead domains pruned:         {total_dead:,} ({(total_dead/max(1, total_checked))*100:.1f}%)", flush=True)
        print(f"Total batch time:            {t_batch_elapsed:.2f}s ({total_checked/max(0.001, t_batch_elapsed):.0f} domains/s)", flush=True)
        print(f"Average memory saving:       ~{(total_dead/max(1, total_checked))*100:.1f}% reduction in Trie/Bloom size", flush=True)
        print("=" * 65 + "\n", flush=True)

        if args.output_dir:
            summary_path = os.path.join(args.output_dir, "batch_summary.json")
            with open(summary_path, "w", encoding="utf-8") as f:
                json.dump(batch_results, f, indent=2)
            print(f"[✓] Saved batch summary and cleaned files to {args.output_dir}", flush=True)

        if args.output_json:
            with open(args.output_json, "w", encoding="utf-8") as f:
                json.dump(batch_results, f, indent=2)
            print(f"[✓] Batch results saved to {args.output_json}", flush=True)
        return

    content = ""
    source_label = ""
    if args.url:
        print(f"[*] Downloading filter list from: {args.url}", flush=True)
        req = urllib.request.Request(args.url, headers={"User-Agent": "BlockAds-Filter-Cleaner/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
        source_label = args.url
    elif args.file:
        print(f"[*] Reading filter list from: {args.file}", flush=True)
        with open(args.file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        source_label = args.file
    else:
        content = """
        0.0.0.0 google.com
        0.0.0.0 github.com
        0.0.0.0 doubleclick.net
        0.0.0.0 expired-domain-test-non-existent-999.xyz
        0.0.0.0 fake-tracker-dead-sinkhole-112233.org
        ||ads.cloudflare.com^
        ||zombie-dead-domain-sample-1234.net^
        """
        source_label = "Built-in sample test"

    t_start = time.time()
    alive_domains, dead_domains, css_rules, scriptlet_rules = process_filter_content(
        content,
        concurrency=args.concurrency,
        label=source_label,
        timeout_sec=args.timeout
    )
    t_total = time.time() - t_start
    total_domains = len(alive_domains) + len(dead_domains)

    print("\n" + "=" * 60, flush=True)
    print("             RESULTS SUMMARY (DEAD DOMAIN PRUNING)          ", flush=True)
    print("=" * 60, flush=True)
    print(f"Source:                      {source_label}", flush=True)
    print(f"Total domains checked:       {total_domains:,}", flush=True)
    print(f"Active / Live domains:       {len(alive_domains):,} ({len(alive_domains)/max(1, total_domains)*100:.1f}%)", flush=True)
    print(f"Dead / NXDOMAIN pruned:      {len(dead_domains):,} ({len(dead_domains)/max(1, total_domains)*100:.1f}%)", flush=True)
    print(f"Total time elapsed:          {t_total:.2f}s ({total_domains/max(0.001, t_total):.0f} domains/s)", flush=True)
    print(f"Estimated Binary reduction:  ~{len(dead_domains)/max(1, total_domains)*100:.1f}% less Trie/Bloom nodes", flush=True)
    print("=" * 60, flush=True)

    if dead_domains[:5]:
        print(f"\nSample dead domains pruned:", flush=True)
        for d in dead_domains[:5]:
            print(f"  - ✗ {d}", flush=True)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as out:
            for d in alive_domains:
                out.write(f"||{d}^\n")
            for css in css_rules:
                out.write(f"{css}\n")
            for scr in scriptlet_rules:
                out.write(f"{scr}\n")
        print(f"\n[✓] Saved cleaned list to {args.output}", flush=True)

if __name__ == "__main__":
    main()
