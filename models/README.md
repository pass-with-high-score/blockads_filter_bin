---
language:
- en
- vi
license: mit
library_name: onnx
tags:
- adblock
- adblocker
- privacy
- tracker-detection
- onnx
- on-device
- mobile
pipeline_tag: text-classification
---

# 🛡️ BlockAds On-Device AI Domain Classifier (ONNX)

A lightweight, ultra-fast **On-Device Machine Learning model** (~900 KB) designed for mobile adblockers, DNS VPNs, and firewall applications. It evaluates domain names and detects advertisement, telemetry, and tracking infrastructure in **< 0.02ms** without cloud dependency.

## 🚀 Key Specifications

- **Format:** ONNX (`adblock_model.onnx`) & Scikit-Learn (`adblock_domain_classifier.joblib`)
- **Model Size:** 905.6 KB (Mobile ready)
- **Inference Speed:** > 45,000 domains / second on CPU (Single Thread)
- **Trained Samples:** 1,000,000 balanced domains (Tranco, Cisco Umbrella, StevenBlack, EasyPrivacy)
- **Recommended Threshold:** `0.75` (75%) for 0% False Positives on banking and news websites.

---

## 📊 Benchmark Results

| Benchmark Dataset | Size | Threshold | Block Rate | Safe Sites Accuracy |
| :--- | :---: | :---: | :---: | :---: |
| **Legitimate Websites & Banking** | 60 | 0.75 | 0.00% FP | **100.00% PASS** |
| **StevenBlack Unified Hosts** | 10,000 | 0.75 | **35.08%** | — |
| **EasyList Privacy (EasyPrivacy)** | 10,000 | 0.75 | **18.79%** | — |
| **Zero-Day MMP Trackers (Adjust, AppsFlyer)** | Tested | 0.75 | **100.00%** | — |

> **Dual-Tier Architecture Note:** In production mobile applications, use a **Trie / Bloom Filter** for known static blocklists (Tier 1) and this **ONNX Model** (Tier 2) to intercept novel zero-day and DGA tracking domains before they appear in public filter lists.

---

## 💻 Quickstart (Python + ONNX Runtime)

```python
import numpy as np
import onnxruntime as ort
import re, math
from collections import Counter

# 1. Load Model
session = ort.InferenceSession("adblock_model.onnx")
input_name = session.get_inputs()[0].name

# 2. Extract Features (16 calibrated topological & lexical features)
def extract_features(domain: str) -> list[float]:
    # (See scripts/test_model_coverage.py for full feature extraction logic)
    pass

# 3. Predict
domains = ["app.adjust.com", "vietcombank.com.vn", "random-tracker-xyz.buzz"]
# X = np.array([extract_features(d) for d in domains], dtype=np.float32)
# probs = session.run(None, {input_name: X})[1]
# for d, p in zip(domains, probs):
#     print(f"{d}: {'BLOCK' if p.get(1, 0.0) >= 0.75 else 'PASS'} ({p.get(1, 0.0)*100:.1f}%)")
```

## 📱 Mobile Deployment
- **iOS:** Convert to CoreML via `coremltools` or use `onnxruntime-c` / Swift pod.
- **Android:** Use `com.microsoft.onnxruntime:onnxruntime-android` via Maven Central.
