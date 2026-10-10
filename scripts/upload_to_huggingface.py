#!/usr/bin/env python3
"""
Upload BlockAds ONNX Model & Metadata to Hugging Face Hub
---------------------------------------------------------
Usage:
    python3 scripts/upload_to_huggingface.py --repo-id <username/repo-name> [--token <HF_TOKEN>]
"""

import argparse
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Upload BlockAds ONNX Model to Hugging Face Hub")
    parser.add_argument("--repo-id", required=True, help="Target Hugging Face repository ID (e.g. your-username/blockads-onnx)")
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN"), help="Hugging Face Write Token (or set HF_TOKEN env)")
    parser.add_argument("--private", action="store_true", help="Set repository to private")
    args = parser.parse_args()

    # 1. Verify huggingface_hub is installed
    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError:
        print("[*] Installing huggingface_hub...")
        os.system(f"{sys.executable} -m pip install -q huggingface_hub")
        from huggingface_hub import HfApi, create_repo

    token = args.token
    if not token:
        print("[!] Error: Hugging Face token is required!")
        print("    Get your Write Token at: https://huggingface.co/settings/tokens")
        print("    Then pass it with: --token hf_... OR set export HF_TOKEN=hf_...")
        sys.exit(1)

    models_dir = "models"
    files_to_upload = [
        "adblock_model.onnx",
        "adblock_domain_classifier.joblib",
        "model_meta.json",
        "README.md"
    ]

    print(f"[*] Verifying model artifacts in '{models_dir}'...")
    for f in files_to_upload:
        p = os.path.join(models_dir, f)
        if not os.path.exists(p):
            print(f"[!] Missing file: {p}")
            sys.exit(1)
        print(f"    ✓ Found {f} ({os.path.getsize(p)/1024:.1f} KB)")

    api = HfApi(token=token)

    print(f"\n[*] Creating / Checking repository '{args.repo_id}' on Hugging Face...")
    try:
        create_repo(
            repo_id=args.repo_id,
            token=token,
            repo_type="model",
            private=args.private,
            exist_ok=True
        )
        print(f"    ✓ Repository ready: https://huggingface.co/{args.repo_id}")
    except Exception as e:
        print(f"[!] Error creating repo: {e}")
        sys.exit(1)

    print(f"\n[*] Uploading model artifacts to Hugging Face...")
    for f in files_to_upload:
        local_path = os.path.join(models_dir, f)
        print(f"    ➔ Uploading {f}...")
        api.upload_file(
            path_or_fileobj=local_path,
            path_in_repo=f,
            repo_id=args.repo_id,
            repo_type="model"
        )
        print(f"    ✓ {f} uploaded successfully.")

    print("\n" + "═" * 60)
    print("🎉 SUCCESS! Your AI model is now live on Hugging Face:")
    print(f"👉 https://huggingface.co/{args.repo_id}")
    print("═" * 60 + "\n")

if __name__ == "__main__":
    main()
