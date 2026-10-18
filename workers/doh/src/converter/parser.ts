/**
 * Subscription Parser - Supports Trojan, VMess, VLESS, Shadowsocks, Hysteria2, WireGuard, TUIC
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
  OtherNode,
} from "./types";

/**
 * Decode Base64 string safely, handling URL-safe Base64 and standard Base64
 */
export function safeBase64Decode(str: string): string {
  try {
    let clean = str.trim().replace(/-/g, "+").replace(/_/g, "/");
    while (clean.length % 4 !== 0) {
      clean += "=";
    }
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return str;
  }
}

/**
 * Safely URL decode string
 */
export function safeUrlDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/**
 * Parse raw subscription text (Base64 or plain lines) into ProxyNode[]
 */
export function parseSubscriptionContent(content: string): ProxyNode[] {
  let text = content.trim();

  // If content looks like pure Base64 without newlines or protocol prefixes, decode it
  if (!text.includes("\n") && !text.includes("://") && text.length > 20) {
    text = safeBase64Decode(text);
  } else if (!text.includes("://") && text.length > 20) {
    // Attempt decoding if it might be Base64
    const decoded = safeBase64Decode(text);
    if (decoded.includes("://")) {
      text = decoded;
    }
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nodes: ProxyNode[] = [];

  for (const line of lines) {
    const node = parseProxyUri(line);
    if (node) {
      nodes.push(node);
    }
  }

  return nodes;
}

/**
 * Parse a single proxy URI into a ProxyNode
 */
export function parseProxyUri(uri: string): ProxyNode | null {
  const cleanUri = uri.trim();
  if (!cleanUri || cleanUri.startsWith("#") || cleanUri.startsWith("//")) {
    return null;
  }

  try {
    if (cleanUri.startsWith("trojan://")) {
      return parseTrojanUri(cleanUri);
    }
    if (cleanUri.startsWith("vmess://")) {
      return parseVMessUri(cleanUri);
    }
    if (cleanUri.startsWith("vless://")) {
      return parseVLESSUri(cleanUri);
    }
    if (cleanUri.startsWith("ss://")) {
      return parseShadowsocksUri(cleanUri);
    }
    if (cleanUri.startsWith("hysteria2://") || cleanUri.startsWith("hy2://")) {
      return parseHysteria2Uri(cleanUri);
    }
    if (cleanUri.startsWith("wireguard://")) {
      return parseWireguardUri(cleanUri);
    }
    if (cleanUri.startsWith("tuic://")) {
      return parseTuicUri(cleanUri);
    }
  } catch (err) {
    console.warn(`[Parser] Failed to parse URI: ${cleanUri.slice(0, 40)}...`, err);
  }

  return {
    type: "unknown",
    server: "",
    port: 0,
    tag: cleanUri.slice(0, 30),
    raw: cleanUri,
  };
}

/**
 * Parse trojan://password@host:port?sni=...#Tag
 */
function parseTrojanUri(uri: string): TrojanNode | null {
  const u = new URL(uri);
  const tag = safeUrlDecode(u.hash ? u.hash.slice(1) : u.hostname);
  const password = safeUrlDecode(u.username);
  const sni = u.searchParams.get("sni") || u.searchParams.get("peer") || u.hostname;
  const alpn = u.searchParams.get("alpn") || undefined;
  const skipCertVerify =
    u.searchParams.get("allowInsecure") === "1" ||
    u.searchParams.get("insecure") === "1";

  return {
    type: "trojan",
    server: u.hostname,
    port: parseInt(u.port, 10) || 443,
    password,
    sni,
    alpn,
    skipCertVerify,
    tag,
    raw: uri,
  };
}

/**
 * Parse vmess://base64_json
 */
function parseVMessUri(uri: string): VMessNode | null {
  const b64 = uri.slice(8);
  const jsonStr = safeBase64Decode(b64);
  const json = JSON.parse(jsonStr);

  const server = json.add || json.host || "";
  const port = parseInt(json.port, 10) || 443;
  const tag = json.ps || `${server}:${port}`;
  const uuid = json.id || "";
  const tls = json.tls === "tls";
  const sni = json.sni || server;

  return {
    type: "vmess",
    server,
    port,
    uuid,
    alterId: parseInt(json.aid, 10) || 0,
    cipher: json.scy || "auto",
    network: json.net || "tcp",
    tls,
    sni,
    path: json.path || undefined,
    host: json.host || undefined,
    tag,
    raw: uri,
  };
}

/**
 * Parse vless://uuid@host:port?security=reality&pbk=...&sid=...#Tag
 */
function parseVLESSUri(uri: string): VLESSNode | null {
  const u = new URL(uri);
  const tag = safeUrlDecode(u.hash ? u.hash.slice(1) : u.hostname);
  const uuid = u.username;
  const security = (u.searchParams.get("security") as any) || "none";
  const sni = u.searchParams.get("sni") || u.hostname;
  const pbk = u.searchParams.get("pbk") || undefined;
  const sid = u.searchParams.get("sid") || undefined;
  const spx = u.searchParams.get("spx") || undefined;
  const flow = u.searchParams.get("flow") || undefined;
  const network = u.searchParams.get("type") || "tcp";

  return {
    type: "vless",
    server: u.hostname,
    port: parseInt(u.port, 10) || 443,
    uuid,
    security,
    sni,
    pbk,
    sid,
    spx,
    flow,
    network,
    tag,
    raw: uri,
  };
}

/**
 * Parse ss://base64 or ss://cipher:pass@host:port#Tag
 */
function parseShadowsocksUri(uri: string): ShadowsocksNode | null {
  // Check if standard URL parse works
  const hashIdx = uri.indexOf("#");
  const mainPart = hashIdx !== -1 ? uri.slice(5, hashIdx) : uri.slice(5);
  const tag = hashIdx !== -1 ? safeUrlDecode(uri.slice(hashIdx + 1)) : "Shadowsocks";

  let server = "";
  let port = 8388;
  let cipher = "aes-256-gcm";
  let password = "";

  if (mainPart.includes("@")) {
    const atIdx = mainPart.lastIndexOf("@");
    const credPart = mainPart.slice(0, atIdx);
    const hostPart = mainPart.slice(atIdx + 1);

    const [h, p] = hostPart.split("?")[0].split(":");
    server = h;
    port = parseInt(p, 10) || 8388;

    if (credPart.includes(":")) {
      const cIdx = credPart.indexOf(":");
      cipher = credPart.slice(0, cIdx);
      password = credPart.slice(cIdx + 1);
    } else {
      const decodedCred = safeBase64Decode(credPart);
      const cIdx = decodedCred.indexOf(":");
      if (cIdx !== -1) {
        cipher = decodedCred.slice(0, cIdx);
        password = decodedCred.slice(cIdx + 1);
      }
    }
  } else {
    // Entire body is base64 encoded
    const decoded = safeBase64Decode(mainPart);
    if (decoded.includes("@")) {
      const atIdx = decoded.lastIndexOf("@");
      const credPart = decoded.slice(0, atIdx);
      const hostPart = decoded.slice(atIdx + 1);
      const [h, p] = hostPart.split(":");
      server = h;
      port = parseInt(p, 10) || 8388;
      const [c, pass] = credPart.split(":");
      cipher = c;
      password = pass;
    }
  }

  return {
    type: "shadowsocks",
    server,
    port,
    cipher,
    password,
    tag,
    raw: uri,
  };
}

/**
 * Parse hysteria2://password@host:port?sni=...#Tag
 */
function parseHysteria2Uri(uri: string): Hysteria2Node | null {
  const u = new URL(uri);
  const tag = safeUrlDecode(u.hash ? u.hash.slice(1) : u.hostname);
  const password = safeUrlDecode(u.username);
  const sni = u.searchParams.get("sni") || u.hostname;
  const obfs = u.searchParams.get("obfs") || undefined;
  const obfsPassword = u.searchParams.get("obfs-password") || undefined;

  return {
    type: "hysteria2",
    server: u.hostname,
    port: parseInt(u.port, 10) || 443,
    password,
    sni,
    obfs,
    obfsPassword,
    tag,
    raw: uri,
  };
}

/**
 * Parse wireguard://privatekey@host:port?publickey=...#Tag
 */
function parseWireguardUri(uri: string): WireguardNode | null {
  const u = new URL(uri);
  const tag = safeUrlDecode(u.hash ? u.hash.slice(1) : u.hostname);
  const privateKey = safeUrlDecode(u.username);
  const publicKey = u.searchParams.get("publickey") || undefined;
  const ip = u.searchParams.get("address") || undefined;
  const mtu = parseInt(u.searchParams.get("mtu") || "1420", 10);

  return {
    type: "wireguard",
    server: u.hostname,
    port: parseInt(u.port, 10) || 51820,
    privateKey,
    publicKey,
    ip,
    mtu,
    tag,
    raw: uri,
  };
}

/**
 * Parse tuic://uuid:password@host:port?...#Tag
 */
function parseTuicUri(uri: string): TUICNode | null {
  const u = new URL(uri);
  const tag = safeUrlDecode(u.hash ? u.hash.slice(1) : u.hostname);
  const uuid = u.username;
  const password = safeUrlDecode(u.password);
  const sni = u.searchParams.get("sni") || u.hostname;
  const congestionControl = u.searchParams.get("congestion_control") || "bbr";
  const alpn = u.searchParams.get("alpn") || undefined;

  return {
    type: "tuic",
    server: u.hostname,
    port: parseInt(u.port, 10) || 443,
    uuid,
    password,
    sni,
    congestionControl,
    alpn,
    tag,
    raw: uri,
  };
}
