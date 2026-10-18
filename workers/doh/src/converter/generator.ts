/**
 * Proxy Config Generator for Quantumult X, Clash, Sing-box, Shadowrocket, Surge, Loon
 */

import {
  ProxyNode,
  TrojanNode,
  VMessNode,
  VLESSNode,
  ShadowsocksNode,
  Hysteria2Node,
  WireguardNode,
  TUICNode,
  ConversionOptions,
} from "./types";

/**
 * Main conversion entry point
 */
export function generateClientConfig(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const filteredNodes = filterAndDecorateNodes(nodes, options);

  switch (options.target) {
    case "quanx":
      return generateQuantumultX(filteredNodes, options);
    case "clash":
      return generateClashMeta(filteredNodes, options);
    case "singbox":
      return generateSingBox(filteredNodes, options);
    case "surge":
      return generateSurge(filteredNodes, options);
    case "loon":
      return generateLoon(filteredNodes, options);
    case "shadowrocket":
    case "base64":
    default:
      return generateBase64UriList(filteredNodes);
  }
}

/**
 * Filter nodes by regex and optionally add emoji flags
 */
function filterAndDecorateNodes(
  nodes: ProxyNode[],
  options: ConversionOptions
): ProxyNode[] {
  let result = [...nodes];

  if (options.filterRegex) {
    try {
      const re = new RegExp(options.filterRegex, "i");
      result = result.filter((n) => re.test(n.tag));
    } catch {}
  }

  if (options.excludeRegex) {
    try {
      const re = new RegExp(options.excludeRegex, "i");
      result = result.filter((n) => !re.test(n.tag));
    } catch {}
  }

  if (options.emojiFlags) {
    result = result.map((n) => {
      const emoji = detectCountryEmoji(n.tag);
      if (emoji && !n.tag.startsWith(emoji)) {
        return { ...n, tag: `${emoji} ${n.tag}` };
      }
      return n;
    });
  }

  // Deduplicate identical nodes
  const seen = new Set<string>();
  result = result.filter((n) => {
    const key = `${n.type}:${n.server.toLowerCase()}:${n.port}:${n.tag.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return result;
}

/**
 * Detect country flag emoji based on node tag keywords
 */
export function detectCountryEmoji(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower.includes("vietnam") || lower.includes("vn") || lower.includes("việt nam")) return "🇻🇳";
  if (lower.includes("singapore") || lower.includes("sg") || lower.includes("lion")) return "🇸🇬";
  if (lower.includes("japan") || lower.includes("jp") || lower.includes("tokyo")) return "🇯🇵";
  if (lower.includes("united states") || lower.includes("usa") || lower.includes("us")) return "🇺🇸";
  if (lower.includes("hong kong") || lower.includes("hk")) return "🇭🇰";
  if (lower.includes("taiwan") || lower.includes("tw")) return "🇹🇼";
  if (lower.includes("korea") || lower.includes("kr") || lower.includes("seoul")) return "🇰🇷";
  if (lower.includes("united kingdom") || lower.includes("uk") || lower.includes("london")) return "🇬🇧";
  if (lower.includes("germany") || lower.includes("de")) return "🇩🇪";
  return "⚡";
}

/**
 * Generate Quantumult X Config / Server Resource
 * Fixes the "Invalid content" error by only including QuanX-supported protocols
 */
export function generateQuantumultX(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const supportedLines: string[] = [];
  const unsupportedLines: string[] = [];

  for (const n of nodes) {
    if (n.type === "trojan") {
      const t = n as TrojanNode;
      const pwd = encodeURIComponent(t.password);
      const sni = t.sni ? `, tls-host=${t.sni}` : "";
      supportedLines.push(
        `trojan = ${t.server}:${t.port}, password=${pwd}, over-tls=true${sni}, tls-verification=true, tag=${t.tag}`
      );
    } else if (n.type === "vmess") {
      const v = n as VMessNode;
      const tls = v.tls ? ", over-tls=true" : "";
      const sni = v.sni ? `, tls-host=${v.sni}` : "";
      supportedLines.push(
        `vmess = ${v.server}:${v.port}, method=${v.cipher || "chacha20-ietf-poly1305"}, password=${v.uuid}${tls}${sni}, tag=${v.tag}`
      );
    } else if (n.type === "shadowsocks") {
      const s = n as ShadowsocksNode;
      supportedLines.push(
        `shadowsocks = ${s.server}:${s.port}, method=${s.cipher}, password=${s.password}, tag=${s.tag}`
      );
    } else if (n.type === "vless") {
      const vl = n as VLESSNode;
      if (vl.security === "reality") {
        // Quantumult X cannot natively parse Reality in server resources without crashing
        unsupportedLines.push(
          `; Skipped VLESS-Reality: Quantumult X does not support Reality in remote subscription (${vl.tag})`
        );
      } else {
        supportedLines.push(
          `vless = ${vl.server}:${vl.port}, method=none, password=${vl.uuid}, obfs=over-tls, obfs-host=${vl.sni || vl.server}, tag=${vl.tag}`
        );
      }
    } else {
      unsupportedLines.push(
        `; Skipped ${n.type.toUpperCase()}: Quantumult X does not support ${n.type} in subscriptions (${n.tag})`
      );
    }
  }

  // If includeRules is false (pure server resource for QuanX Server Resources URL)
  if (!options.includeRules) {
    let output = `; BlockAds Universal Subscription Converter for Quantumult X\n`;
    output += `; Active nodes: ${supportedLines.length} | Incompatible skipped: ${unsupportedLines.length}\n\n`;
    output += supportedLines.join("\n");
    if (unsupportedLines.length > 0) {
      output += "\n\n; ── Unsupported Nodes (Use Clash Meta or Sing-box for these) ──\n";
      output += unsupportedLines.join("\n");
    }
    return output;
  }

  // Full Quantumult X configuration profile
  const tagList = nodes
    .filter((n) => ["trojan", "vmess", "shadowsocks"].includes(n.type))
    .map((n) => n.tag)
    .join(", ");

  return `[general]
excluded_routes=192.168.0.0/16, 172.16.0.0/12, 100.64.0.0/10, 10.0.0.0/8
geo_location_checker=http://ip-api.com/json/?lang=en
server_check_url=http://www.gstatic.com/generate_204

[dns]
server=1.1.1.1
server=8.8.8.8
server=dns.pwhs.app

[policy]
static=PROXY, ${tagList || "DIRECT"}, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Proxy.png
url-latency-benchmark=AUTO, ${tagList || "DIRECT"}, check-interval=300, img-url=https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Auto.png

[server_local]
${supportedLines.join("\n")}

${unsupportedLines.length > 0 ? unsupportedLines.join("\n") + "\n" : ""}
[filter_local]
FINAL,PROXY
`;
}

/**
 * Generate Clash Meta (Mihomo) YAML Configuration
 */
export function generateClashMeta(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const proxiesYaml: string[] = [];
  const proxyNames: string[] = [];

  for (const n of nodes) {
    proxyNames.push(n.tag);
    if (n.type === "trojan") {
      const t = n as TrojanNode;
      proxiesYaml.push(`  - name: "${t.tag}"
    type: trojan
    server: "${t.server}"
    port: ${t.port}
    password: "${t.password}"
    sni: "${t.sni || t.server}"
    skip-cert-verify: ${t.skipCertVerify || false}
    udp: ${options.udp !== false}`);
    } else if (n.type === "vmess") {
      const v = n as VMessNode;
      proxiesYaml.push(`  - name: "${v.tag}"
    type: vmess
    server: "${v.server}"
    port: ${v.port}
    uuid: "${v.uuid}"
    alterId: ${v.alterId || 0}
    cipher: "${v.cipher || "auto"}"
    tls: ${v.tls || false}
    servername: "${v.sni || v.server}"
    network: "${v.network || "tcp"}"
    udp: ${options.udp !== false}`);
    } else if (n.type === "vless") {
      const vl = n as VLESSNode;
      let realityYaml = "";
      if (vl.security === "reality") {
        realityYaml = `\n    reality-opts:\n      public-key: "${vl.pbk || ""}"\n      short-id: "${vl.sid || ""}"`;
      }
      proxiesYaml.push(`  - name: "${vl.tag}"
    type: vless
    server: "${vl.server}"
    port: ${vl.port}
    uuid: "${vl.uuid}"
    network: "${vl.network || "tcp"}"
    tls: ${vl.security === "tls" || vl.security === "reality"}
    servername: "${vl.sni || vl.server}"${realityYaml}
    udp: ${options.udp !== false}`);
    } else if (n.type === "shadowsocks") {
      const s = n as ShadowsocksNode;
      proxiesYaml.push(`  - name: "${s.tag}"
    type: ss
    server: "${s.server}"
    port: ${s.port}
    cipher: "${s.cipher}"
    password: "${s.password}"
    udp: ${options.udp !== false}`);
    } else if (n.type === "hysteria2") {
      const h = n as Hysteria2Node;
      proxiesYaml.push(`  - name: "${h.tag}"
    type: hysteria2
    server: "${h.server}"
    port: ${h.port}
    password: "${h.password}"
    sni: "${h.sni || h.server}"
    obfs: "${h.obfs || ""}"
    obfs-password: "${h.obfsPassword || ""}"`);
    } else if (n.type === "tuic") {
      const tu = n as TUICNode;
      proxiesYaml.push(`  - name: "${tu.tag}"
    type: tuic
    server: "${tu.server}"
    port: ${tu.port}
    uuid: "${tu.uuid}"
    password: "${tu.password}"
    sni: "${tu.sni || tu.server}"
    congestion-controller: "${tu.congestionControl || "bbr"}"`);
    }
  }

  const namesList = proxyNames.map((name) => `      - "${name}"`).join("\n");

  return `port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
ipv6: true

dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  nameserver:
    - 1.1.1.1
    - 8.8.8.8
    - https://dns.pwhs.app/dns-query

proxies:
${proxiesYaml.join("\n")}

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "AUTO"
${namesList}
  - name: "AUTO"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${namesList}

rules:
  - GEOIP,LAN,DIRECT
  - MATCH,PROXY
`;
}

/**
 * Generate Sing-box JSON Configuration
 */
export function generateSingBox(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const outbounds: any[] = [];
  const tags: string[] = [];

  for (const n of nodes) {
    tags.push(n.tag);
    if (n.type === "trojan") {
      const t = n as TrojanNode;
      outbounds.push({
        type: "trojan",
        tag: t.tag,
        server: t.server,
        server_port: t.port,
        password: t.password,
        tls: {
          enabled: true,
          server_name: t.sni || t.server,
          insecure: t.skipCertVerify || false,
        },
      });
    } else if (n.type === "vmess") {
      const v = n as VMessNode;
      outbounds.push({
        type: "vmess",
        tag: v.tag,
        server: v.server,
        server_port: v.port,
        uuid: v.uuid,
        security: v.cipher || "auto",
        alter_id: v.alterId || 0,
        tls: {
          enabled: v.tls || false,
          server_name: v.sni || v.server,
        },
      });
    } else if (n.type === "vless") {
      const vl = n as VLESSNode;
      const vlessObj: any = {
        type: "vless",
        tag: vl.tag,
        server: vl.server,
        server_port: vl.port,
        uuid: vl.uuid,
      };
      if (vl.security === "reality") {
        vlessObj.tls = {
          enabled: true,
          server_name: vl.sni || vl.server,
          reality: {
            enabled: true,
            public_key: vl.pbk || "",
            short_id: vl.sid || "",
          },
        };
      }
      outbounds.push(vlessObj);
    } else if (n.type === "shadowsocks") {
      const s = n as ShadowsocksNode;
      outbounds.push({
        type: "shadowsocks",
        tag: s.tag,
        server: s.server,
        server_port: s.port,
        method: s.cipher,
        password: s.password,
      });
    } else if (n.type === "hysteria2") {
      const h = n as Hysteria2Node;
      outbounds.push({
        type: "hysteria2",
        tag: h.tag,
        server: h.server,
        server_port: h.port,
        password: h.password,
        tls: {
          enabled: true,
          server_name: h.sni || h.server,
        },
      });
    }
  }

  const config = {
    outbounds: [
      {
        type: "selector",
        tag: "select",
        outbounds: ["auto", ...tags],
      },
      {
        type: "urltest",
        tag: "auto",
        outbounds: tags,
        url: "http://www.gstatic.com/generate_204",
        interval: "5m",
      },
      ...outbounds,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
    ],
  };

  return JSON.stringify(config, null, 2);
}

/**
 * Generate Surge Configuration
 */
export function generateSurge(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.type === "trojan") {
      const t = n as TrojanNode;
      lines.push(
        `${t.tag} = trojan, ${t.server}, ${t.port}, password=${t.password}, sni=${t.sni || t.server}`
      );
    } else if (n.type === "vmess") {
      const v = n as VMessNode;
      lines.push(
        `${v.tag} = vmess, ${v.server}, ${v.port}, username=${v.uuid}, tls=${v.tls ? "true" : "false"}, sni=${v.sni || v.server}`
      );
    } else if (n.type === "shadowsocks") {
      const s = n as ShadowsocksNode;
      lines.push(
        `${s.tag} = ss, ${s.server}, ${s.port}, encrypt-method=${s.cipher}, password=${s.password}`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Generate Loon Configuration
 */
export function generateLoon(
  nodes: ProxyNode[],
  options: ConversionOptions
): string {
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.type === "trojan") {
      const t = n as TrojanNode;
      lines.push(
        `${t.tag} = trojan, ${t.server}, ${t.port}, "${t.password}", "${t.sni || t.server}"`
      );
    } else if (n.type === "vmess") {
      const v = n as VMessNode;
      lines.push(
        `${v.tag} = vmess, ${v.server}, ${v.port}, "${v.cipher || "auto"}", "${v.uuid}"`
      );
    } else if (n.type === "shadowsocks") {
      const s = n as ShadowsocksNode;
      lines.push(
        `${s.tag} = Shadowsocks, ${s.server}, ${s.port}, "${s.cipher}", "${s.password}"`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Generate Base64 Encoded URI list for Shadowrocket / V2Ray
 */
export function generateBase64UriList(nodes: ProxyNode[]): string {
  const uris = nodes.map((n) => n.raw).filter(Boolean);
  const text = uris.join("\n");
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return text;
  }
}
