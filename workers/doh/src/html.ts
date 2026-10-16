/**
 * BlockAds Private DNS Serverless Setup Dashboard
 * Styled with the exact modern aesthetic of complier.pwhs.app
 */

export function renderDashboardHtml(host: string, upstream: string, ruleCount: number): string {
  const dohUrl = `https://${host}/dns-query`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Private DNS - BlockAds</title>
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
      gap: 24px;
      font-size: 14px;
      color: var(--text-secondary);
    }
    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--text-primary); }

    /* Page Layout */
    .main-wrapper {
      max-width: 920px;
      margin: 0 auto;
      padding: 120px 20px 80px;
    }

    /* Header Section */
    .hero {
      text-align: center;
      position: relative;
      margin-bottom: 48px;
    }
    .glow-blur {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 160px;
      height: 160px;
      background: rgba(0, 230, 118, 0.2);
      filter: blur(80px);
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
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
      margin-bottom: 16px;
      position: relative;
      z-index: 1;
    }
    .hero-pill::before {
      content: '';
      width: 7px;
      height: 7px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--accent);
    }
    h1 {
      font-size: 2.75rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      color: var(--text-primary);
      margin-bottom: 14px;
      position: relative;
      z-index: 1;
    }
    h1 span { color: var(--accent); }
    .subtitle {
      font-size: 1.1rem;
      color: var(--text-secondary);
      max-width: 640px;
      margin: 0 auto;
      line-height: 1.6;
      position: relative;
      z-index: 1;
    }

    /* Cards */
    .card {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(229, 231, 235, 0.8);
      border-radius: 28px;
      padding: 32px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04);
      margin-bottom: 32px;
    }
    .card-header { margin-bottom: 24px; }
    .card-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .card-desc {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    /* URL Box */
    .url-box {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }
    @media (min-width: 640px) {
      .url-box { flex-direction: row; }
    }
    .url-input {
      flex: 1;
      padding: 14px 18px;
      background: #f9fafb;
      border: 1px solid var(--border);
      border-radius: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: var(--text-primary);
      outline: none;
      transition: all 0.2s;
    }
    .url-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(0, 230, 118, 0.2);
    }
    .btn-primary {
      padding: 14px 24px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 16px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
      white-space: nowrap;
      box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    .btn-primary:hover {
      background: var(--accent-dim);
      transform: scale(1.01);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .stat-card {
      padding: 16px 20px;
      background: rgba(249, 250, 251, 0.8);
      border: 1px solid rgba(229, 231, 235, 0.6);
      border-radius: 18px;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      font-weight: 700;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--text-primary);
    }
    .stat-sub {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    /* Setup Steps */
    .setup-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .step-item {
      display: flex;
      gap: 16px;
      padding: 20px;
      background: #f9fafb;
      border: 1px solid rgba(229, 231, 235, 0.7);
      border-radius: 20px;
      transition: border-color 0.15s;
    }
    .step-item:hover {
      border-color: rgba(0, 230, 118, 0.5);
    }
    .step-badge {
      width: 32px;
      height: 32px;
      background: rgba(0, 230, 118, 0.15);
      color: #00a846;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      flex-shrink: 0;
    }
    .step-info { flex: 1; }
    .step-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .step-body {
      font-size: 13.5px;
      color: var(--text-secondary);
      line-height: 1.6;
    }
    .code-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      background: #eef2f6;
      color: #0969da;
      padding: 3px 8px;
      border-radius: 8px;
      font-weight: 600;
      border: 1px solid rgba(0, 0, 0, 0.05);
      cursor: pointer;
      user-select: all;
    }

    /* Live Test Box */
    .test-box {
      margin-top: 16px;
      padding: 20px;
      background: #f9fafb;
      border: 1px solid var(--border);
      border-radius: 20px;
    }
    .test-input-row {
      display: flex;
      gap: 10px;
      margin-top: 12px;
    }
    .test-res {
      margin-top: 14px;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13px;
      display: none;
    }

    /* Footer */
    .footer {
      border-top: 1px solid var(--border);
      padding: 48px 20px;
      margin-top: 40px;
      background: rgba(255, 255, 255, 0.5);
    }
    .footer-container {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 32px;
    }
    @media (min-width: 640px) {
      .footer-container { grid-template-columns: 2fr 1fr; }
    }
    .footer-desc {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.6;
      margin-top: 8px;
    }
    .footer-links {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 14px;
    }
    .footer-links a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.15s;
    }
    .footer-links a:hover { color: var(--text-primary); }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #12121a;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      padding: 12px 20px;
      border-radius: 14px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
      display: none;
      z-index: 100;
      align-items: center;
      gap: 8px;
    }
    .toast.show {
      display: flex;
      animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes popIn {
      from { transform: translateY(12px) scale(0.95); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
  </style>
</head>
<body>
  <!-- Navbar -->
  <nav class="navbar">
    <div class="nav-container">
      <a href="https://complier.pwhs.app" class="brand">
        <img src="https://complier.pwhs.app/icon.svg" alt="BlockAds" class="brand-logo" onerror="this.style.display='none'">
        <span>Block<span style="color:#00E676">Ads</span></span>
      </a>
      <div class="nav-links">
        <a href="https://complier.pwhs.app">Compiler & Merger</a>
        <a href="https://t.me/blockads_android" target="_blank" rel="noopener noreferrer">Telegram</a>
        <a href="https://www.reddit.com/r/BlockAds/" target="_blank" rel="noopener noreferrer">Reddit</a>
      </div>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="main-wrapper">
    <!-- Hero Header -->
    <div class="hero">
      <div class="glow-blur"></div>
      <div class="hero-pill">Cloudflare Serverless • Edge Powered</div>
      <h1>Private <span style="color:#00E676">DNS (DoH)</span></h1>
      <p class="subtitle">
        Zero-setup, serverless DNS-over-HTTPS engine with real-time edge adblocking. Intercepts ads, telemetry, and trackers globally before they load on your device.
      </p>
    </div>

    <!-- Endpoint Card -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Your DoH Endpoint</h2>
        <p class="card-desc">
          Universal DNS-over-HTTPS URL. Paste into Android Private DNS, browser settings, or router configurations.
        </p>
      </div>

      <div class="url-box">
        <input type="text" id="dohInput" class="url-input" value="${dohUrl}" readonly>
        <button type="button" class="btn-primary" onclick="copyDoh()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          Copy Endpoint
        </button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Active Rules</div>
          <div class="stat-value" style="color: #00a846;">${ruleCount.toLocaleString()}</div>
          <div class="stat-sub">Real-time sinkhole entries</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Response Time</div>
          <div class="stat-value">&lt; 5 ms</div>
          <div class="stat-sub">300+ Edge Data Centers</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Upstream Resolver</div>
          <div class="stat-value" style="font-size: 1rem; font-family: monospace;">1.1.1.1</div>
          <div class="stat-sub">Cloudflare Private DNS</div>
        </div>
      </div>
    </section>

    <!-- Setup Guide Card -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Setup Instructions</h2>
        <p class="card-desc">
          Configure BlockAds Private DNS on your mobile phone, computer, or browser in less than a minute.
        </p>
      </div>

      <div class="setup-list">
        <div class="step-item">
          <div class="step-badge">1</div>
          <div class="step-info">
            <div class="step-title">
              <span>Android (Private DNS)</span>
              <span class="code-pill" onclick="copyText('${host}')">${host}</span>
            </div>
            <div class="step-body">
              Open <strong>Settings</strong> &rarr; <strong>Network & internet</strong> &rarr; <strong>Private DNS</strong>.<br>
              Select <strong>Private DNS provider hostname</strong> and enter <code class="code-pill" onclick="copyText('${host}')">${host}</code>.
            </div>
          </div>
        </div>

        <div class="step-item">
          <div class="step-badge">2</div>
          <div class="step-info">
            <div class="step-title">
              <span>Chrome / Brave / Edge (Browser DoH)</span>
            </div>
            <div class="step-body">
              Go to <strong>Settings</strong> &rarr; <strong>Privacy and security</strong> &rarr; <strong>Security</strong> &rarr; <strong>Use secure DNS</strong>.<br>
              Choose <strong>Custom</strong> and paste: <code class="code-pill" onclick="copyText('${dohUrl}')">${dohUrl}</code>.
            </div>
          </div>
        </div>

        <div class="step-item">
          <div class="step-badge">3</div>
          <div class="step-info">
            <div class="step-title">
              <span>Mozilla Firefox</span>
            </div>
            <div class="step-body">
              Go to <strong>Settings</strong> &rarr; <strong>Privacy & Security</strong> &rarr; <strong>DNS over HTTPS</strong>.<br>
              Select <strong>Max Protection</strong>, click <strong>Custom</strong>, and paste: <code class="code-pill" onclick="copyText('${dohUrl}')">${dohUrl}</code>.
            </div>
          </div>
        </div>

        <div class="step-item">
          <div class="step-badge">4</div>
          <div class="step-info">
            <div class="step-title">
              <span>iOS & macOS / Routers (AdGuard Home, Pi-hole)</span>
            </div>
            <div class="step-body">
              Add <code class="code-pill" onclick="copyText('${dohUrl}')">${dohUrl}</code> into your AdGuard Home, Pi-hole, or OpenWrt upstream DNS list.
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Live Test Sandbox Card -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Live DNS Test Sandbox</h2>
        <p class="card-desc">
          Test domain resolution directly against the live BlockAds edge engine to verify blocking status.
        </p>
      </div>

      <div class="test-box">
        <label style="font-size: 13px; font-weight: 600; color: var(--text-secondary);">Test a domain:</label>
        <div class="test-input-row">
          <input type="text" id="testDomainInput" class="url-input" placeholder="e.g. doubleclick.net or google.com" value="doubleclick.net">
          <button type="button" class="btn-primary" onclick="runDnsTest()">Check Resolution</button>
        </div>
        <div id="testResult" class="test-res"></div>
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer-container">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700;">
          <img src="https://complier.pwhs.app/icon.svg" alt="BlockAds" style="width:24px; height:24px; border-radius:6px;" onerror="this.style.display='none'">
          <span>Block<span style="color:#00E676">Ads</span></span>
        </div>
        <p class="footer-desc">
          Free, open-source ad blocking ecosystem for Android & Serverless Edge.<br>
          No root. No data collection. No tracking.
        </p>
      </div>
      <div>
        <h4 style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px;">Links</h4>
        <div class="footer-links">
          <a href="https://complier.pwhs.app">Filter Compiler</a>
          <a href="https://t.me/blockads_android" target="_blank" rel="noopener noreferrer">Telegram Community</a>
          <a href="https://www.reddit.com/r/BlockAds/" target="_blank" rel="noopener noreferrer">Reddit Forum</a>
        </div>
      </div>
    </div>
  </footer>

  <div id="toast" class="toast">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span id="toastMsg">Copied to clipboard!</span>
  </div>

  <script>
    function showToast(msg) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toastMsg');
      toastMsg.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => { toast.classList.remove('show'); }, 2200);
    }

    function copyDoh() {
      const input = document.getElementById('dohInput');
      input.select();
      navigator.clipboard.writeText(input.value);
      showToast('DoH endpoint copied to clipboard!');
    }

    function copyText(val) {
      navigator.clipboard.writeText(val);
      showToast('Copied: ' + val);
    }

    async function runDnsTest() {
      const domain = document.getElementById('testDomainInput').value.trim();
      const resEl = document.getElementById('testResult');
      if (!domain) return;

      resEl.style.display = 'block';
      resEl.style.background = '#f3f4f6';
      resEl.style.color = '#374151';
      resEl.innerText = 'Querying edge server...';

      try {
        const resp = await fetch('/dns-query?name=' + encodeURIComponent(domain) + '&type=A', {
          headers: { 'Accept': 'application/dns-json' }
        });
        const action = resp.headers.get('x-blockads-action') || 'unknown';
        const data = await resp.json();

        if (action === 'blocked' || data?.Answer?.[0]?.data === '0.0.0.0') {
          resEl.style.background = '#dcfce7';
          resEl.style.color = '#15803d';
          resEl.innerHTML = '<strong>🛡️ BLOCKED</strong>: ' + domain + ' was sinkholed to <code>0.0.0.0</code> (Ad / Tracking Filtered)';
        } else {
          const ip = data?.Answer?.[0]?.data || 'Resolved';
          resEl.style.background = '#eff6ff';
          resEl.style.color = '#1d4ed8';
          resEl.innerHTML = '<strong>✓ ALLOWED</strong>: ' + domain + ' resolved to <code>' + ip + '</code> (Passed through upstream)';
        }
      } catch (err) {
        resEl.style.background = '#fee2e2';
        resEl.style.color = '#b91c1c';
        resEl.innerText = 'Query failed: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}
