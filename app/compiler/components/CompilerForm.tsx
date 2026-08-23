"use client";

import { useState } from "react";
import { Loader2, Zap, AlertCircle, CheckCircle2, Download, Archive, Hash } from "lucide-react";

export default function CompilerForm() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    downloadUrl: string;
    ruleCount: number;
    fileSize: number;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // In a real environment, this might be configured differently based on deployment.
      // Clean up baseUrl trailing slash if any
      const rawBaseUrl = process.env.NEXT_PUBLIC_COMPILER_API_URL || "";
      const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
      
      const res = await fetch(`${baseUrl}/api/build`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok || data.status === "error") {
        throw new Error(data.message || "An unknown error occurred.");
      }

      setResult({
        downloadUrl: data.downloadUrl,
        ruleCount: data.ruleCount,
        fileSize: data.fileSize,
      });

      // Clear the url when successful to allow new submissions
      setUrl("");
    } catch (err: any) {
      setError(err.message || "Failed to connect to the compiler service.");
    } finally {
      setIsLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          required
          placeholder="https://example.com/filter.txt"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isLoading}
          className="flex-1 px-5 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#00E676]/50 focus:border-[#00E676] transition-all disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="px-8 py-3.5 bg-[#00E676] text-black font-semibold rounded-2xl hover:bg-[#00C853] transition-all hover:scale-[1.02] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Zap className="w-5 h-5" />
          )}
          <span>{isLoading ? "Compiling..." : "Build Binary"}</span>
        </button>
      </form>

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
                <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">Rule Count</p>
                <p className="font-semibold text-gray-900">{result.ruleCount.toLocaleString()}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 p-3 bg-white/60 rounded-xl">
              <Archive className="w-5 h-5 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500 font-medium tracking-wide uppercase">File Size</p>
                <p className="font-semibold text-gray-900">{formatBytes(result.fileSize)}</p>
              </div>
            </div>
          </div>

          <a
            href={result.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-900 font-semibold rounded-xl hover:bg-gray-50 transition-all shadow-sm group"
          >
            <Download className="w-4 h-4 text-gray-500 group-hover:text-gray-900 transition-colors" />
            <span>Download .zip Package</span>
          </a>
        </div>
      )}
    </div>
  );
}
