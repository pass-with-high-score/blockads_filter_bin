/**
 * English Web UI for BlockAds Subscription Converter
 * Supports Quantumult X, Clash, Sing-box, Shadowrocket, Surge, and Loon
 */

export function renderConverterHtml(host: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Subscription Converter - BlockAds</title>
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
      --text-primary: #12121a;
      --text-secondary: #5f6368;
      --border: #e5e7eb;
      --primary: #111827;
      --blue: #2563eb;
      --purple: #7c3aed;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-primary);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      background-image:
        radial-gradient(ellipse at 20% 40%, rgba(0, 230, 118, 0.05) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(99, 102, 241, 0.05) 0%, transparent 50%);
    }

    /* Navbar */
    .navbar {
      position: fixed;
      top: 0; left: 0; right: 0;
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
      max-width: 920px;
      margin: 0 auto;
      padding: 90px 20px 80px;
    }

    /* Hero */
    .hero {
      text-align: center;
      margin-bottom: 32px;
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
      width: 7px; height: 7px;
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
      max-width: 620px;
      margin: 0 auto;
    }

    /* Card */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 3px 15px -2px rgba(0, 0, 0, 0.04);
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Forms */
    .form-group {
      margin-bottom: 18px;
    }
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 11px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 13.5px;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
      transition: all 0.15s ease;
      background: #fafafa;
    }
    .form-input:focus {
      border-color: #00E676;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(0, 230, 118, 0.15);
    }
    textarea.form-input {
      resize: vertical;
      min-height: 90px;
      line-height: 1.5;
    }
    .select-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .client-card {
      border: 2px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      background: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .client-card:hover {
      border-color: #94a3b8;
    }
    .client-card.active {
      border-color: #00E676;
      background: rgba(0, 230, 118, 0.04);
    }
    .client-radio { display: none; }
    .client-info strong { display: block; font-size: 13.5px; }
    .client-info span { font-size: 11.5px; color: var(--text-secondary); }

    /* Options checklist */
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      color: var(--text-primary);
      cursor: pointer;
      user-select: none;
    }

    /* Buttons */
    .btn-main {
      width: 100%;
      background: #111827;
      color: #ffffff;
      border: none;
      padding: 13px;
      border-radius: 10px;
      font-size: 14.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-main:hover {
      background: #000000;
      transform: translateY(-1px);
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      color: var(--text-primary);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;
    }
    .btn-action:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    .btn-primary-action {
      background: #00E676;
      color: #000000;
      border: 1px solid #00C853;
      font-weight: 700;
    }
    .btn-primary-action:hover {
      background: #00C853;
    }

    /* Result Box */
    .result-section {
      display: none;
      margin-top: 24px;
    }
    .result-url-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f8fafc;
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 10px;
      margin-bottom: 16px;
    }
    .result-url-input {
      flex: 1;
      border: none;
      background: transparent;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      outline: none;
      color: #0f172a;
    }
    .quick-import-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }

    /* Preview box */
    .preview-box {
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      max-height: 320px;
      overflow-y: auto;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Guide Section */
    .guide-item {
      border-left: 3px solid #00E676;
      padding-left: 14px;
      margin-bottom: 16px;
    }
    .guide-title {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .guide-desc {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .code-tag {
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
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
    .footer a { color: #2563eb; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #111827;
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 100;
    }
    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
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
        <a href="/">DNS Setup</a>
        <a href="/leak">DNS Leak Test</a>
        <a href="/sub" class="active">Sub Converter</a>
        <a href="https://complier.pwhs.app" target="_blank">Compiler</a>
        <a href="/api/dns-leak/docs">Open API</a>
      </nav>
    </div>
  </header>

  <main class="main-wrapper">
    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-pill">Universal Subscription Converter</div>
      <h1>Proxy & VPN Subscription Converter</h1>
      <p>
        Convert 3X-UI, V2Ray, and mixed proxy subscriptions into Quantumult X, Clash, Sing-box, Shadowrocket, Surge, and Loon formats.
      </p>
    </section>

    <!-- Main Converter Card -->
    <div class="card">
      <div class="card-title">
        <span>1. Input Subscription Source</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="subUrl">Subscription URL:</label>
        <div style="display:flex; gap:8px;">
          <input
            type="url"
            id="subUrl"
            class="form-input"
            placeholder="e.g. https://vpn.pwhs.app:2096/ytuuqzxxasivqngn/vvx2igw700x0d94j"
            value="https://vpn.pwhs.app:2096/ytuuqzxxasivqngn/vvx2igw700x0d94j"
          >
          <button type="button" class="btn-action" onclick="pasteClipboard()">Paste</button>
        </div>
      </div>

      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label class="form-label" style="margin-bottom:0;" for="rawUris">Or Paste Raw Node URIs (Optional):</label>
          <span style="font-size:12px; color:var(--text-secondary); cursor:pointer;" onclick="toggleRawInput()">Toggle Raw Box</span>
        </div>
        <textarea
          id="rawUris"
          class="form-input"
          placeholder="trojan://...&#10;vmess://...&#10;vless://...&#10;ss://..."
          style="display:none;"
        ></textarea>
      </div>

      <div class="card-title" style="margin-top:20px;">
        <span>2. Select Target Client</span>
      </div>

      <div class="select-grid">
        <div class="client-card active" onclick="selectClient('quanx', this)">
          <div class="client-info">
            <strong>Quantumult X</strong>
            <span>Fixes "Invalid content"</span>
          </div>
        </div>
        <div class="client-card" onclick="selectClient('clash', this)">
          <div class="client-info">
            <strong>Clash / Mihomo</strong>
            <span>YAML Configuration</span>
          </div>
        </div>
        <div class="client-card" onclick="selectClient('singbox', this)">
          <div class="client-info">
            <strong>Sing-box / Hiddify</strong>
            <span>JSON Outbounds</span>
          </div>
        </div>
        <div class="client-card" onclick="selectClient('shadowrocket', this)">
          <div class="client-info">
            <strong>Shadowrocket</strong>
            <span>Base64 / Standard</span>
          </div>
        </div>
        <div class="client-card" onclick="selectClient('surge', this)">
          <div class="client-info">
            <strong>Surge</strong>
            <span>Surge Proxy List</span>
          </div>
        </div>
        <div class="client-card" onclick="selectClient('loon', this)">
          <div class="client-info">
            <strong>Loon</strong>
            <span>Loon Nodes List</span>
          </div>
        </div>
      </div>

      <div class="checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" id="optEmoji" checked>
          <span>Add Flag Emojis to node names (🇻🇳, 🇸🇬, 🇯🇵, 🇺🇸)</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="optRules">
          <span>Include Standard Rules & Policies (Full Profile)</span>
        </label>
      </div>

      <button id="btnConvert" class="btn-main" onclick="handleConvert()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        Convert Subscription
      </button>

      <!-- Output Section -->
      <div id="resultSection" class="result-section">
        <div class="card-title" style="margin-top:20px;">
          <span>3. Converted Subscription Link</span>
        </div>

        <div class="result-url-box">
          <input type="text" id="resultUrl" class="result-url-input" readonly>
          <button class="btn-action btn-primary-action" onclick="copyResultUrl()">Copy Link</button>
        </div>

        <div class="quick-import-row">
          <span style="font-size:12.5px; font-weight:600; color:var(--text-secondary); margin-right:4px;">One-Click Import:</span>
          <a id="btnImportQuanx" href="#" class="btn-action">Add to Quantumult X</a>
          <a id="btnImportShadowrocket" href="#" class="btn-action">Add to Shadowrocket</a>
          <a id="btnImportClash" href="#" class="btn-action">Add to Clash</a>
          <a id="btnImportSingbox" href="#" class="btn-action">Add to Sing-box</a>
        </div>

        <div class="card-title">
          <span>Node Preview & Configuration</span>
          <button class="btn-action" onclick="copyPreviewText()">Copy Output</button>
        </div>
        <div id="previewBox" class="preview-box">Generating...</div>
      </div>
    </div>

    <!-- Instructions & Troubleshooting Guide -->
    <div class="card">
      <div class="card-title">
        <span>📖 Setup & Troubleshooting Guide</span>
      </div>

      <div class="guide-item">
        <div class="guide-title">Why does Quantumult X show "Invalid content"?</div>
        <div class="guide-desc">
          Quantumult X uses a strict custom syntax (<span class="code-tag">trojan = host:port...</span>). When 3X-UI returns mixed Base64 containing protocols that QuanX does not natively support (such as VLESS Reality, WireGuard, or Hysteria2), QuanX's parser immediately rejects the entire subscription with <span class="code-tag">Invalid content</span>.<br>
          <strong>Solution:</strong> Use our converted Quantumult X link above. It automatically extracts and reformats supported nodes (Trojan, VMess, Shadowsocks) so QuanX parses them 100% cleanly without errors.
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-title">How to add to Quantumult X (Server Resources):</div>
        <div class="guide-desc">
          1. Open <strong>Quantumult X</strong> &rarr; Tap the windmill icon at the bottom-right.<br>
          2. Under <strong>Server</strong>, tap <strong>Server Resources</strong>.<br>
          3. Tap <strong>+</strong> in the top-right corner:<br>
             &bull; <strong>Tag:</strong> Enter a name (e.g. <span class="code-tag">PWHS-VPN</span>)<br>
             &bull; <strong>Resource Path:</strong> Paste the Converted Subscription Link above.<br>
          4. Tap <strong>Save</strong> &rarr; Swipe the item to the left &rarr; tap <strong>Update</strong>. Your nodes will appear immediately!
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-title">Single Node Direct Manual Import (Fastest for Trojan):</div>
        <div class="guide-desc">
          If you only need your primary Trojan server line without a remote subscription, copy this exact syntax directly into QuanX &rarr; Servers &rarr; Custom:<br>
          <span class="code-tag">trojan = vpn.pwhs.app:19095, password=4XubMiD6J9SxtT9j17nXNcCZup%2FDCeu9m%2BvApgQQIjQ%3D, over-tls=true, tls-host=vpn.pwhs.app, tls-verification=true, tag=Trojan-VPN</span>
        </div>
      </div>

      <div class="guide-item">
        <div class="guide-title">Shadowrocket & Sing-box HTTPS Port 2096:</div>
        <div class="guide-desc">
          Your 3X-UI server on port 2096 has a valid SSL Let's Encrypt certificate. Ensure your subscription URL uses <span class="code-tag">https://</span> (not <span class="code-tag">http://</span>) to prevent TLS connection rejections.
        </div>
      </div>
    </div>
  </main>

  <footer class="footer">
    <div>
      <strong>BlockAds Tools Ecosystem</strong> &bull; Serverless Subscription Converter & Privacy Engine
    </div>
    <div style="margin-top:8px;">
      <a href="/">DNS Setup</a> &bull;
      <a href="/leak">DNS Leak Check</a> &bull;
      <a href="https://complier.pwhs.app" target="_blank">Compiler</a> &bull;
      <a href="https://github.com/brianshea2/addr.tools" target="_blank">addr.tools ↗</a>
    </div>
  </footer>

  <div id="toast" class="toast">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E676" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span id="toastMsg">Copied!</span>
  </div>

  <script>
    let currentTarget = 'quanx';

    function showToast(msg) {
      const toast = document.getElementById('toast');
      document.getElementById('toastMsg').innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }

    function selectClient(client, el) {
      currentTarget = client;
      document.querySelectorAll('.client-card').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
    }

    function toggleRawInput() {
      const area = document.getElementById('rawUris');
      area.style.display = area.style.display === 'none' ? 'block' : 'none';
    }

    async function pasteClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          document.getElementById('subUrl').value = text.trim();
          showToast('Pasted from clipboard!');
        }
      } catch (e) {
        showToast('Clipboard access denied');
      }
    }

    function copyResultUrl() {
      const input = document.getElementById('resultUrl');
      input.select();
      navigator.clipboard.writeText(input.value);
      showToast('Subscription link copied!');
    }

    function copyPreviewText() {
      const text = document.getElementById('previewBox').innerText;
      navigator.clipboard.writeText(text);
      showToast('Configuration copied to clipboard!');
    }

    async function handleConvert() {
      const subUrl = document.getElementById('subUrl').value.trim();
      const rawUris = document.getElementById('rawUris').value.trim();
      const optEmoji = document.getElementById('optEmoji').checked;
      const optRules = document.getElementById('optRules').checked;

      if (!subUrl && !rawUris) {
        alert('Please provide a Subscription URL or paste raw node URIs.');
        return;
      }

      const btn = document.getElementById('btnConvert');
      btn.disabled = true;
      btn.innerText = 'Converting...';

      const origin = window.location.origin;
      let generatedUrl = origin + '/sub?target=' + currentTarget;

      if (subUrl) {
        generatedUrl += '&url=' + encodeURIComponent(subUrl);
      }
      if (optEmoji) {
        generatedUrl += '&emoji=true';
      }
      if (optRules) {
        generatedUrl += '&rules=true';
      }

      // Display URL
      document.getElementById('resultUrl').value = generatedUrl;
      document.getElementById('resultSection').style.display = 'block';

      // Setup one-click import links
      document.getElementById('btnImportQuanx').href = 'quantumult-x:///add-resource?remote-resource=' + encodeURIComponent(generatedUrl);
      document.getElementById('btnImportShadowrocket').href = 'sub://' + btoa(generatedUrl);
      document.getElementById('btnImportClash').href = 'clash://install-config?url=' + encodeURIComponent(generatedUrl);
      document.getElementById('btnImportSingbox').href = 'sing-box://import-remote-profile?url=' + encodeURIComponent(generatedUrl);

      // Fetch preview
      const previewBox = document.getElementById('previewBox');
      previewBox.innerText = 'Fetching converted configuration from edge...';

      try {
        let resp;
        if (rawUris && !subUrl) {
          resp = await fetch('/sub?target=' + currentTarget + (optEmoji ? '&emoji=true' : '') + (optRules ? '&rules=true' : ''), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: rawUris,
          });
        } else {
          resp = await fetch(generatedUrl);
        }

        const text = await resp.text();
        previewBox.innerText = text;
      } catch (err) {
        previewBox.innerText = 'Error fetching preview: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> Convert Subscription';
      }
    }
  </script>
</body>
</html>`;
}
