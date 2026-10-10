#!/usr/bin/env python3
"""
BlockAds AI Domain Classifier — Training Script
-----------------------------------------------
Trains a lightweight machine learning model to classify whether a domain
is an Advertisement/Tracker/Malware (1) or a Benign/Safe website (0).

Designed to run on Google Colab or locally.
Outputs:
- adblock_domain_model.joblib
- adblock_domain_model.json (for zero-dependency inference in Go, Kotlin, TypeScript)
"""

import argparse
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
import zipfile
from collections import Counter

# Try importing ML libraries
try:
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
    from sklearn.model_selection import train_test_split
except ImportError:
    import os
    os.system(f"{sys.executable} -m pip install --break-system-packages -q scikit-learn numpy joblib")
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
    from sklearn.model_selection import train_test_split

BENIGN_SUB_PREFIXES = {
    "www", "mail", "api", "support", "portal", "docs", "cdn", "static",
    "auth", "login", "pay", "help", "app", "dev", "cloud", "s3", "media",
    "img", "assets", "download", "upload", "news", "blog", "forum", "shop",
    "store", "m", "en", "vi", "my", "web", "direct", "secure", "account"
}

AD_TOKENS = {
    "ad", "ads", "adservice", "adserver", "doubleclick", "track", "tracker",
    "tracking", "pixel", "analytic", "analytics", "telemetry", "banner",
    "pop", "syndication", "beacon", "affiliate", "stat", "stats", "metrics",
    "counter", "audit", "adzerk", "outbrain", "taboola", "criteo"
}

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

def max_consecutive_consonants(s: str) -> int:
    vowels = set("aeiou0123456789.-_")
    max_run = 0
    cur_run = 0
    for c in s:
        if c.isalpha() and c not in vowels:
            cur_run += 1
            if cur_run > max_run:
                max_run = cur_run
        else:
            cur_run = 0
    return max_run

def split_domain_parts(domain: str) -> tuple[list[str], str, str]:
    domain = domain.lower().strip()
    if domain.startswith("www."):
        domain = domain[4:]
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in ("com", "edu", "gov", "org", "net", "co", "ac"):
        # e.g. vietcombank.com.vn or bbc.co.uk
        sld = parts[-3] if len(parts) >= 3 else parts[0]
        subdomains = parts[:-3]
        tld = ".".join(parts[-2:])
    else:
        sld = parts[-2] if len(parts) >= 2 else parts[0]
        subdomains = parts[:-2] if len(parts) >= 2 else []
        tld = parts[-1] if len(parts) >= 1 else ""
    return subdomains, sld, tld

def extract_features(domain: str) -> list[float]:
    """Extract fast, hierarchy-aware lexical and structural features from domain."""
    domain = domain.lower().strip()
    if domain.startswith("www."):
        domain = domain[4:]
    
    subdomains, sld, tld = split_domain_parts(domain)
    
    length = len(domain)
    dots = domain.count(".")
    hyphens = domain.count("-")
    digits = sum(c.isdigit() for c in domain)
    digit_ratio = digits / max(1, length)
    entropy = shannon_entropy(domain)
    max_cons = max_consecutive_consonants(domain)
    
    tokens = [t for t in re.split(r"[-._0-9]+", domain) if t]
    sub_tokens = [t for sub in subdomains for t in re.split(r"[-._0-9]+", sub) if t]
    sld_tokens = [t for t in re.split(r"[-._0-9]+", sld) if t]
    
    ad_token_hits = sum(1 for t in tokens if t in AD_TOKENS)
    sub_ad_hits = sum(1 for t in sub_tokens if t in AD_TOKENS)
    sub_benign_hits = sum(1 for s in subdomains if s in BENIGN_SUB_PREFIXES or any(t in BENIGN_SUB_PREFIXES for t in re.split(r"[-._0-9]+", s)))
    is_sld_ad = 1.0 if any(t in AD_TOKENS for t in sld_tokens) else 0.0
    
    sub_len = sum(len(s) for s in subdomains)
    sub_len_ratio = sub_len / max(1, length)
    is_suspicious_tld = 1.0 if any(domain.endswith(t) for t in SUSPICIOUS_TLDS) else 0.0
    vowels = sum(c in "aeiou" for c in domain)
    vowel_ratio = vowels / max(1, length)

    return [
        float(length),
        float(dots),
        float(hyphens),
        float(digit_ratio),
        float(entropy),
        float(max_cons),
        float(ad_token_hits),
        float(sub_ad_hits),
        float(sub_benign_hits),
        is_sld_ad,
        float(len(sld)),
        float(len(subdomains)),
        float(sub_len_ratio),
        is_suspicious_tld,
        float(vowel_ratio)
    ]

FEATURE_NAMES = [
    "length", "dots", "hyphens", "digit_ratio", "entropy",
    "max_consecutive_consonants", "ad_token_hits", "subdomain_ad_hits",
    "subdomain_benign_hits", "is_sld_ad_brand", "sld_length",
    "subdomain_count", "subdomain_length_ratio", "is_suspicious_tld", "vowel_ratio"
]

def fetch_ads_from_database(db_url: str, max_samples: int = 25000) -> list[str]:
    """Extracts ad/malware domains directly from PostgreSQL database with diverse sampling."""
    print(f"[*] Querying PostgreSQL database for genuine BlockAds Ad & Tracker filter lists...")
    ad_domains = []
    import random
    try:
        try:
            import psycopg2
        except ImportError:
            os.system(f"{sys.executable} -m pip install --break-system-packages -q psycopg2-binary")
            import psycopg2

        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # Query genuine ad/tracker filter lists (excluding pure NRD/malware numerical spam)
        cur.execute("""
            SELECT name, url, rule_count 
            FROM filter_lists 
            WHERE (name ILIKE '%ad%' OR name ILIKE '%track%' OR name ILIKE '%easylist%' OR name ILIKE '%oisd%')
              AND name NOT ILIKE '%spydisec%'
              AND name NOT ILIKE '%nrd%'
            ORDER BY rule_count DESC 
            LIMIT 10
        """)
        filters = cur.fetchall()
        print(f"    ✓ Selected {len(filters)} top Ad/Tracker filter lists from Database.")
        
        raw_candidates = []
        for fname, furl, rcount in filters:
            if len(raw_candidates) >= max_samples * 3:
                break
            try:
                req = urllib.request.Request(furl, headers={"User-Agent": "BlockAds-AI-Trainer/1.0"})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    lines = resp.read().decode("utf-8", errors="ignore").splitlines()
                    for line in lines:
                        line = line.strip()
                        d = ""
                        if line.startswith("0.0.0.0 ") or line.startswith("127.0.0.1 "):
                            parts = line.split()
                            if len(parts) >= 2:
                                d = parts[1].strip().lower()
                        elif line.startswith("||") and "^" in line:
                            d = line[2:line.index("^")].strip().lower()
                        elif "." in line and " " not in line and not line.startswith(("#", "!")):
                            d = line.strip().lower()

                        if d and "." in d and len(d) > 3 and d not in ("localhost", "local", "broadcasthost"):
                            raw_candidates.append(d)
            except Exception:
                continue

        conn.close()
        
        # Shuffle to ensure diverse representation across all letters of the alphabet
        random.seed(42)
        random.shuffle(raw_candidates)
        ad_domains = raw_candidates[:max_samples]
        print(f"    ✓ Successfully sampled {len(ad_domains):,} diverse Ad/Tracker domains from Database.")
    except Exception as e:
        print(f"    [!] Database extraction fallback ({e})")
    return ad_domains

def fetch_sample_dataset(max_samples: int = 25000, db_url: str = None) -> tuple[list[str], list[str]]:
    """Fetches authentic ground-truth benign domains (Cisco Umbrella 1M) and ad/tracking domains from Database."""
    import random
    print(f"[*] Downloading authentic benign domains from Cisco Umbrella Top 1M (real global DNS traffic)...")
    benign_domains = []
    
    # 1. Try Cisco Umbrella Top 1M (contains authentic real-world subdomains)
    try:
        cisco_url = "http://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip"
        req = urllib.request.Request(cisco_url, headers={"User-Agent": "BlockAds-AI-Trainer/1.0"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            z = zipfile.ZipFile(io.BytesIO(resp.read()))
            with z.open(z.namelist()[0]) as f:
                raw_benign = []
                for line in f:
                    parts = line.decode("utf-8", errors="ignore").strip().split(",")
                    if len(parts) >= 2:
                        d = parts[1].strip().lower()
                        if "." in d and len(d) > 3 and d not in ("localhost", "local", "broadcasthost"):
                            raw_benign.append(d)
                            if len(raw_benign) >= max_samples * 2:
                                break
                
                # Add core Vietnamese services and portals to ensure zero false positives
                vn_essential = [
                    "vietcombank.com.vn", "portal.vietcombank.com.vn", "techcombank.com.vn",
                    "vpbank.com.vn", "mbbank.com.vn", "vnexpress.net", "dantri.com.vn",
                    "tuoitre.vn", "thanhnien.vn", "shopee.vn", "api.shopee.vn", "zalo.me",
                    "chinhphu.vn", "mof.gov.vn", "baochinhphu.vn", "tikicdn.com"
                ]
                raw_benign.extend(vn_essential)
                
                random.seed(42)
                random.shuffle(raw_benign)
                benign_domains = raw_benign[:max_samples]
        print(f"    ✓ Loaded {len(benign_domains):,} real-world benign domains from Cisco Umbrella (with authentic subdomains).")
    except Exception as e:
        print(f"    [!] Cisco Umbrella fetch notice ({e}). Falling back to Tranco Top 1M...")
        try:
            tranco_url = "https://tranco-list.eu/top-1m.csv.zip"
            req = urllib.request.Request(tranco_url, headers={"User-Agent": "BlockAds-AI-Trainer/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                z = zipfile.ZipFile(io.BytesIO(resp.read()))
                with z.open(z.namelist()[0]) as f:
                    raw_benign = []
                    for line in f:
                        parts = line.decode("utf-8", errors="ignore").strip().split(",")
                        if len(parts) >= 2:
                            d = parts[1].strip().lower()
                            if "." in d and len(d) > 3:
                                raw_benign.append(d)
                                if len(raw_benign) >= max_samples * 2:
                                    break
                    random.seed(42)
                    random.shuffle(raw_benign)
                    benign_domains = raw_benign[:max_samples]
            print(f"    ✓ Loaded {len(benign_domains):,} benign domains from Tranco Top 1M.")
        except Exception as tranco_err:
            print(f"    [!] Failed to fetch Tranco: {tranco_err}")

    ad_domains = []
    if db_url or os.environ.get("DATABASE_URL"):
        target_db = db_url or os.environ.get("DATABASE_URL")
        ad_domains = fetch_ads_from_database(target_db, max_samples)

    if not ad_domains:
        print(f"[*] Downloading {max_samples:,} ad/tracker domains from StevenBlack hosts (fallback)...")
        try:
            ad_url = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
            req = urllib.request.Request(ad_url, headers={"User-Agent": "BlockAds-AI-Trainer/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw_ads = []
                for line in resp.read().decode("utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if line.startswith("0.0.0.0 ") and not line.startswith("0.0.0.0 0.0.0.0"):
                        parts = line.split()
                        if len(parts) >= 2:
                            d = parts[1].strip().lower()
                            if "." in d and d not in ("localhost", "local"):
                                raw_ads.append(d)
                random.seed(42)
                random.shuffle(raw_ads)
                ad_domains = raw_ads[:max_samples]
            print(f"    ✓ Loaded {len(ad_domains):,} diverse ad/tracker domains from StevenBlack.")
        except Exception as e:
            print(f"    [!] Failed to fetch StevenBlack hosts: {e}")

    return benign_domains, ad_domains

    return benign_domains, ad_domains

def main():
    parser = argparse.ArgumentParser(description="Train BlockAds AI Domain Classifier")
    parser.add_argument("--samples", type=int, default=20000, help="Samples per class (default: 20000)")
    parser.add_argument("--db-url", help="Optional PostgreSQL connection URL (or uses DATABASE_URL env)")
    parser.add_argument("--output-dir", default="models", help="Directory to save model artifacts")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    
    print("╔══════════════════════════════════════════════════════════════════╗")
    print("║        BLOCKADS AI DOMAIN CLASSIFIER — TRAINING PIPELINE         ║")
    print("╚══════════════════════════════════════════════════════════════════╝\n")

    t0 = time.time()
    benign, ads = fetch_sample_dataset(args.samples, args.db_url)
    
    # Remove any cross-contamination
    benign_set = set(benign)
    ads = [d for d in ads if d not in benign_set]
    
    min_count = min(len(benign), len(ads))
    benign = benign[:min_count]
    ads = ads[:min_count]

    domains = benign + ads
    labels = [0] * len(benign) + [1] * len(ads)  # 0 = Benign, 1 = Ad/Tracker

    print(f"\n[*] Extracting features for {len(domains):,} total domains ({len(benign):,} Benign vs {len(ads):,} Ads)...")
    X = np.array([extract_features(d) for d in domains])
    y = np.array(labels)

    X_train, X_test, y_train, y_test, d_train, d_test = train_test_split(
        X, y, domains, test_size=0.2, random_state=42, stratify=y
    )

    print(f"    Training set:   {len(X_train):,} samples")
    print(f"    Validation set: {len(X_test):,} samples")

    print("\n[*] Training Gradient Boosted Decision Forest classifier...")
    clf = HistGradientBoostingClassifier(
        max_iter=200,
        learning_rate=0.08,
        max_leaf_nodes=63,
        random_state=42
    )
    clf.fit(X_train, y_train)

    # Evaluation
    preds = clf.predict(X_test)
    probs = clf.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_test, preds)

    print("\n" + "=" * 60)
    print("                 AI MODEL EVALUATION REPORT                 ")
    print("=" * 60)
    print(f"Overall Accuracy:  {acc * 100:.2f}%\n")
    print(classification_report(y_test, preds, target_names=["Benign (Safe)", "Ad / Tracker"]))

    # Test sample domains (both famous benign, vietnamese sites, and known ad trackers)
    test_samples = [
        "wikipedia.org",
        "vnexpress.net",
        "dantri.com.vn",
        "github.com",
        "netflix.com",
        "support.apple.com",
        "portal.vietcombank.com.vn",
        "cdn.jsdelivr.net",
        "s3.amazon.com",
        "docs.github.com",
        "adservice.google.com",
        "pagead2.googlesyndication.com",
        "trck.pxl-telemetry.xyz",
        "delivery.adnxs.com",
        "tracking-analytics-metric.biz",
        "ads.twitter.com",
        "analytics.tiktok.com",
        "pixel.facebook.com"
    ]
    print("=" * 60)
    print("               LIVE INFERENCE PREDICTION TESTS              ")
    print("=" * 60)
    for sample in test_samples:
        feat = np.array([extract_features(sample)])
        prob_ad = clf.predict_proba(feat)[0][1]
        decision = "⛔ BLOCK (AD/TRACKER)" if prob_ad >= 0.5 else "✅ PASS (SAFE)"
        print(f"{sample:<35} ➔ {decision:<24} (Ad Score: {prob_ad*100:.1f}%)")

    # Export model metadata & lightweight config
    export_info = {
        "model_type": "HistGradientBoostingClassifier",
        "accuracy": round(acc, 4),
        "trained_samples": len(domains),
        "feature_names": FEATURE_NAMES,
        "ad_tokens": sorted(list(AD_TOKENS)),
        "benign_sub_prefixes": sorted(list(BENIGN_SUB_PREFIXES)),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime()),
    }
    info_path = os.path.join(args.output_dir, "model_meta.json")
    with open(info_path, "w", encoding="utf-8") as f:
        json.dump(export_info, f, indent=2)

    import joblib
    joblib_path = os.path.join(args.output_dir, "adblock_domain_classifier.joblib")
    joblib.dump(clf, joblib_path)
    print(f"\n[✓] Model saved to {joblib_path} (Size: {os.path.getsize(joblib_path)/1024:.1f} KB)")
    print(f"[✓] Metadata saved to {info_path}")

    # Automatic ONNX export
    try:
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType
        initial_type = [("float_input", FloatTensorType([None, len(FEATURE_NAMES)]))]
        onx = convert_sklearn(clf, initial_types=initial_type)
        onnx_path = os.path.join(args.output_dir, "adblock_model.onnx")
        with open(onnx_path, "wb") as f:
            f.write(onx.SerializeToString())
        print(f"[✓] ONNX model successfully exported: {onnx_path} ({os.path.getsize(onnx_path)/1024:.1f} KB)")
    except Exception as onnx_err:
        print(f"[!] Note on ONNX export: {onnx_err}")

    print(f"\nTotal training pipeline completed in {time.time() - t0:.2f}s")

if __name__ == "__main__":
    main()
