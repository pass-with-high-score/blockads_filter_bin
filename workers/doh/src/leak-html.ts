/**
 * Web UI for BlockAds DNS Leak & Security Inspector
 * Powered by: brianshea2/addr.tools (https://github.com/brianshea2/addr.tools)
 */

import { ClientNetworkInfo, POWERED_BY } from "./leak";

export function renderLeakHtml(host: string, client: ClientNetworkInfo): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>DNS Leak & Security Check - BlockAds</title>
  <link rel="icon" type="image/svg+xml" href="https://complier.pwhs.app/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: #00E676;
      --accent-dim: #00C853;
      --bg-dark: #f8f9fa;
      --bg-card: #ffffff;
      --bg-card-hover: #f1f3f5;
      --text-primary: #12121a;
      --text-secondary: #5f6368;
      --border: #e5e7eb;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #3b82f6;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-primary);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(0, 230, 118, 0.05) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(99, 102, 241, 0.05) 0%, transparent 50%);
    }

    /* Navbar */
    .navbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 50;
      backdrop-filter: blur(16px);
      background: rgba(255, 255, 255, 0.88);
      border-bottom: 1px solid var(--border);
    }
    .nav-container {
      max-width: 1040px;
      margin: 0 auto;
      padding: 0 20px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text-primary);
      font-weight: 700;
      font-size: 1.15rem;
    }
    .brand-logo { width: 30px; height: 30px; border-radius: 8px; }
    .brand span { color: var(--accent); }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 18px;
      font-size: 13.5px;
      color: var(--text-secondary);
    }
    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.15s;
      font-weight: 500;
    }
    .nav-links a:hover, .nav-links a.active { color: var(--text-primary); }
    .nav-links a.active { color: #00a846; font-weight: 700; }

    /* Layout */
    .main-wrapper {
      max-width: 960px;
      margin: 0 auto;
      padding: 90px 20px 80px;
    }

    /* Hero */
    .hero {
      text-align: center;
      margin-bottom: 30px;
    }
    .hero-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: rgba(0, 230, 118, 0.12);
      border: 1px solid rgba(0, 230, 118, 0.3);
      border-radius: 9999px;
      color: #00a846;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .hero-pill::before {
      content: '';
      width: 7px;
      height: 7px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--accent);
    }
    .hero h1 {
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 8px;
      line-height: 1.2;
    }
    .hero p {
      color: var(--text-secondary);
      font-size: 14.5px;
      max-width: 640px;
      margin: 0 auto;
    }

    .attribution-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 5px 14px;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 12px;
      color: var(--text-secondary);
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    }
    .attribution-badge a {
      color: #2563eb;
      font-weight: 600;
      text-decoration: none;
    }
    .attribution-badge a:hover { text-decoration: underline; }

    /* Cards */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 22px 24px;
      margin-bottom: 20px;
      box-shadow: 0 3px 15px -2px rgba(0, 0, 0, 0.04);
    }
    .section-header {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-header a {
      color: #2563eb;
      text-decoration: none;
    }

    /* IP List & Org styling */
    .org-group {
      margin-bottom: 16px;
    }
    .org-group:last-child { margin-bottom: 0; }
    .org-title {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ip-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding: 9px 12px;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 8px;
      margin-bottom: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }
    .ip-address {
      font-weight: 700;
      color: #0f172a;
    }
    .ip-address a {
      color: inherit;
      text-decoration: none;
    }
    .ip-address a:hover {
      color: #2563eb;
      text-decoration: underline;
    }
    .tag-ptr {
      color: #2563eb;
      font-size: 12px;
      background: #eff6ff;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid #dbeafe;
    }
    .tag-ns {
      color: #7c3aed;
      font-size: 12px;
      background: #f5f3ff;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid #ede9fe;
    }
    .tag-geo {
      color: #0d9488;
      font-size: 12px;
      margin-left: auto;
      font-family: 'Inter', sans-serif;
      font-weight: 500;
    }
    .tag-leak {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }

    /* DNSSEC Table */
    .dnssec-table-wrapper {
      overflow-x: auto;
      margin-top: 10px;
    }
    table.dnssec-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: center;
    }
    table.dnssec-table th {
      background: #f8fafc;
      padding: 10px 14px;
      font-weight: 600;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    table.dnssec-table th:first-child { text-align: left; }
    table.dnssec-table td {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
    }
    table.dnssec-table td:first-child {
      text-align: left;
      font-family: 'Inter', sans-serif;
      color: var(--text-secondary);
      font-weight: 600;
    }
    .pass { color: #16a34a; background: #f0fdf4; border-radius: 6px; }
    .fail { color: #dc2626; background: #fef2f2; border-radius: 6px; }
    .fail-star { color: #d97706; background: #fffbeb; border-radius: 6px; }
    .err { color: #d97706; background: #fffbeb; border-radius: 6px; }
    .pending { color: #94a3b8; font-weight: 400; }

    /* Verdict Banner */
    .verdict-box {
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .verdict-box.secure {
      background: #dcfce7;
      border: 1px solid #86efac;
      color: #14532d;
    }
    .verdict-box.leak {
      background: #fee2e2;
      border: 1px solid #fca5a5;
      color: #7f1d1d;
    }
    .verdict-box.ecs {
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #78350f;
    }
    .verdict-title { font-size: 14.5px; font-weight: 700; }
    .verdict-desc { font-size: 13px; color: inherit; opacity: 0.9; }

    /* Live Status Bar */
    .status-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 38px;
      background: #111827;
      color: #d1d5db;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
      z-index: 40;
      border-top: 1px solid #1f2937;
    }
    .status-tags { display: flex; align-items: center; gap: 14px; }
    .status-tag {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .status-tag.green { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .status-tag.red { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .status-tag.yellow { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .status-tag.dim { color: #6b7280; font-weight: 400; }

    /* Action bar */
    .btn-test {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #111827;
      color: #ffffff;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-test:hover { background: #000000; transform: translateY(-1px); }
    .btn-test:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Star Banner */
    .star-card {
      text-align: center;
      padding: 16px;
      background: #f8fafc;
      border: 1px dashed var(--border);
      border-radius: 12px;
      font-size: 13.5px;
      color: var(--text-secondary);
      margin-top: 10px;
    }
    .star-card a {
      color: #2563eb;
      font-weight: 700;
      text-decoration: none;
    }
    .star-card a:hover { text-decoration: underline; }

    /* Developer tabs */
    .tabs-header {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      position: relative;
    }
    .tab-btn.active { color: #000000; }
    .tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #00E676;
    }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    pre.code-block {
      background: #0f172a;
      color: #e2e8f0;
      padding: 14px;
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      overflow-x: auto;
      line-height: 1.5;
    }
    .link-btn {
      color: #2563eb;
      cursor: pointer;
      text-decoration: underline;
    }
  </style>
</head>
<body>

  <!-- Navbar -->
  <header class="navbar">
    <div class="nav-container">
      <a href="/" class="brand">
        <img src="https://complier.pwhs.app/icon.svg" alt="BlockAds" class="brand-logo" onerror="this.style.display='none'">
        <span>Block<span>Ads</span></span>
      </a>
      <nav class="nav-links">
        <a href="/">Setup DNS</a>
        <a href="/leak" class="active">DNS Leak & Security</a>
        <a href="/sub">Sub Converter</a>
        <a href="https://complier.pwhs.app" target="_blank">Compiler</a>
        <a href="/api/dns-leak/docs">Open API</a>
        <a href="https://github.com/brianshea2/addr.tools" target="_blank" rel="noopener noreferrer">addr.tools ↗</a>
      </nav>
    </div>
  </header>

  <main class="main-wrapper">
    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-pill">Real-Time Deep Inspection</div>
      <h1>DNS Resolvers & Security Check</h1>
      <p>
        Inspect active DNS resolvers, dual-stack client IPs, EDNS Client Subnet (ECS) advertisement, and DNSSEC cryptographic signature validation.
      </p>
      <div>
        <div class="attribution-badge">
          <span>Powered by:</span>
          <a href="${POWERED_BY.url}" target="_blank" rel="noopener noreferrer">
            ${POWERED_BY.name}: ${POWERED_BY.description}
          </a>
        </div>
      </div>
    </section>

    <!-- Overall Verdict Banner -->
    <div id="verdictBox" class="verdict-box secure">
      <div id="verdictIcon" style="font-size: 22px;">🛡️</div>
      <div>
        <div id="verdictTitle" class="verdict-title">Running deep inspection...</div>
        <div id="verdictDesc" class="verdict-desc">Testing active DNS resolvers and cryptographic signature validation.</div>
      </div>
    </div>

    <!-- 1. Your IP addresses (show more) -->
    <div class="card">
      <div class="section-header">
        <span>Your IP addresses (<span id="btnShowMore" class="link-btn" onclick="askMicPermission()">show more</span>):</span>
        <button id="btnRetest" class="btn-test" onclick="restartTest()">Retest</button>
      </div>
      <div id="clientIpList">
        <div style="color:var(--text-secondary); font-size:13px;">detecting IP addresses...</div>
      </div>
    </div>

    <!-- 2. ECS Results (Hidden unless advertised) -->
    <div class="card" id="ecsCard" style="display:none; border-color:#fde68a; background:#fffbeb;">
      <div class="section-header" style="color:#b45309;">
        <span>⚠️ Your DNS resolvers advertise your IP subnet (<a href="https://en.wikipedia.org/wiki/EDNS_Client_Subnet" target="_blank" style="color:#b45309; text-decoration:underline;">ECS</a>):</span>
      </div>
      <div id="ecsList"></div>
    </div>

    <!-- 3. Your DNS resolvers -->
    <div class="card">
      <div class="section-header">
        <span>Your DNS resolvers:</span>
        <span id="resolverCountTag" style="font-size:12px; color:var(--text-secondary); font-weight:500;">detecting...</span>
      </div>
      <div id="resolverList">
        <div style="color:var(--text-secondary); font-size:13px;">detecting DNS resolvers...</div>
      </div>
    </div>

    <!-- 4. Your DNS security (DNSSEC) -->
    <div class="card">
      <div class="section-header">
        <span>Your DNS security (<a href="https://en.wikipedia.org/wiki/Domain_Name_System_Security_Extensions" target="_blank">DNSSEC</a>):</span>
        <span id="dnssecSummaryBadge" class="status-tag dim">pending...</span>
      </div>

      <div class="dnssec-table-wrapper">
        <table class="dnssec-table">
          <thead>
            <tr>
              <th>Signature</th>
              <th>ECDSA P-256</th>
              <th>ECDSA P-384</th>
              <th>Ed25519</th>
              <th>MLDSA44</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Invalid</td>
              <td id="cell-0" class="pending">...</td>
              <td id="cell-1" class="pending">...</td>
              <td id="cell-2" class="pending">...</td>
              <td id="cell-3" class="pending">...</td>
            </tr>
            <tr>
              <td>Expired</td>
              <td id="cell-4" class="pending">...</td>
              <td id="cell-5" class="pending">...</td>
              <td id="cell-6" class="pending">...</td>
              <td id="cell-7" class="pending">...</td>
            </tr>
            <tr>
              <td>Missing</td>
              <td id="cell-8" class="pending">...</td>
              <td id="cell-9" class="pending">...</td>
              <td id="cell-10" class="pending">...</td>
              <td id="cell-11" class="pending">...</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div id="mldsaNote" style="display:none; font-size:11.5px; color:var(--text-secondary); margin-top:10px;">
        *MLDSA44 is a new quantum-resistant signature algorithm (FIPS 204) not yet widely validated.
      </div>
    </div>

    <!-- Star Us on GitHub -->
    <div class="star-card">
      Like this tool? Star us on <a href="https://github.com/brianshea2/addr.tools" target="_blank" rel="noopener noreferrer">GitHub (brianshea2/addr.tools)</a>.
    </div>

    <!-- 5. Developer Guide & Open API for Android -->
    <div class="card" style="margin-top:24px;">
      <div class="tabs-header">
        <button class="tab-btn active" onclick="switchTab('androidTab', this)">Android Kotlin Client</button>
        <button class="tab-btn" onclick="switchTab('apiTab', this)">Open REST API</button>
        <button class="tab-btn" onclick="switchTab('specTab', this)">OpenAPI Spec</button>
      </div>

      <!-- Tab 1: Android Kotlin -->
      <div id="androidTab" class="tab-pane active">
        <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">
          Code snippet for <code>blockads-android</code> to test DNS leak and DNSSEC validation:
        </p>
        <pre class="code-block"><code>// 1. Fetch probe configuration
val init = httpClient.get("https://${host}/api/dns-leak/init").body&lt;DnsLeakInitResponse&gt;()

// 2. Resolve probe domains via Android device DNS
coroutineScope {
    init.probeDomains.forEach { domain -&gt;
        launch(Dispatchers.IO) {
            runCatching { java.net.InetAddress.getAllByName(domain) }
        }
    }
}

// 3. Connect to WebSocket watcher to receive resolvers in real time:
// val ws = okHttpClient.newWebSocket(Request.Builder().url(init.wsUrl).build(), listener)
// Or send discovered resolver IPs to: POST https://${host}/api/dns-leak/analyze</code></pre>
      </div>

      <!-- Tab 2: REST Endpoints -->
      <div id="apiTab" class="tab-pane">
        <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">
          All endpoints support CORS (<code>*</code>) for cross-platform usage:
        </p>
        <pre class="code-block"><code>GET  /api/dns-leak/init          # Session, probe domains, and DNSSEC suite
GET  /api/dns-leak/myip          # Client public IP, ASN & Location
GET  /api/dns-leak/enrich?ip=... # Geo, Org & Reverse DNS PTR/NS for any resolver
POST /api/dns-leak/analyze       # Evaluate resolver list for leaks & ECS exposure</code></pre>
      </div>

      <!-- Tab 3: OpenAPI -->
      <div id="specTab" class="tab-pane">
        <p style="font-size:13px; color:var(--text-secondary); margin-bottom:12px;">
          Interactive Swagger UI and raw OpenAPI 3.0 specification:
        </p>
        <div style="display:flex; gap:10px;">
          <a href="/api/dns-leak/openapi.json" target="_blank" class="btn-test" style="text-decoration:none;">Download openapi.json</a>
          <a href="/api/dns-leak/docs" target="_blank" class="btn-test" style="text-decoration:none; background:#2563eb;">Open Swagger Docs</a>
        </div>
      </div>
    </div>
  </main>

  <!-- Live Status Bar -->
  <div class="status-bar">
    <div class="status-tags">
      <span id="rtt-status" class="status-tag dim">rtt: --</span>
      <span id="ipv6-status" class="status-tag dim">IPv6</span>
      <span id="edns-status" class="status-tag dim">EDNS</span>
      <span id="dnssec-status" class="status-tag dim">DNSSEC</span>
      <span id="ech-status" class="status-tag dim">ECH</span>
    </div>
    <div>
      <span>dns: <strong id="queryCount" style="color:#00E676;">0</strong></span>
    </div>
  </div>

  <script>
    const clientId = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const clientIPs = new Map();
    const detectedResolvers = new Map();
    const clientSubnets = new Map();
    const ipDataCache = new Map();
    const dnssecTests = new Array(16);
    let totalDnsQueries = 0;
    let seenIPv6 = false;
    let udpSizes = [];
    let ws = null;
    let abortController = new AbortController();

    const clientAsn = ${client.asn};
    const clientOrg = "${client.asOrg.replace(/"/g, '\\"')}";

    function switchTab(tabId, el) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }

    // Helper to fetch IP metadata from addr.tools
    async function getIPData(ip) {
      if (ipDataCache.has(ip)) return ipDataCache.get(ip);
      try {
        const resp = await fetch('/api/dns-leak/enrich?ip=' + encodeURIComponent(ip));
        const data = await resp.json();
        ipDataCache.set(ip, data);
        return data;
      } catch (e) {
        return { ip, org: 'Unknown', ptr: null, ns: null, country: '' };
      }
    }

    // Render IP List grouped by Org
    function renderIPGroup(containerId, itemsMap) {
      const container = document.getElementById(containerId);
      if (itemsMap.size === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary); font-size:13px;">detecting...</div>';
        return;
      }

      // Group by Org
      const groups = {};
      itemsMap.forEach((val, key) => {
        const org = val.org || 'Unknown Provider';
        if (!groups[org]) groups[org] = [];
        groups[org].push(val);
      });

      let html = '';
      for (const [org, ips] of Object.entries(groups)) {
        html += '<div class="org-group">';
        html += '<div class="org-title">' + org + '</div>';
        for (const item of ips) {
          const isLeak = item.org && clientOrg && (
            item.org.toLowerCase().includes(clientOrg.toLowerCase()) ||
            clientOrg.toLowerCase().includes(item.org.toLowerCase())
          );

          let ptrOrNs = '';
          if (item.ptr) {
            ptrOrNs = '<span class="tag-ptr" title="Reverse DNS PTR">ptr: ' + item.ptr + '</span>';
          } else if (item.ns) {
            ptrOrNs = '<span class="tag-ns" title="Authoritative SOA Nameserver">ns: ' + item.ns + '</span>';
          }

          let geo = item.city ? item.city + ', ' + item.country : item.country || '';
          let leakBadge = isLeak && containerId === 'resolverList' ? '<span class="tag-leak">ISP LEAK</span>' : '';

          html += '<div class="ip-row">';
          html += '<span class="ip-address"><a href="https://info.addr.tools/' + item.ip + '" target="_blank">' + item.ip + '</a></span>';
          if (ptrOrNs) html += ptrOrNs;
          if (leakBadge) html += leakBadge;
          if (geo) html += '<span class="tag-geo">' + geo + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      container.innerHTML = html;
    }

    // Detect client IPv4 & IPv6 & WebRTC
    async function detectClientIPs() {
      const handleIP = async (ip) => {
        if (!ip || clientIPs.has(ip)) return;
        clientIPs.set(ip, { ip, org: 'Detecting...' });
        renderIPGroup('clientIpList', clientIPs);
        const data = await getIPData(ip);
        clientIPs.set(ip, { ...clientIPs.get(ip), ...data });
        renderIPGroup('clientIpList', clientIPs);
      };

      // 1. IPv4 from addr.tools
      fetch('https://myipv4.addr.tools/plain')
        .then(r => r.text())
        .then(t => handleIP(t.trim()))
        .catch(() => {});

      // 2. IPv6 from addr.tools
      fetch('https://myipv6.addr.tools/plain')
        .then(r => r.text())
        .then(t => handleIP(t.trim()))
        .catch(() => {});

      // 3. Fallback from Cloudflare request header
      handleIP('${client.ip}');

      // 4. WebRTC STUN candidate discovery
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:myip.addr.tools:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
          ],
        });
        pc.onicecandidate = (evt) => {
          if (!evt?.candidate?.candidate) return;
          const parts = evt.candidate.candidate.split(' ');
          const candIp = parts[4];
          if (candIp && !candIp.endsWith('.local') && !candIp.includes(':')) {
            handleIP(candIp);
          }
        };
        pc.createDataChannel('leak');
        pc.createOffer().then(o => pc.setLocalDescription(o));
      } catch (e) {}
    }

    // Query helper for DNS resolution
    async function makeQuery(fqdn, timeout = 8000) {
      if (abortController.signal.aborted) return { connected: false };
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);
      const start = Date.now();
      try {
        const resp = await fetch('https://' + fqdn + '/', { signal: controller.signal, mode: 'no-cors' });
        const rtt = Date.now() - start;
        clearTimeout(tid);
        return { connected: true, rtt };
      } catch (e) {
        clearTimeout(tid);
        return { connected: false };
      }
    }

    // Run DNSSEC validation test matrix
    async function testDNSSEC() {
      const algs = ['alg13', 'alg14', 'alg15', 'alg18'];
      let rttSum = 0;
      let rttCount = 0;

      for (let algIdx = 0; algIdx < algs.length; algIdx++) {
        const alg = algs[algIdx];
        const validFqdn = clientId + '.test-' + alg + '.dnscheck.tools';
        const { connected, rtt } = await makeQuery(validFqdn);
        dnssecTests[algIdx] = connected;
        if (rtt) { rttSum += rtt; rttCount++; }

        if (!connected) {
          // Valid signature failed to resolve -> mark column ERR
          for (let row = 0; row < 3; row++) {
            const cell = document.getElementById('cell-' + (row * 4 + algIdx));
            if (cell) {
              cell.className = 'err';
              cell.innerText = 'ERR';
            }
          }
          continue;
        }

        // Test invalid signatures (badsig, expiredsig, nosig)
        const sigOpts = ['badsig', 'expiredsig', 'nosig'];
        for (let sigIdx = 0; sigIdx < sigOpts.length; sigIdx++) {
          const sigOpt = sigOpts[sigIdx];
          const testFqdn = clientId + '-' + sigOpt + '.test-' + alg + '.dnscheck.tools';
          const res = await makeQuery(testFqdn, 12000);
          const cell = document.getElementById('cell-' + (sigIdx * 4 + algIdx));
          dnssecTests[4 + sigIdx * 4 + algIdx] = res.connected;

          if (cell) {
            // A secure validating resolver MUST FAIL the connection to pass DNSSEC
            if (!res.connected) {
              cell.className = 'pass';
              cell.innerText = 'PASS';
            } else if (alg === 'alg18') {
              cell.className = 'fail-star';
              cell.innerText = 'FAIL*';
              document.getElementById('mldsaNote').style.display = 'block';
            } else {
              cell.className = 'fail';
              cell.innerText = 'FAIL';
            }
          }
        }
      }

      // Update RTT status
      if (rttCount > 0) {
        const avgRtt = Math.round(rttSum / rttCount);
        document.getElementById('rtt-status').innerText = 'rtt: ~' + avgRtt + 'ms';
      }

      // Evaluate DNSSEC Summary
      const dnssecBadge = document.getElementById('dnssecSummaryBadge');
      const dnssecBar = document.getElementById('dnssec-status');
      const hasFails = [0,1,2, 4,5,6, 8,9,10].some(i => dnssecTests[4 + i] === true);

      if (hasFails) {
        dnssecBadge.className = 'status-tag red';
        dnssecBadge.innerText = 'NOT AUTHENTICATED';
        dnssecBar.className = 'status-tag red';
      } else {
        dnssecBadge.className = 'status-tag green';
        dnssecBadge.innerText = 'AUTHENTICATED';
        dnssecBar.className = 'status-tag green';
      }
    }

    // Connect WebSocket & stream DNS queries
    function startWatcher() {
      ws = new WebSocket('wss://ws.dnscheck.tools/watch/' + clientId, 'full');

      ws.onopen = async () => {
        // Send 4 probe queries
        for (let i = 0; i < 4; i++) {
          const fqdn = String.fromCharCode(97 + i) + '.' + clientId + '-nullip.test.dnscheck.tools';
          makeQuery(fqdn, 6000).catch(() => {});
        }

        // Test IPv6 resolver reachability
        makeQuery(clientId + '-nullip.test-ipv6.dnscheck.tools', 6000).then(({ connected }) => {
          const ipv6Tag = document.getElementById('ipv6-status');
          if (connected || seenIPv6) {
            ipv6Tag.className = 'status-tag green';
          } else {
            ipv6Tag.className = 'status-tag red';
          }
        });

        // Run full DNSSEC validation suite
        testDNSSEC();
      };

      ws.onmessage = async ({ data }) => {
        try {
          const req = JSON.parse(data);
          totalDnsQueries++;
          document.getElementById('queryCount').innerText = totalDnsQueries;

          if (req.remoteIp?.includes(':')) {
            seenIPv6 = true;
            document.getElementById('ipv6-status').className = 'status-tag green';
          }

          // EDNS UDP size
          if (req.isEdns0 && !udpSizes.includes(req.udpSize)) {
            udpSizes.push(req.udpSize);
            const ednsTag = document.getElementById('edns-status');
            ednsTag.className = 'status-tag green';
            ednsTag.innerText = 'EDNS (' + udpSizes.join('/') + ')';
          }

          // ECS Check
          if (req.clientSubnet && !req.clientSubnet.endsWith('/0') && !clientSubnets.has(req.clientSubnet)) {
            clientSubnets.set(req.clientSubnet, { ip: req.clientSubnet, org: 'Advertised Client Subnet' });
            document.getElementById('ecsCard').style.display = 'block';
            renderIPGroup('ecsList', clientSubnets);
            getIPData(req.clientSubnet).then(d => {
              clientSubnets.set(req.clientSubnet, { ...clientSubnets.get(req.clientSubnet), ...d });
              renderIPGroup('ecsList', clientSubnets);
            });
          }

          // Resolver tracking
          if (!detectedResolvers.has(req.remoteIp)) {
            detectedResolvers.set(req.remoteIp, {
              ip: req.remoteIp,
              org: 'Resolving Provider...',
              proto: req.proto,
              clientSubnet: req.clientSubnet || null,
            });
            document.getElementById('resolverCountTag').innerText = detectedResolvers.size + ' Resolvers Detected';
            renderIPGroup('resolverList', detectedResolvers);

            const ipInfo = await getIPData(req.remoteIp);
            detectedResolvers.set(req.remoteIp, {
              ...detectedResolvers.get(req.remoteIp),
              ...ipInfo,
            });
            renderIPGroup('resolverList', detectedResolvers);
            updateVerdict();
          }
        } catch (e) {
          console.error(e);
        }
      };

      setTimeout(() => updateVerdict(), 7000);
    }

    function updateVerdict() {
      const verdictBox = document.getElementById('verdictBox');
      const verdictIcon = document.getElementById('verdictIcon');
      const verdictTitle = document.getElementById('verdictTitle');
      const verdictDesc = document.getElementById('verdictDesc');

      let hasIspLeak = false;
      let hasEcsLeak = clientSubnets.size > 0;

      detectedResolvers.forEach(r => {
        if (r.org && clientOrg && (
          r.org.toLowerCase().includes(clientOrg.toLowerCase()) ||
          clientOrg.toLowerCase().includes(r.org.toLowerCase())
        )) {
          hasIspLeak = true;
        }
      });

      if (hasIspLeak) {
        verdictBox.className = 'verdict-box leak';
        verdictIcon.innerText = '⚠️';
        verdictTitle.innerText = 'DNS Leak Detected!';
        verdictDesc.innerText = 'DNS queries reached your local ISP (' + clientOrg + '). Encrypted DNS tunnel is leaking.';
      } else if (hasEcsLeak) {
        verdictBox.className = 'verdict-box ecs';
        verdictIcon.innerText = '⚠️';
        verdictTitle.innerText = 'EDNS Client Subnet (ECS) Exposure';
        verdictDesc.innerText = 'Queries are routed through external resolvers, but your real IP subnet is being advertised.';
      } else {
        verdictBox.className = 'verdict-box secure';
        verdictIcon.innerText = '🛡️';
        verdictTitle.innerText = 'No DNS Leak Detected (Protected)';
        verdictDesc.innerText = 'All detected resolvers belong to secure public/private DNS providers. No queries reached your local ISP.';
      }
    }

    function restartTest() {
      location.reload();
    }

    function askMicPermission() {
      const msg = 'Granting microphone permission allows WebRTC to discover additional local and VPN interface IP addresses (RFC 8828).\\n\\nNo audio will ever be recorded or transmitted.';
      if (confirm(msg)) {
        navigator.mediaDevices?.getUserMedia({ audio: true })
          .then(stream => {
            setTimeout(() => stream.getTracks().forEach(t => t.stop()), 1000);
            detectClientIPs();
          })
          .catch(() => {});
      }
    }

    // Auto-start on load
    detectClientIPs();
    startWatcher();
  </script>
</body>
</html>`;
}
