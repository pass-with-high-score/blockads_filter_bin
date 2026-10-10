#!/usr/bin/env python3
"""
Test AI Domain Classifier Coverage against EasyList Privacy & StevenBlack
--------------------------------------------------------------------------
Uses ONNX Runtime Mobile Model (models/adblock_model.onnx) to evaluate
blocking coverage and false positive rates on real-world datasets.
"""

import math
import os
import re
import sys
import time
import urllib.request
import numpy as np
from collections import Counter
import onnxruntime as ort

BENIGN_SUB_PREFIXES = {
    "www", "mail", "api", "support", "portal", "docs", "cdn", "static",
    "auth", "login", "pay", "help", "app", "dev", "cloud", "s3", "media",
    "img", "assets", "download", "upload", "news", "blog", "forum", "shop",
    "store", "m", "en", "vi", "my", "web", "direct", "secure", "account"
}

AD_ROOTS = [
    "adservice", "adserver", "pagead", "doubleclick", "syndicat", "telemetry",
    "adnxs", "pixel", "pxl", "track", "trck", "analytic", "metric", "banner",
    "popunder", "popup", "affiliat", "adzerk", "outbrain", "taboola", "criteo",
    "adjust", "appsflyer", "kochava", "singular", "clevertap", "mixpanel",
    "hotjar", "amplitude", "scorecardresearch", "moatads"
]

SUSPICIOUS_TLDS = {
    ".xyz", ".top", ".click", ".link", ".loan", ".buzz", ".work",
    ".gq", ".cf", ".ga", ".ml", ".tk", ".men", ".stream", ".date"
}

def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = Counter(s)
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in counts.values())

def split_domain_parts(domain: str) -> tuple[list[str], str, str]:
    domain = domain.lower().strip()
    if domain.startswith("www."):
        domain = domain[4:]
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in ("com", "edu", "gov", "org", "net", "co", "ac"):
        sld = parts[-3] if len(parts) >= 3 else parts[0]
        subdomains = parts[:-3]
        tld = ".".join(parts[-2:])
    else:
        sld = parts[-2] if len(parts) >= 2 else parts[0]
        subdomains = parts[:-2] if len(parts) >= 2 else []
        tld = parts[-1] if len(parts) >= 1 else ""
    return subdomains, sld, tld

BENIGN_AD_WORDS = {
    "admin", "address", "adult", "advice", "adventure", "admission",
    "advance", "adopt", "admit", "adobe", "add", "addition", "adapt",
    "adjacent", "adjuster", "adequate", "admire", "advocate"
}

def match_ad_roots(token: str) -> int:
    if not token:
        return 0
    if token in ("ad", "ads"):
        return 1
    # Match ad* or ads* prefixes (e.g. admaxium, adscore, adnext, adspsp, aditude)
    if token.startswith(("ad", "ads")) and len(token) > 2:
        if token not in BENIGN_AD_WORDS and not any(token.startswith(b) for b in BENIGN_AD_WORDS):
            return 1
    for r in AD_ROOTS:
        if r in token:
            return 1
    return 0

def extract_features(domain: str) -> list[float]:
    domain = domain.lower().strip()
    if domain.startswith("www."):
        domain = domain[4:]
    
    subdomains, sld, tld = split_domain_parts(domain)
    
    length = len(domain)
    hyphens = domain.count("-")
    digits = sum(c.isdigit() for c in domain)
    digit_ratio = digits / max(1, length)
    entropy = shannon_entropy(domain)
    
    tokens = [t for t in re.split(r"[-._0-9]+", domain) if t]
    sub_tokens = [t for sub in subdomains for t in re.split(r"[-._0-9]+", sub) if t]
    sld_tokens = [t for t in re.split(r"[-._0-9]+", sld) if t]
    
    ad_hits = sum(match_ad_roots(t) for t in tokens)
    sub_ad_hits = sum(match_ad_roots(t) for t in sub_tokens)
    sld_ad_hits = sum(match_ad_roots(t) for t in sld_tokens)
    
    has_sub_ad = 1.0 if sub_ad_hits > 0 else 0.0
    has_sld_ad = 1.0 if sld_ad_hits > 0 else 0.0
    has_ad_token = 1.0 if ad_hits > 0 else 0.0
    
    sub_benign_hits = sum(1 for s in subdomains if s in BENIGN_SUB_PREFIXES or any(t in BENIGN_SUB_PREFIXES for t in re.split(r"[-._0-9]+", s)))
    is_safe_service = 1.0 if sub_benign_hits > 0 else 0.0
    ad_intent_delta = float(ad_hits - sub_benign_hits)
    
    is_suspicious_tld = 1.0 if any(domain.endswith(t) for t in SUSPICIOUS_TLDS) else 0.0
    vowels = sum(c in "aeiou" for c in domain)
    vowel_ratio = vowels / max(1, length)
    
    return [
        float(length),
        float(hyphens),
        float(digit_ratio),
        float(entropy),
        has_ad_token,
        has_sub_ad,
        has_sld_ad,
        float(ad_hits),
        float(sub_ad_hits),
        float(sld_ad_hits),
        float(sub_benign_hits),
        is_safe_service,
        ad_intent_delta,
        float(len(sld)),
        is_suspicious_tld,
        float(vowel_ratio)
    ]

def predict_batch(sess, input_name, domains: list[str]) -> np.ndarray:
    feats = np.array([extract_features(d) for d in domains], dtype=np.float32)
    # Run in chunks of 5,000 for efficient memory
    probs = []
    chunk_size = 5000
    for i in range(0, len(feats), chunk_size):
        chunk = feats[i:i+chunk_size]
        res = sess.run(None, {input_name: chunk})
        prob_dicts = res[1]
        chunk_probs = [p.get(1, 0.0) for p in prob_dicts]
        probs.extend(chunk_probs)
    return np.array(probs)

def fetch_easyprivacy_domains(max_count=10000) -> list[str]:
    print("[1/3] Loading EasyList Privacy (EasyPrivacy)...")
    cache_path = "models/cache/easyprivacy.txt"
    domains = []
    seen = set()
    
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    else:
        url = "https://easylist.to/easylist/easyprivacy.txt"
        req = urllib.request.Request(url, headers={"User-Agent": "BlockAds-Tester/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            lines = resp.read().decode("utf-8", errors="ignore").splitlines()
            
    for line in lines:
        line = line.strip()
        if line.startswith("||") and "^" in line:
            d = line[2:line.index("^")].strip().lower()
            if "." in d and "/" not in d and "*" not in d and d not in seen:
                seen.add(d)
                domains.append(d)
                if max_count and len(domains) >= max_count:
                    break
    print(f"    ✓ Loaded {len(domains):,} genuine privacy/tracker domains from EasyPrivacy.")
    return domains

def fetch_stevenblack_domains(max_count=10000) -> list[str]:
    print("[2/3] Loading StevenBlack Unified Hosts...")
    cache_path = "models/cache/stevenblack.txt"
    domains = []
    seen = set()
    
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    else:
        url = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
        req = urllib.request.Request(url, headers={"User-Agent": "BlockAds-Tester/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            lines = resp.read().decode("utf-8", errors="ignore").splitlines()

    for line in lines:
        line = line.strip()
        if line.startswith("0.0.0.0 ") and not line.startswith("0.0.0.0 0.0.0.0"):
            parts = line.split()
            if len(parts) >= 2:
                d = parts[1].strip().lower()
                if "." in d and d not in ("localhost", "local") and d not in seen:
                    seen.add(d)
                    domains.append(d)
                    if max_count and len(domains) >= max_count:
                        break
    print(f"    ✓ Loaded {len(domains):,} ad/malware domains from StevenBlack hosts.")
    return domains

def main():
    onnx_path = "models/adblock_model.onnx"
    if not os.path.exists(onnx_path):
        print(f"[!] Model not found at {onnx_path}")
        sys.exit(1)

    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║     BLOCKADS ON-DEVICE AI EVALUATION: EASYPRIVACY & STEVENBLACK  ║")
    print("╚══════════════════════════════════════════════════════════════════╝\n")

    print(f"[*] Initializing ONNX Runtime Mobile Engine ({onnx_path})...")
    sess = ort.InferenceSession(onnx_path)
    input_name = sess.get_inputs()[0].name
    print(f"    ✓ ONNX Engine loaded successfully (Size: {os.path.getsize(onnx_path)/1024:.1f} KB)\n")

    # 1. Fetch test datasets
    ep_domains = fetch_easyprivacy_domains(max_count=10000)
    sb_domains = fetch_stevenblack_domains(max_count=10000)

    # 2. Test Safe Baseline
    safe_baseline = [
        "google.com", "youtube.com", "facebook.com", "wikipedia.org", "yahoo.com",
        "amazon.com", "apple.com", "netflix.com", "microsoft.com", "instagram.com",
        "twitter.com", "linkedin.com", "reddit.com", "github.com", "openai.com",
        "cloudflare.com", "zoom.us", "tiktok.com", "pinterest.com", "ebay.com",
        "wordpress.org", "adobe.com", "spotify.com", "dropbox.com", "stackexchange.com",
        "stackoverflow.com", "medium.com", "quora.com", "cnn.com", "bbc.co.uk",
        "nytimes.com", "reuters.com", "bloomberg.com", "theguardian.com", "forbes.com",
        "vnexpress.net", "dantri.com.vn", "tuoitre.vn", "thanhnien.vn", "vietnamnet.vn",
        "vietcombank.com.vn", "portal.vietcombank.com.vn", "techcombank.com.vn", "vpbank.com.vn",
        "mbbank.com.vn", "bidv.com.vn", "shopee.vn", "tiki.vn", "lazada.vn", "zalo.me",
        "support.apple.com", "docs.github.com", "cdn.jsdelivr.net", "s3.amazon.com", "aws.amazon.com",
        "mail.google.com", "drive.google.com", "login.microsoftonline.com", "auth.uber.com", "pay.shopee.vn"
    ]

    print("\n" + "═" * 70)
    print("           BENCHMARK 1: EASYLIST PRIVACY (TRACKERS & TELEMETRY)      ")
    print("═" * 70)
    t0 = time.time()
    probs_ep = predict_batch(sess, input_name, ep_domains)
    t_ep = time.time() - t0
    blocked_ep = sum(1 for p in probs_ep if p >= 0.5)
    rate_ep = (blocked_ep / max(1, len(ep_domains))) * 100
    avg_score_ep = np.mean(probs_ep) * 100
    print(f"Total EasyPrivacy Domains Tested:        {len(ep_domains):,}")
    print(f"⛔ BLOCKED as Ad/Tracker (Score >= 50%): {blocked_ep:,} / {len(ep_domains):,} ({rate_ep:.2f}%)")
    print(f"Average Ad Risk Score:                   {avg_score_ep:.1f}%")
    print(f"Inference Time:                          {t_ep:.2f}s ({len(ep_domains)/max(0.01, t_ep):.0f} domains/s)")

    print("\nSample EasyPrivacy classifications:")
    for d, p in list(zip(ep_domains, probs_ep))[:10]:
        decision = "⛔ BLOCK" if p >= 0.5 else "✅ PASS"
        print(f"  {d:<42} ➔ {decision:<10} (Score: {p*100:5.1f}%)")

    print("\n" + "═" * 70)
    print("           BENCHMARK 2: STEVENBLACK UNIFIED HOSTS (ADS & MALWARE)    ")
    print("═" * 70)
    t0 = time.time()
    probs_sb = predict_batch(sess, input_name, sb_domains)
    t_sb = time.time() - t0
    blocked_sb = sum(1 for p in probs_sb if p >= 0.5)
    rate_sb = (blocked_sb / max(1, len(sb_domains))) * 100
    avg_score_sb = np.mean(probs_sb) * 100
    print(f"Total StevenBlack Domains Tested:        {len(sb_domains):,}")
    print(f"⛔ BLOCKED as Ad/Tracker (Score >= 50%): {blocked_sb:,} / {len(sb_domains):,} ({rate_sb:.2f}%)")
    print(f"Average Ad Risk Score:                   {avg_score_sb:.1f}%")
    print(f"Inference Time:                          {t_sb:.2f}s ({len(sb_domains)/max(0.01, t_sb):.0f} domains/s)")

    print("\nSample StevenBlack classifications:")
    for d, p in list(zip(sb_domains, probs_sb))[:10]:
        decision = "⛔ BLOCK" if p >= 0.5 else "✅ PASS"
        print(f"  {d:<42} ➔ {decision:<10} (Score: {p*100:5.1f}%)")

    print("\n" + "═" * 70)
    print("           BENCHMARK 3: SAFE SITES & BANKING (FALSE POSITIVE CHECK)  ")
    print("═" * 70)
    probs_safe = predict_batch(sess, input_name, safe_baseline)
    passed_safe = sum(1 for p in probs_safe if p < 0.5)
    rate_safe = (passed_safe / len(safe_baseline)) * 100
    avg_score_safe = np.mean(probs_safe) * 100
    print(f"Total Legitimate Domains Tested:         {len(safe_baseline):,}")
    print(f"✅ ALLOWED / PASSED (Score < 50%):       {passed_safe:,} / {len(safe_baseline):,} ({rate_safe:.2f}%)")
    print(f"False Positives (Bị chặn nhầm):          {len(safe_baseline) - passed_safe:,} ({(100 - rate_safe):.2f}%)")
    print(f"Average Ad Risk Score:                   {avg_score_safe:.1f}%")

    print("\nSample Safe site classifications:")
    for d, p in list(zip(safe_baseline, probs_safe))[:10]:
        decision = "⛔ BLOCK" if p >= 0.5 else "✅ PASS"
        print(f"  {d:<42} ➔ {decision:<10} (Score: {p*100:5.1f}%)")

    print("\n" + "═" * 70)
    print("                           FINAL VERDICT                             ")
    print("═" * 70)
    print(f"• EasyPrivacy Trackers Block Rate:  {rate_ep:.2f}%")
    print(f"• StevenBlack Ads Block Rate:       {rate_sb:.2f}%")
    print(f"• Safe Sites Accuracy:              {rate_safe:.2f}% (Bảo toàn trang web sạch)")
    print(f"• On-Device Inference Speed:        > {len(ep_domains)/max(0.01, t_ep):.0f} domains / second")
    print("═" * 70 + "\n")

if __name__ == "__main__":
    main()
