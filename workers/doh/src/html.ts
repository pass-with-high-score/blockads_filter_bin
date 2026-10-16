/**
 * BlockAds Private DNS Serverless Setup Dashboard
 */

export function renderDashboardHtml(host: string, upstream: string, ruleCount: number): string {
  const dohUrl = `https://${host}/dns-query`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BlockAds Private DNS - Serverless DoH</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(18, 20, 29, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #00E676;
      --accent-glow: rgba(0, 230, 118, 0.25);
      --text: #f0f3f6;
      --text-muted: #8b949e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px 80px;
      background-image: 
        radial-gradient(ellipse at 50% 0%, rgba(0, 230, 118, 0.12) 0%, transparent 60%),
        radial-gradient(circle at 10% 30%, rgba(99, 102, 241, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 90% 80%, rgba(236, 72, 153, 0.05) 0%, transparent 40%);
    }
    .container { max-width: 860px; width: 100%; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: rgba(0, 230, 118, 0.1);
      border: 1px solid rgba(0, 230, 118, 0.3);
      border-radius: 9999px;
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge::before {
      content: '';
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 12px var(--accent);
    }
    h1 {
      font-size: 2.8rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      margin-bottom: 14px;
    }
    h1 span { color: var(--accent); }
    .subtitle {
      font-size: 1.1rem;
      color: var(--text-muted);
      max-width: 620px;
      line-height: 1.6;
      margin-bottom: 36px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 28px;
      backdrop-filter: blur(16px);
      margin-bottom: 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .card-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .url-box {
      display: flex;
      gap: 12px;
      margin: 18px 0;
    }
    .url-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      padding: 14px 18px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #7ee787;
      outline: none;
    }
    .btn {
      background: var(--accent);
      color: #000;
      border: none;
      padding: 14px 22px;
      border-radius: 14px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    .btn:hover {
      background: #00c853;
      transform: translateY(-1px);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .feature-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      padding: 20px;
    }
    .feature-title {
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 8px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .feature-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .setup-step {
      display: flex;
      gap: 16px;
      margin-top: 16px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
    }
    .step-num {
      width: 28px;
      height: 28px;
      background: rgba(0, 230, 118, 0.15);
      color: var(--accent);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      flex-shrink: 0;
    }
    .step-content { font-size: 14px; line-height: 1.5; }
    .step-content strong { color: #fff; }
    code {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--accent);
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #00E676;
      color: #000;
      font-weight: 700;
      padding: 12px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 230, 118, 0.4);
      display: none;
      animation: slideUp 0.3s ease;
    }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Cloudflare Edge Powered • Global < 5ms</div>
    <h1>BlockAds <span>Private DNS</span></h1>
    <p class="subtitle">
      Serverless DNS-over-HTTPS (DoH) engine with real-time edge adblocking. Blocks ads, popups, and trackers before they ever reach your device.
    </p>

    <!-- DoH Endpoint Card -->
    <div class="card">
      <div class="card-title">🌐 Your Private DoH Endpoint</div>
      <p style="font-size: 14px; color: var(--text-muted);">
        Compatible with Android Private DNS, iOS profiles, Chrome, Firefox, AdGuard, and router configurations.
      </p>
      <div class="url-box">
        <input type="text" class="url-input" id="dohInput" value="${dohUrl}" readonly>
        <button class="btn" onclick="copyDoh()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          Copy Endpoint
        </button>
      </div>

      <div class="grid">
        <div class="feature-card">
          <div class="feature-title">⚡ 300+ Edge Locations</div>
          <div class="feature-desc">Processed globally on Cloudflare edge network nearest to your location with sub-5ms DNS resolution.</div>
        </div>
        <div class="feature-card">
          <div class="feature-title">🛡️ ${ruleCount.toLocaleString()}+ Active Rules</div>
          <div class="feature-desc">Real-time sinkhole of advertising networks, malware, telemetry, and tracking endpoints.</div>
        </div>
        <div class="feature-card">
          <div class="feature-title">🔒 Upstream Privacy</div>
          <div class="feature-desc">Non-blocked queries routed securely through encrypted upstream: <code>${upstream}</code>.</div>
        </div>
      </div>
    </div>

    <!-- Quick Setup Guide -->
    <div class="card">
      <div class="card-title">📱 Quick Setup Instructions</div>

      <div class="setup-step">
        <div class="step-num">1</div>
        <div class="step-content">
          <strong>Android (Private DNS / DoT / DoH):</strong><br>
          Go to <code>Settings</code> &rarr; <code>Network & Internet</code> &rarr; <code>Private DNS</code>.<br>
          Select <strong>Private DNS provider hostname</strong> and enter: <code>${host}</code> (or configure via Intra/PersonalDNS).
        </div>
      </div>

      <div class="setup-step">
        <div class="step-num">2</div>
        <div class="step-content">
          <strong>Chrome / Brave / Edge (Browser DoH):</strong><br>
          Go to <code>Settings</code> &rarr; <code>Privacy and Security</code> &rarr; <code>Security</code> &rarr; <code>Use secure DNS</code>.<br>
          Select <strong>Custom</strong> and paste: <code>${dohUrl}</code>
        </div>
      </div>

      <div class="setup-step">
        <div class="step-num">3</div>
        <div class="step-content">
          <strong>Firefox:</strong><br>
          Go to <code>Settings</code> &rarr; <code>Privacy & Security</code> &rarr; <code>DNS over HTTPS</code>.<br>
          Choose <strong>Max Protection</strong>, select <strong>Custom</strong>, and paste: <code>${dohUrl}</code>
        </div>
      </div>

      <div class="setup-step">
        <div class="step-num">4</div>
        <div class="step-content">
          <strong>AdGuard Home / Pi-hole / OpenWrt:</strong><br>
          Add <code>${dohUrl}</code> to your Upstream DNS Servers list.
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">✓ DoH Endpoint Copied!</div>

  <script>
    function copyDoh() {
      const input = document.getElementById('dohInput');
      input.select();
      navigator.clipboard.writeText(input.value);
      const toast = document.getElementById('toast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2500);
    }
  </script>
</body>
</html>`;
}
