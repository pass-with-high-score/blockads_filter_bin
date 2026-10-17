/**
 * Web UI for BlockAds DNS Leak Test
 * Powered by: brianshea2/addr.tools (https://github.com/brianshea2/addr.tools)
 */

import { ClientNetworkInfo, POWERED_BY } from "./leak";

export function renderLeakHtml(host: string, client: ClientNetworkInfo): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DNS Leak Test - BlockAds</title>
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
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-primary);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(0, 230, 118, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(99, 102, 241, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 80%, rgba(236, 72, 153, 0.04) 0%, transparent 50%);
    }

    /* Navbar */
    .navbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 50;
      backdrop-filter: blur(16px);
      background: rgba(255, 255, 255, 0.85);
      border-bottom: 1px solid var(--border);
    }
    .nav-container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 20px;
      height: 64px;
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
    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
    }
    .brand span { color: var(--accent); }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 14px;
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
      max-width: 920px;
      margin: 0 auto;
      padding: 100px 20px 80px;
    }

    /* Hero */
    .hero {
      text-align: center;
      position: relative;
      margin-bottom: 36px;
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
      margin-bottom: 14px;
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
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 10px;
      line-height: 1.2;
    }
    .hero p {
      color: var(--text-secondary);
      font-size: 15px;
      max-width: 620px;
      margin: 0 auto;
    }

    /* Attribution Banner */
    .attribution-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 6px 14px;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 20px;
      font-size: 12px;
      color: var(--text-secondary);
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
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
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    /* Client info grid */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }
    .info-item {
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 12px;
      padding: 12px 14px;
    }
    .info-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .info-val {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      word-break: break-all;
    }

    /* Action bar */
    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .btn-test {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #111827;
      color: #ffffff;
      border: none;
      padding: 10px 22px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-test:hover { background: #000000; transform: translateY(-1px); }
    .btn-test:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Verdict Banner */
    .verdict-box {
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 20px;
      display: none;
      align-items: flex-start;
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
    .verdict-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .verdict-desc {
      font-size: 13px;
      line-height: 1.45;
    }

    /* Resolvers Table */
    .table-container {
      overflow-x: auto;
      margin-top: 12px;
    }
    table.resolvers-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    table.resolvers-table th {
      background: #f8fafc;
      padding: 10px 14px;
      font-weight: 600;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    table.resolvers-table td {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      font-family: 'Inter', sans-serif;
    }
    .badge-safe { background: #dcfce7; color: #166534; }
    .badge-leak { background: #fee2e2; color: #991b1b; }
    .badge-warn { background: #fef3c7; color: #92400e; }

    /* Query Log Console */
    .console-box {
      background: #0f172a;
      color: #94a3b8;
      border-radius: 12px;
      padding: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      max-height: 180px;
      overflow-y: auto;
      margin-top: 16px;
      display: none;
      line-height: 1.6;
    }
    .console-entry { display: block; margin-bottom: 4px; }
    .console-entry .highlight { color: #38bdf8; }
    .console-entry .green { color: #4ade80; }
    .console-entry .amber { color: #fbbf24; }

    /* Tabs */
    .tabs-header {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 10px 16px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-secondary);
      cursor: pointer;
      position: relative;
    }
    .tab-btn.active {
      color: #000000;
    }
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

    /* Code block */
    pre.code-block {
      background: #0f172a;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      overflow-x: auto;
      line-height: 1.5;
    }

    /* Footer */
    .footer {
      border-top: 1px solid var(--border);
      padding: 32px 20px;
      margin-top: 40px;
      text-align: center;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .footer a {
      color: #2563eb;
      text-decoration: none;
    }
    .footer a:hover { text-decoration: underline; }
    .footer-power {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      margin-top: 8px;
      background: #ffffff;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
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
        <a href="/leak" class="active">DNS Leak Test</a>
        <a href="https://complier.pwhs.app" target="_blank">Compiler</a>
        <a href="/api/dns-leak/docs">Open API</a>
        <a href="https://github.com/brianshea2/addr.tools" target="_blank" rel="noopener noreferrer">addr.tools ↗</a>
      </nav>
    </div>
  </header>

  <main class="main-wrapper">
    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-pill">Real-Time Edge Inspector</div>
      <h1>DNS Leak & Privacy Check</h1>
      <p>
        Check if your DNS requests are leaking to unencrypted ISP resolvers or exposing your private IP subnet via EDNS Client Subnet (ECS).
      </p>
      <div>
        <div class="attribution-badge">
          <span>Powered by:</span>
          <a href="${POWERED_BY.url}" target="_blank" rel="noopener noreferrer">
            ${POWERED_BY.name} (${POWERED_BY.description})
          </a>
        </div>
      </div>
    </section>

    <!-- Main Leak Check Card -->
    <div class="card">
      <div class="card-title">
        <span>Your Public Network Identity</span>
        <span style="font-size: 12px; font-weight: 500; color: var(--text-secondary);">Direct HTTP Connection</span>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Public IP Address</div>
          <div class="info-val" id="clientIp">${client.ip}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Country / Region</div>
          <div class="info-val">${client.city ? client.city + ", " : ""}${client.country}</div>
        </div>
        <div class="info-item">
          <div class="info-label">ISP / ASN</div>
          <div class="info-val">AS${client.asn} (${client.asOrg})</div>
        </div>
        <div class="info-item">
          <div class="info-label">Cloudflare Edge Colo</div>
          <div class="info-val">${client.colo}</div>
        </div>
      </div>

      <div class="action-row">
        <div style="font-size: 13px; color: var(--text-secondary);">
          Status: <strong id="testStatusText" style="color: var(--text-primary);">Ready</strong>
        </div>
        <button id="btnRunTest" class="btn-test" onclick="startLeakCheck()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
          Run DNS Leak Test
        </button>
      </div>

      <!-- Live Terminal output -->
      <div id="consoleBox" class="console-box"></div>
    </div>

    <!-- Results Section -->
    <div class="card">
      <div class="card-title">
        <span>Detected DNS Resolvers</span>
        <span id="resolverCountBadge" class="badge-status badge-safe" style="display:none;">0 Resolvers Found</span>
      </div>

      <!-- Verdict Banner -->
      <div id="verdictBox" class="verdict-box">
        <div id="verdictIcon" style="font-size: 24px;">🛡️</div>
        <div>
          <div id="verdictTitle" class="verdict-title">No DNS Leak Detected</div>
          <div id="verdictDesc" class="verdict-desc">All DNS queries were resolved securely without exposing your local ISP.</div>
        </div>
      </div>

      <div id="emptyResolverMsg" style="text-align: center; padding: 24px; color: var(--text-secondary); font-size: 14px;">
        Click <strong>"Run DNS Leak Test"</strong> above to send probes and detect your active DNS resolvers.
      </div>

      <div class="table-container" id="resolverTableContainer" style="display:none;">
        <table class="resolvers-table">
          <thead>
            <tr>
              <th>Resolver IP</th>
              <th>Reverse DNS (PTR)</th>
              <th>Provider / Org</th>
              <th>Country</th>
              <th>ECS Privacy</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody id="resolverTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- Developer & Mobile App Section -->
    <div class="card">
      <div class="tabs-header">
        <button class="tab-btn active" onclick="switchTab('androidTab', this)">Android Kotlin Client</button>
        <button class="tab-btn" onclick="switchTab('apiTab', this)">Open REST API</button>
        <button class="tab-btn" onclick="switchTab('specTab', this)">OpenAPI Spec</button>
      </div>

      <!-- Tab 1: Android Kotlin -->
      <div id="androidTab" class="tab-pane active">
        <p style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 12px;">
          To integrate DNS leak detection into <code>blockads-android</code>, call our Open API to get probe domains, resolve them using Android standard DNS lookup, and stream or evaluate results:
        </p>
        <pre class="code-block"><code>// Step 1: Call https://${host}/api/dns-leak/init
val response = httpClient.get("https://${host}/api/dns-leak/init").body&lt;DnsLeakInitResponse&gt;()

// Step 2: Resolve probe domains using standard Android DNS resolver
// This forces Android's active DNS provider (VPN / Private DNS / Wi-Fi) to query the authoritative nameserver
coroutineScope {
    response.probeDomains.forEach { domain -&gt;
        launch(Dispatchers.IO) {
            runCatching { java.net.InetAddress.getAllByName(domain) }
        }
    }
}

// Step 3: Listen for incoming resolvers via WebSocket or query the result:
// wssUrl: \${response.wsUrl} (from addr.tools)
// Or send detected resolver IPs to: POST https://${host}/api/dns-leak/analyze</code></pre>
      </div>

      <!-- Tab 2: REST API Endpoints -->
      <div id="apiTab" class="tab-pane">
        <table class="resolvers-table" style="font-family: inherit;">
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>GET</code></td>
              <td><code>/api/dns-leak/init</code></td>
              <td>Initialize leak test session, get probe subdomains & client network identity</td>
            </tr>
            <tr>
              <td><code>GET</code></td>
              <td><code>/api/dns-leak/myip</code></td>
              <td>Returns client IP, ASN, ISP Org, Country, City and Cloudflare Colo</td>
            </tr>
            <tr>
              <td><code>GET</code></td>
              <td><code>/api/dns-leak/enrich?ip=1.1.1.1</code></td>
              <td>Lookup Geo, Org, and Reverse DNS (PTR) for any resolver IP via addr.tools</td>
            </tr>
            <tr>
              <td><code>POST</code></td>
              <td><code>/api/dns-leak/analyze</code></td>
              <td>Submit resolver list to evaluate ISP leaks and EDNS Client Subnet exposure</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Tab 3: OpenAPI Spec -->
      <div id="specTab" class="tab-pane">
        <p style="font-size: 13.5px; color: var(--text-secondary); margin-bottom: 12px;">
          You can import this OpenAPI specification directly into Swagger, Postman, or Android Studio:
        </p>
        <div style="display: flex; gap: 10px;">
          <a href="/api/dns-leak/openapi.json" target="_blank" class="btn-test" style="text-decoration:none; display:inline-flex;">
            Download openapi.json
          </a>
          <a href="/api/dns-leak/docs" target="_blank" class="btn-test" style="text-decoration:none; display:inline-flex; background:#2563eb;">
            View Interactive Docs
          </a>
        </div>
      </div>
    </div>
  </main>

  <!-- Footer with Attribution -->
  <footer class="footer">
    <div>
      <strong>BlockAds DNS Ecosystem</strong> &bull; Serverless Privacy & Security on Cloudflare Edge
    </div>
    <div style="margin-top: 8px;">
      <div class="footer-power">
        <span>Powered by:</span>
        <a href="${POWERED_BY.url}" target="_blank" rel="noopener noreferrer">
          ${POWERED_BY.name}
        </a>
        <span style="color:#94a3b8;">&bull;</span>
        <span style="font-weight:400;">${POWERED_BY.description}</span>
      </div>
    </div>
  </footer>

  <script>
    let activeSession = null;
    let ws = null;
    const detectedResolvers = new Map();
    const clientAsn = ${client.asn};
    const clientOrg = "${client.asOrg.replace(/"/g, '\\"')}";

    function logConsole(msg, cls = "") {
      const box = document.getElementById('consoleBox');
      box.style.display = 'block';
      const entry = document.createElement('span');
      entry.className = 'console-entry ' + cls;
      entry.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      box.appendChild(entry);
      box.scrollTop = box.scrollHeight;
    }

    function switchTab(tabId, el) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }

    async function startLeakCheck() {
      const btn = document.getElementById('btnRunTest');
      const statusText = document.getElementById('testStatusText');
      const consoleBox = document.getElementById('consoleBox');
      const emptyMsg = document.getElementById('emptyResolverMsg');
      const tableContainer = document.getElementById('resolverTableContainer');
      const tbody = document.getElementById('resolverTableBody');
      const verdictBox = document.getElementById('verdictBox');

      btn.disabled = true;
      btn.innerHTML = 'Probing DNS Resolvers...';
      statusText.innerHTML = '<span style="color:#2563eb;">Initializing test session...</span>';
      consoleBox.innerHTML = '';
      tbody.innerHTML = '';
      verdictBox.style.display = 'none';
      detectedResolvers.clear();

      try {
        logConsole('Initiating test session via /api/dns-leak/init...', 'highlight');
        const initResp = await fetch('/api/dns-leak/init');
        const initData = await initResp.json();
        activeSession = initData;

        logConsole('Session generated: &lt;code&gt;' + initData.sessionId + '&lt;/code&gt;', 'green');
        logConsole('Connecting to real-time watcher at: ' + initData.wsUrl + '...', 'highlight');

        // Connect WebSocket to addr.tools
        ws = new WebSocket(initData.wsUrl, 'full');

        ws.onopen = async () => {
          logConsole('Watcher connected! Firing DNS resolution probes...', 'green');
          statusText.innerHTML = '<span style="color:#059669;">Sending DNS probes...</span>';

          // Trigger browser DNS resolution probes
          for (let i = 0; i < initData.probeDomains.length; i++) {
            const domain = initData.probeDomains[i];
            logConsole('Resolving probe: ' + domain);
            fetch('https://' + domain + '/', { mode: 'no-cors' }).catch(() => {});
          }
        };

        ws.onmessage = async (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            logConsole('Received query from resolver: ' + msg.remoteIp + ' (' + msg.proto + ')', 'green');
            await handleDetectedResolver(msg);
          } catch (e) {
            console.error(e);
          }
        };

        ws.onerror = (err) => {
          logConsole('Watcher notice: WebSocket stream ended or completed.', 'amber');
        };

        // Finish test after 6 seconds of collecting
        setTimeout(() => {
          finishTest();
        }, 6000);

      } catch (err) {
        logConsole('Error starting leak check: ' + err.message, 'amber');
        btn.disabled = false;
        btn.innerHTML = 'Run DNS Leak Test';
        statusText.innerText = 'Error occurred';
      }
    }

    async function handleDetectedResolver(msg) {
      const ip = msg.remoteIp;
      if (detectedResolvers.has(ip)) return;

      detectedResolvers.set(ip, {
        ip,
        proto: msg.proto,
        clientSubnet: msg.clientSubnet || null,
        loading: true,
      });

      document.getElementById('emptyResolverMsg').style.display = 'none';
      document.getElementById('resolverTableContainer').style.display = 'block';

      // Update UI row
      renderResolversTable();

      // Enrich IP details via our API (powered by addr.tools)
      try {
        const enrichResp = await fetch('/api/dns-leak/enrich?ip=' + encodeURIComponent(ip));
        const enriched = await enrichResp.json();
        detectedResolvers.set(ip, {
          ...detectedResolvers.get(ip),
          ...enriched,
          loading: false,
        });
      } catch (e) {
        detectedResolvers.set(ip, {
          ...detectedResolvers.get(ip),
          org: 'Unknown',
          loading: false,
        });
      }

      renderResolversTable();
    }

    function renderResolversTable() {
      const tbody = document.getElementById('resolverTableBody');
      const countBadge = document.getElementById('resolverCountBadge');
      tbody.innerHTML = '';

      countBadge.style.display = 'inline-flex';
      countBadge.innerText = detectedResolvers.size + ' Resolvers Detected';

      detectedResolvers.forEach((r) => {
        const tr = document.createElement('tr');
        const isSameAsClient = r.org && clientOrg && (
          r.org.toLowerCase().includes(clientOrg.toLowerCase()) ||
          clientOrg.toLowerCase().includes(r.org.toLowerCase())
        );

        let verdictBadge = '<span class="badge-status badge-safe">SECURE</span>';
        if (isSameAsClient) {
          verdictBadge = '<span class="badge-status badge-leak">ISP LEAK</span>';
        }

        let ecsBadge = '<span class="badge-status badge-safe">STRIPPED (SAFE)</span>';
        if (r.clientSubnet && !r.clientSubnet.endsWith('/0')) {
          ecsBadge = '<span class="badge-status badge-warn">SUBNET LEAKED</span>';
        }

        tr.innerHTML = 
          '<td><strong>' + r.ip + '</strong></td>' +
          '<td style="color:var(--text-secondary);">' + (r.ptr || '<i>None</i>') + '</td>' +
          '<td>' + (r.loading ? '<i>Loading...</i>' : (r.org || 'Unknown')) + '</td>' +
          '<td>' + (r.country || '-') + '</td>' +
          '<td>' + ecsBadge + '</td>' +
          '<td>' + verdictBadge + '</td>';

        tbody.appendChild(tr);
      });
    }

    function finishTest() {
      const btn = document.getElementById('btnRunTest');
      const statusText = document.getElementById('testStatusText');
      const verdictBox = document.getElementById('verdictBox');
      const verdictTitle = document.getElementById('verdictTitle');
      const verdictDesc = document.getElementById('verdictDesc');
      const verdictIcon = document.getElementById('verdictIcon');

      btn.disabled = false;
      btn.innerHTML = 'Run DNS Leak Test Again';
      statusText.innerHTML = '<span style="color:#166534; font-weight:600;">✓ Completed</span>';

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      let hasIspLeak = false;
      let hasEcsLeak = false;

      detectedResolvers.forEach((r) => {
        if (r.org && clientOrg && (
          r.org.toLowerCase().includes(clientOrg.toLowerCase()) ||
          clientOrg.toLowerCase().includes(r.org.toLowerCase())
        )) {
          hasIspLeak = true;
        }
        if (r.clientSubnet && !r.clientSubnet.endsWith('/0')) {
          hasEcsLeak = true;
        }
      });

      verdictBox.style.display = 'flex';
      verdictBox.className = 'verdict-box';

      if (hasIspLeak) {
        verdictBox.classList.add('leak');
        verdictIcon.innerText = '⚠️';
        verdictTitle.innerText = 'DNS Leak Detected!';
        verdictDesc.innerText = 'One or more DNS queries reached your local ISP (' + clientOrg + '). Your DNS traffic is not fully contained in your secure Private DNS/VPN tunnel.';
      } else if (hasEcsLeak) {
        verdictBox.classList.add('ecs');
        verdictIcon.innerText = '⚠️';
        verdictTitle.innerText = 'EDNS Client Subnet (ECS) Leaked';
        verdictDesc.innerText = 'Your queries are using external resolvers, but your IP subnet was advertised to authoritative nameservers.';
      } else {
        verdictBox.classList.add('secure');
        verdictIcon.innerText = '🛡️';
        verdictTitle.innerText = 'No DNS Leak Detected (Protected)';
        verdictDesc.innerText = 'All detected resolvers belong to secure public/private DNS providers. No queries reached your local ISP, and ECS IP subnet was stripped.';
      }

      logConsole('Test completed. Verdict: ' + verdictTitle.innerText, hasIspLeak ? 'amber' : 'green');
    }
  </script>
</body>
</html>`;
}
