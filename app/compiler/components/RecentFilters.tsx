"use client";

import { useState, useEffect } from "react";
import { Download, Loader2, Link2, Box, Calendar, Server, Search, ChevronLeft, ChevronRight, Copy, Check, ArrowUp, ArrowDown } from "lucide-react";

interface FilterRecord {
  id: number;
  name: string;
  url: string;
  r2DownloadLink: string;
  ruleCount: number;
  fileSize: number;
  lastUpdated: string;
  createdAt: string;
}

export default function RecentFilters() {
  const [filters, setFilters] = useState<FilterRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sortField, setSortField] = useState<"time" | "size" | "rule" | "name">("time");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const handleCopy = (id: number, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1); // Reset to first page on search
    }, 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let mounted = true;

    const fetchFilters = async () => {
      try {
        setIsLoading(true);
        const rawBaseUrl = process.env.NEXT_PUBLIC_COMPILER_API_URL || "";
        const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
        
        const params = new URLSearchParams({
          page: currentPage.toString(),
          limit: "10",
          sort: sortField,
          order: sortOrder,
        });
        if (searchQuery) {
          params.append("search", searchQuery);
        }

        const res = await fetch(`${baseUrl}/api/filters?${params.toString()}`, {
            // Provide a cache setting if necessary, Next.js handles it well, but standard fetch behavior is fine
        });
        
        const data = await res.json();

        if (!res.ok || data.status === "error") {
          throw new Error(data.message || "Failed to load recent filters.");
        }

        if (mounted) {
          setFilters(data.data || []);
          setTotalPages(data.meta?.totalPages || 1);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Could not connect to compiler service.");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    fetchFilters();

    return () => {
      mounted = false;
    };
  }, [currentPage, searchQuery, sortField, sortOrder]);

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date);
    } catch {
      return dateString;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input 
            type="text"
            placeholder="Search filter lists by name, url..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00E676]/50 focus:border-[#00E676] transition-all shadow-sm"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <select 
            value={sortField}
            onChange={(e) => {
              setSortField(e.target.value as any);
              setCurrentPage(1);
            }}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00E676]/50 focus:border-[#00E676] transition-all shadow-sm text-gray-700 font-medium cursor-pointer"
          >
            <option value="time">Latest updates</option>
            <option value="name">Name</option>
            <option value="rule">Rule count</option>
            <option value="size">File size</option>
          </select>
          <button
            onClick={() => {
              setSortOrder(order => order === "asc" ? "desc" : "asc");
              setCurrentPage(1);
            }}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-700 transition-all shadow-sm flex items-center justify-center min-w-[3rem]"
            title={sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            {sortOrder === "asc" ? <ArrowUp className="w-5 h-5 text-gray-500" /> : <ArrowDown className="w-5 h-5 text-gray-500" />}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin mb-4 text-[#00E676]" />
          <p className="text-sm">Loading recent builds...</p>
        </div>
      ) : error ? (
        <div className="py-8 text-center text-gray-500 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm">
          <Server className="w-8 h-8 mx-auto mb-3 text-gray-400" />
          <p className="text-sm">{error}</p>
        </div>
      ) : filters.length === 0 ? (
        <div className="py-12 text-center text-gray-500 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm">
          <Box className="w-8 h-8 mx-auto mb-3 text-gray-400" />
          <p className="text-sm font-medium text-gray-600">No cached filters available.</p>
          {searchQuery ? (
             <p className="text-xs mt-1">Try adjusting your search query.</p>
          ) : (
             <p className="text-xs mt-1">Submit a URL above to build the first binary filter.</p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filters.map((filter) => (
              <div 
                key={filter.id} 
                className="group p-5 bg-white border border-gray-200 hover:border-[#00E676]/30 hover:shadow-md rounded-2xl transition-all flex flex-col justify-between"
              >
                <div className="mb-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-semibold text-gray-900 truncate" title={filter.name}>
                      {filter.name || "Default Filter"}
                    </h3>
                    <span className="shrink-0 inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-xs font-medium text-gray-600">
                      {formatBytes(filter.fileSize)}
                    </span>
                  </div>
                  
                  <a 
                    href={filter.url}
                    target="_blank"
                    rel="noopener noreferrer" 
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#00E676] transition-colors truncate max-w-full"
                    title={filter.url}
                  >
                    <Link2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{filter.url}</span>
                  </a>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-auto">
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <div title="Rule Count">
                      <span className="font-semibold text-gray-700">{filter.ruleCount.toLocaleString()}</span> rules
                    </div>
                    <div className="flex items-center gap-1" title="Last Updated">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(filter.lastUpdated)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(filter.id, filter.url)}
                      title="Copy Filter Link"
                      className="p-2 bg-gray-50 text-gray-600 hover:bg-blue-500 hover:text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
                    >
                      {copiedId === filter.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <a
                      href={filter.r2DownloadLink}
                      title="Download Zip"
                      className="p-2 bg-gray-50 text-gray-600 hover:bg-[#00E676] hover:text-black rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#00E676]"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-6 border-t border-gray-100 mt-6">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              
              <span className="text-sm text-gray-500 font-medium">
                Page <span className="text-gray-900">{currentPage}</span> of <span className="text-gray-900">{totalPages}</span>
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
