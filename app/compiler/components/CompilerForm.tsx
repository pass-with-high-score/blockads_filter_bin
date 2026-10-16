"use client";

import { useState } from "react";
import {
  Loader2,
  Zap,
  AlertCircle,
  CheckCircle2,
  Download,
  Archive,
  Hash,
  Plus,
  Trash2,
  Copy,
  Check,
  Layers,
  FileCode,
  Link as LinkIcon,
  Eye,
  ExternalLink,
} from "lucide-react";

type TabMode = "binary" | "combine";
type OutputFormat = "adblock" | "domains" | "hosts";

export default function CompilerForm() {
  const [activeTab, setActiveTab] = useState<TabMode>("binary");

  // ── Binary Compiler State ──
  const [urls, setUrls] = useState<string[]>([""]);
  const [customName, setCustomName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Compiling...");
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [result, setResult] = useState<{
    downloadUrl: string;
    ruleCount: number;
    fileSize: number;
  } | null>(null);

  // ── Combiner / Sub-converter State ──
  const [combineUrls, setCombineUrls] = useState<string[]>([
    "https://raw.githubusercontent.com/bigdargon/hostsVN/master/hosts",
    "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
  ]);
  const [combineFormat, setCombineFormat] = useState<OutputFormat>("adblock");
  const [isCombining, setIsCombining] = useState(false);
  const [combineError, setCombineError] = useState<string | null>(null);
  const [combinePreview, setCombinePreview] = useState<{
    text: string;
    ruleCount: number;
  } | null>(null);
  const [copiedSubUrl, setCopiedSubUrl] = useState(false);

  // Helpers for dynamic URL inputs
  const handleUrlChange = (index: number, value: string) => {
    const updated = [...urls];
    updated[index] = value;
    setUrls(updated);
  };

  const addUrlField = () => {
    setUrls([...urls, ""]);
  };

  const removeUrlField = (index: number) => {
    if (urls.length <= 1) {
      setUrls([""]);
      return;
    }
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleCombineUrlChange = (index: number, value: string) => {
    const updated = [...combineUrls];
    updated[index] = value;
    setCombineUrls(updated);
  };

  const addCombineUrlField = () => {
    setCombineUrls([...combineUrls, ""]);
  };

  const removeCombineUrlField = (index: number) => {
    if (combineUrls.length <= 1) {
      setCombineUrls([""]);
      return;
    }
    setCombineUrls(combineUrls.filter((_, i) => i !== index));
  };

  // ── Submit Binary Build ──
  const handleBinarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrls = urls.map((u) => u.trim()).filter(Boolean);
    if (cleanUrls.length === 0) return;

    setIsLoading(true);
    setLoadingMessage("Compiling...");
    setError(null);
    setResult(null);

    try {
      const payload: any = {
        name: customName.trim() || undefined,
      };

      if (cleanUrls.length === 1) {
        payload.url = cleanUrls[0];
      } else {
        payload.urls = cleanUrls;
      }

      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      let data: any = {};
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned ${res.status}: ${text.slice(0, 120)}`);
      }

      if (!res.ok || data.status === "error") {
        throw new Error(data.message || "An unknown error occurred during compilation.");
      }

      setResult({
        downloadUrl: data.downloadUrl,
        ruleCount: data.ruleCount,
        fileSize: data.fileSize,
      });
    } catch (err: any) {
      setError(err.message || "Failed to compile filter list(s).");
    } finally {
      setIsLoading(false);
      setLoadingMessage("Compiling...");
    }
  };

  // ── Generate & Preview Combined Filter ──
  const cleanCombineUrls = combineUrls.map((u) => u.trim()).filter(Boolean);
  const generatedSubscriptionUrl =
    cleanCombineUrls.length > 0
      ? `https://complier.pwhs.app/api/combine?urls=${encodeURIComponent(
          cleanCombineUrls.join(",")
        )}&format=${combineFormat}`
      : "";

  const handlePreviewCombine = async () => {
    if (cleanCombineUrls.length === 0) return;

    setIsCombining(true);
    setCombineError(null);
    setCombinePreview(null);

    try {
      const res = await fetch("/api/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: cleanCombineUrls,
          format: combineFormat,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Server returned HTTP ${res.status}`);
      }

      const text = await res.text();
      const ruleCountHeader = res.headers.get("X-Rule-Count");
      const ruleCount = ruleCountHeader
        ? parseInt(ruleCountHeader, 10)
        : text.split("\n").filter((l) => l.trim() && !l.startsWith("!") && !l.startsWith("#")).length;

      setCombinePreview({ text, ruleCount });
    } catch (err: any) {
      setCombineError(err.message || "Failed to combine filter lists.");
    } finally {
      setIsCombining(false);
    }
  };

  const copyToClipboard = (text: string, type: "binary" | "sub") => {
    navigator.clipboard.writeText(text);
    if (type === "binary") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedSubUrl(true);
      setTimeout(() => setCopiedSubUrl(false), 2000);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex p-1.5 bg-gray-100/80 rounded-2xl border border-gray-200/80 max-w-md mx-auto sm:mx-0">
        <button
          type="button"
          onClick={() => setActiveTab("binary")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
            activeTab === "binary"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Archive className="w-4 h-4 text-[#00E676]" />
          <span>Binary Compiler (.zip)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("combine")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
            activeTab === "combine"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Layers className="w-4 h-4 text-[#00E676]" />
          <span>Merge to Sub (.txt)</span>
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* TAB 1: BINARY COMPILER (.zip for BlockAds App)              */}
      {/* ──────────────────────────────────────────────────────────── */}
      {activeTab === "binary" && (
        <form onSubmit={handleBinarySubmit} className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Filter List URL(s)
              </label>
              <span className="text-xs text-gray-500">
                {urls.length > 1
                  ? `${urls.length} lists will be merged & deduplicated into 1 .zip`
                  : "Single or multi-filter supported"}
              </span>
            </div>

            {urls.map((u, index) => (
              <div key={index} className="flex gap-2 items-center">
                <input
                  type="url"
                  required
                  placeholder={`https://example.com/filter${index > 0 ? index + 1 : ""}.txt`}
                  value={u}
                  onChange={(e) => handleUrlChange(index, e.target.value)}
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00E676]/50 focus:border-[#00E676] transition-all disabled:opacity-50 text-sm"
                />
                {urls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeUrlField(index)}
                    disabled={isLoading}
                    className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    title="Remove URL"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={addUrlField}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-all"
              >
                <Plus className="w-3.5 h-3.5 text-[#00E676]" />
                <span>+ Add another filter list to merge</span>
              </button>

              {urls.length > 1 && (
                <div className="w-full sm:w-auto flex items-center gap-2">
                  <span className="text-xs text-gray-500">Custom Name:</span>
                  <input
                    type="text"
                    placeholder="e.g. MyMergedList (optional)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    disabled={isLoading}
                    className="px-3 py-1 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#00E676]"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading || urls.every((u) => !u.trim())}
              className="w-full sm:w-auto px-8 py-3.5 bg-[#00E676] text-black font-semibold rounded-2xl hover:bg-[#00C853] transition-all hover:scale-[1.01] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Zap className="w-5 h-5" />
              )}
              <span>
                {isLoading
                  ? loadingMessage
                  : urls.length > 1
                  ? `Merge & Build ${urls.filter((u) => u.trim()).length} Lists (.zip)`
                  : "Build Binary (.zip)"}
              </span>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className="p-6 bg-[#00E676]/10 border border-[#00E676]/30 rounded-2xl animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3 mb-4 text-gray-900">
                <CheckCircle2 className="w-6 h-6 text-[#00E676]" />
                <h3 className="font-semibold text-lg">Build Successful!</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="flex items-center gap-3 p-3 bg-white/60 rounded-xl">
                  <Hash className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">
                      Rule Count
                    </p>
                    <p className="font-semibold text-gray-900">
                      {result.ruleCount.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-white/60 rounded-xl">
                  <Archive className="w-5 h-5 text-gray-500" />
                  <div>
                    <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">
                      File Size
                    </p>
                    <p className="font-semibold text-gray-900">
                      {formatBytes(result.fileSize)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={result.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#00E676] text-black font-semibold rounded-xl hover:bg-[#00C853] transition-all shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  <span>Download .zip Package</span>
                </a>

                <button
                  type="button"
                  onClick={() => copyToClipboard(result.downloadUrl, "binary")}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white border border-gray-200 text-gray-800 font-semibold rounded-xl hover:bg-gray-50 transition-all shadow-sm"
                >
                  {copiedUrl ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                  <span>{copiedUrl ? "Copied URL!" : "Copy Download URL"}</span>
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* TAB 2: MERGE TO SUBSCRIPTION (.txt for Adblock / Hosts)     */}
      {/* ──────────────────────────────────────────────────────────── */}
      {activeTab === "combine" && (
        <div className="space-y-5 animate-in fade-in">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Filter Lists to Combine
              </label>
              <span className="text-xs text-gray-500">
                Downloads & deduplicates into clean plain text
              </span>
            </div>

            {combineUrls.map((u, index) => (
              <div key={index} className="flex gap-2 items-center">
                <input
                  type="url"
                  placeholder={`https://example.com/blocklist-${index + 1}.txt`}
                  value={u}
                  onChange={(e) => handleCombineUrlChange(index, e.target.value)}
                  disabled={isCombining}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00E676]/50 focus:border-[#00E676] transition-all disabled:opacity-50 text-sm"
                />
                {combineUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCombineUrlField(index)}
                    disabled={isCombining}
                    className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addCombineUrlField}
              disabled={isCombining}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-[#00E676]" />
              <span>+ Add another filter list</span>
            </button>
          </div>

          {/* Format Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Output Format
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCombineFormat("adblock")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  combineFormat === "adblock"
                    ? "border-[#00E676] bg-[#00E676]/10 text-gray-900 font-semibold"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-semibold">Adblock Plus (ABP)</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  ||domain^, ##css, scriptlets
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCombineFormat("domains")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  combineFormat === "domains"
                    ? "border-[#00E676] bg-[#00E676]/10 text-gray-900 font-semibold"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-semibold">Plain Domains</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  One clean domain per line
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCombineFormat("hosts")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  combineFormat === "hosts"
                    ? "border-[#00E676] bg-[#00E676]/10 text-gray-900 font-semibold"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-semibold">Hosts File</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  0.0.0.0 domain syntax
                </div>
              </button>
            </div>
          </div>

          {/* Live Subscription URL Box */}
          {generatedSubscriptionUrl && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <LinkIcon className="w-3.5 h-3.5 text-[#00E676]" />
                  Live Dynamic Subscription Link
                </span>
                <span className="text-[11px] text-gray-500">
                  Always serves fresh merged rules
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedSubscriptionUrl}
                  className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(generatedSubscriptionUrl, "sub")}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-800 text-xs font-semibold rounded-xl hover:bg-gray-100 transition-all flex items-center gap-1.5 shrink-0"
                >
                  {copiedSubUrl ? (
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-500" />
                  )}
                  <span>{copiedSubUrl ? "Copied" : "Copy Link"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePreviewCombine}
              disabled={isCombining || cleanCombineUrls.length === 0}
              className="px-6 py-3 bg-[#00E676] text-black font-semibold rounded-2xl hover:bg-[#00C853] transition-all hover:scale-[1.01] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCombining ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span>{isCombining ? "Combining..." : "Preview Merged Output"}</span>
            </button>

            {generatedSubscriptionUrl && (
              <a
                href={generatedSubscriptionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 bg-white border border-gray-200 text-gray-800 font-semibold rounded-2xl hover:bg-gray-50 transition-all flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4 text-gray-500" />
                <span>Open Raw Text</span>
              </a>
            )}
          </div>

          {/* Error Message */}
          {combineError && (
            <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{combineError}</p>
            </div>
          )}

          {/* Preview Output Box */}
          {combinePreview && (
            <div className="p-5 bg-white border border-gray-200 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-[#00E676]" />
                  <span className="font-semibold text-gray-900 text-sm">
                    Combined Successfully
                  </span>
                  <span className="px-2.5 py-0.5 bg-[#00E676]/20 text-[#00C853] text-xs font-bold rounded-full">
                    {combinePreview.ruleCount.toLocaleString()} rules
                  </span>
                </div>

                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                    combinePreview.text
                  )}`}
                  download={`combined_filter_${combineFormat}.txt`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-black bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .txt</span>
                </a>
              </div>

              <textarea
                readOnly
                rows={10}
                value={combinePreview.text.slice(0, 10000)}
                className="w-full p-3 font-mono text-xs bg-gray-900 text-green-400 rounded-xl focus:outline-none select-all"
              />
              {combinePreview.text.length > 10000 && (
                <p className="text-[11px] text-gray-400 text-right">
                  Preview truncated to first 10,000 characters. Click "Open Raw Text" or "Download .txt" for the full file.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
