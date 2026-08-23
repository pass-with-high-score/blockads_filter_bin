import CompilerForm from "./compiler/components/CompilerForm";
import RecentFilters from "./compiler/components/RecentFilters";

export const metadata = {
  title: "Filter Compiler - BlockAds",
  description: "Compile BlockAds filter lists into optimized `.trie`, `.bloom`, and `.css` binary formats.",
};

export default function CompilerPage() {
  return (
    <div className="mesh-bg min-h-screen pt-12 pb-24 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header Section */}
        <div className="text-center space-y-4 relative">
          {/* Decorative effect */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-[#00E676]/20 blur-[80px] rounded-full point-events-none" />
          
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 relative z-10">
            Filter <span className="text-[#00E676]">Compiler</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto relative z-10">
            Convert standard filter blocklists (e.g., EasyList, ADGuard) into highly-optimized binary formats designed exclusively for the BlockAds DNS Engine.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-12 relative z-10">
          {/* Build Form */}
          <section className="bg-white/80 backdrop-blur-xl border border-gray-200/60 p-6 md:p-8 rounded-3xl shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Build Filter</h2>
              <p className="text-sm text-gray-500 mt-1 mb-2">
                Provide a raw filter list URL to queue for compiling. If the URL hasn't been compiled recently, the engine will download it, parse the rules, generate the binary trees, and bundle them into a zip file on Cloudflare R2.
              </p>
            </div>
            <CompilerForm />
          </section>

          {/* Recent Builds Table / List */}
          <section className="bg-white/80 backdrop-blur-xl border border-gray-200/60 p-6 md:p-8 rounded-3xl shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Recent Filters</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Recently compiled filter records available for direct download.
                </p>
              </div>
            </div>
            <RecentFilters />
          </section>
        </div>
      </div>
    </div>
  );
}
