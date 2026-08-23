import JSZip from "jszip";
import crypto from "crypto";

// Constants
const trieMagic = 0x54524945; // "TRIE"
const trieVersion = 2;
const bloomMagic = 0x424C4F4D; // "BLOM"
const bloomVersion = 1;
const bloomFPR = 0.001; // 0.1%

export interface CompileResult {
  zipData: Buffer;
  ruleCount: number;
  fileSize: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Domain Parser Heuristics
// ────────────────────────────────────────────────────────────────────────────

export function parseDomainLine(line: string): string {
  line = line.trim();
  if (line === "") return "";
  if (line[0] === '#' || line[0] === '!') return "";
  if (line.startsWith("@@")) return "";
  
  const containsAnyUnsafe = /[\$\/\\\*]/.test(line);
  if (containsAnyUnsafe && !line.startsWith("||")) return "";
  
  let domain = "";
  if (line.startsWith("||")) {
    domain = line.slice(2);
    if (/[\/\*\?]/.test(domain)) return "";
    
    const carrotIdx = domain.indexOf('^');
    if (carrotIdx !== -1) domain = domain.slice(0, carrotIdx);
    
    const dollarIdx = domain.indexOf('$');
    if (dollarIdx !== -1) domain = domain.slice(0, dollarIdx);
  } else if (
    line.startsWith("0.0.0.0 ") ||
    line.startsWith("0.0.0.0\t") ||
    line.startsWith("127.0.0.1 ") ||
    line.startsWith("127.0.0.1\t")
  ) {
    const fields = line.split(/\s+/);
    if (fields.length >= 2) {
      domain = fields[1];
    }
    const hashIdx = domain.indexOf('#');
    if (hashIdx !== -1) domain = domain.slice(0, hashIdx);
  } else {
    if (!/\s/.test(line) && line.includes(".")) {
      domain = line;
    }
  }
  
  domain = domain.trim().toLowerCase();
  if (
    domain === "" ||
    domain === "localhost" ||
    domain === "localhost.localdomain" ||
    domain === "broadcasthost" ||
    domain === "local"
  ) {
    return "";
  }
  if (!domain.includes(".")) return "";
  
  // Reject IP addresses
  if (domain[0] >= '0' && domain[0] <= '9') {
    if (/^[0-9\.]+$/.test(domain)) {
      return "";
    }
  }
  
  return domain;
}

export async function downloadAndParseDomains(url: string) {
  // Use a longer timeout just like Go's 90s timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    
    const text = await response.text();
    const lines = text.split(/\r?\n/);
    
    const seenDomains = new Set<string>();
    const seenCSS = new Set<string>();
    const seenScriptlets = new Set<string>();
    
    const domains: string[] = [];
    const cssRules: string[] = [];
    const scriptlets: string[] = [];
    
    for (const line of lines) {
      const rawLine = line.trim();
      if (rawLine === "") continue;
      
      // Skip obvious comments
      if ((rawLine.startsWith("! ") || rawLine.startsWith("# ")) && !rawLine.includes("##")) {
        continue;
      }
      
      if (rawLine.includes("##+js(") || rawLine.includes("#%#//scriptlet(")) {
        if (!seenScriptlets.has(rawLine)) {
          seenScriptlets.add(rawLine);
          scriptlets.push(rawLine);
        }
        continue;
      }
      
      if (
        rawLine.includes("##") &&
        !rawLine.includes("#@#") &&
        !rawLine.includes("##+js") &&
        !rawLine.includes("##^")
      ) {
        if (!seenCSS.has(rawLine)) {
          seenCSS.add(rawLine);
          cssRules.push(rawLine);
        }
      }
      
      const domain = parseDomainLine(rawLine);
      if (domain) {
        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          domains.push(domain);
        }
      }
    }
    
    scriptlets.sort();
    return { domains, cssRules, scriptlets };
  } finally {
    clearTimeout(id);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Trie Implementation & Serialization
// ────────────────────────────────────────────────────────────────────────────

export class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isTerminal: boolean = false;
  bfsOffset: number = 0;

  insert(domain: string) {
    const labels = domain.split(".");
    let node: TrieNode = this;
    for (let i = labels.length - 1; i >= 0; i--) {
      const label = labels[i];
      if (!label) continue;
      let child = node.children.get(label);
      if (!child) {
        child = new TrieNode();
        node.children.set(label, child);
      }
      node = child;
    }
    node.isTerminal = true;
  }

  countNodes(): number {
    let count = 1;
    for (const child of this.children.values()) {
      count += child.countNodes();
    }
    return count;
  }

  countTerminals(): number {
    let count = this.isTerminal ? 1 : 0;
    for (const child of this.children.values()) {
      count += child.countTerminals();
    }
    return count;
  }
}

export function serializeTrieToBytes(root: TrieNode): Buffer {
  const nodeCount = root.countNodes();
  const domainCount = root.countTerminals();

  // Pass 1: Calculate byte offsets
  const queue: TrieNode[] = [root];
  let offset = 16; // start after header

  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    node.bfsOffset = offset;

    // isTerminal(1 byte) + childCount(4 bytes)
    offset += 5;

    const labels = Array.from(node.children.keys()).sort();
    for (const label of labels) {
      const child = node.children.get(label)!;
      const labelBytes = Buffer.from(label, 'utf-8');
      
      // labelLen(2 bytes) + labelBytes(N bytes) + childOffset(4 bytes)
      offset += 2 + labelBytes.length + 4;
      queue.push(child);
    }
  }

  // Pass 2: Write bytes into Buffer
  const buffer = Buffer.alloc(offset);

  // Header (16 bytes, big-endian)
  buffer.writeUInt32BE(trieMagic, 0);
  buffer.writeUInt32BE(trieVersion, 4);
  buffer.writeUInt32BE(nodeCount, 8);
  buffer.writeUInt32BE(domainCount, 12);

  let writeOffset = 16;
  for (const node of queue) {
    buffer.writeUInt8(node.isTerminal ? 1 : 0, writeOffset);
    writeOffset += 1;

    buffer.writeUInt32BE(node.children.size, writeOffset);
    writeOffset += 4;

    const labels = Array.from(node.children.keys()).sort();
    for (const label of labels) {
      const child = node.children.get(label)!;
      const labelBytes = Buffer.from(label, 'utf-8');

      buffer.writeUInt16BE(labelBytes.length, writeOffset);
      writeOffset += 2;

      labelBytes.copy(buffer, writeOffset);
      writeOffset += labelBytes.length;

      buffer.writeUInt32BE(child.bfsOffset, writeOffset);
      writeOffset += 4;
    }
  }

  return buffer;
}

// ────────────────────────────────────────────────────────────────────────────
// Bloom Filter implementation (64-bit BigInt FNV hashes)
// ────────────────────────────────────────────────────────────────────────────

export function fnv1a64(str: string): bigint {
  const buf = Buffer.from(str, "utf-8");
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < buf.length; i++) {
    hash = hash ^ BigInt(buf[i]);
    hash = (hash * prime) & mask;
  }
  return hash;
}

export function fnv164(str: string): bigint {
  const buf = Buffer.from(str, "utf-8");
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < buf.length; i++) {
    hash = (hash * prime) & mask;
    hash = hash ^ BigInt(buf[i]);
  }
  return hash;
}

export function bloomDoubleHash(s: string): [bigint, bigint] {
  const v1 = fnv1a64(s);
  let v2 = fnv164(s);
  if (v2 % 2n === 0n) {
    v2 += 1n;
  }
  return [v1, v2];
}

export function getBloomHash(domain: string, i: number, bitCount: bigint): bigint {
  const [h1, h2] = bloomDoubleHash(domain);
  const mask = (1n << 64n) - 1n;
  const hashVal = (h1 + BigInt(i) * h2) & mask;
  return hashVal % bitCount;
}

export function optimalBloomParams(expectedItems: number, fpRate: number = 0.001): { bitCount: bigint; hashCount: number } {
  if (expectedItems <= 0) expectedItems = 1;
  const n = expectedItems;
  const ln2 = Math.LN2;
  const m = -n * Math.log(fpRate) / (ln2 * ln2);
  const k = (m / n) * ln2;

  let bitCount = Math.ceil(m);
  let hashCount = Math.max(Math.ceil(k), 1);

  if (bitCount % 8 !== 0) {
    bitCount = (Math.floor(bitCount / 8) + 1) * 8;
  }

  return {
    bitCount: BigInt(bitCount),
    hashCount,
  };
}

export class BloomFilter {
  bits: Buffer;
  bitCount: bigint;
  hashCount: number;

  constructor(expectedItems: number) {
    const { bitCount, hashCount } = optimalBloomParams(expectedItems, bloomFPR);
    this.bitCount = bitCount;
    this.hashCount = hashCount;
    this.bits = Buffer.alloc(Number(bitCount / 8n));
  }

  add(domain: string) {
    domain = domain.toLowerCase().trim();
    if (domain.startsWith("*.")) {
      domain = domain.substring(2);
    }
    if (!domain) return;

    for (let i = 0; i < this.hashCount; i++) {
      const idx = getBloomHash(domain, i, this.bitCount);
      const byteIdx = Number(idx / 8n);
      const bitIdx = Number(idx % 8n);
      this.bits[byteIdx] |= (1 << bitIdx);
    }
  }

  serializeToBytes(): Buffer {
    const header = Buffer.alloc(24);
    header.writeUInt32BE(bloomMagic, 0);
    header.writeUInt32BE(bloomVersion, 4);
    header.writeBigUInt64BE(this.bitCount, 8);
    header.writeUInt32BE(this.hashCount, 16);
    // bytes 20-24 are 0-padded

    return Buffer.concat([header, this.bits]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────────

export async function compileFilterList(name: string, url: string): Promise<CompileResult> {
  const startTime = Date.now();
  console.log(`[${name}] ▶ Starting compilation: ${url}`);

  const { domains, cssRules, scriptlets } = await downloadAndParseDomains(url);
  console.log(`[${name}] ✓ Parsed ${domains.length} domains, ${cssRules.length} CSS rules, ${scriptlets.length} scriptlets in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  if (domains.length === 0 && cssRules.length === 0 && scriptlets.length === 0) {
    throw new Error("No domains, CSS rules, or scriptlets found in filter list");
  }

  let trieBytes: Buffer | null = null;
  if (domains.length > 0) {
    const root = new TrieNode();
    for (const domain of domains) {
      root.insert(domain);
    }
    trieBytes = serializeTrieToBytes(root);
    console.log(`[${name}] ✓ Trie built: ${root.countNodes()} nodes (${trieBytes.length} bytes)`);
  }

  let bloomBytes: Buffer | null = null;
  if (domains.length > 0) {
    const bf = new BloomFilter(domains.length);
    for (const domain of domains) {
      bf.add(domain);
    }
    bloomBytes = bf.serializeToBytes();
    console.log(`[${name}] ✓ Bloom Filter built: ${bf.bitCount} bits, ${bf.hashCount} hashes (${bloomBytes.length} bytes)`);
  }

  let cssBytes: Buffer | null = null;
  if (cssRules.length > 0) {
    cssBytes = Buffer.from(cssRules.join('\n') + '\n', 'utf-8');
    console.log(`[${name}] ✓ CSS built: ${cssRules.length} rules (${cssBytes.length} bytes)`);
  }

  let scriptletBytes: Buffer | null = null;
  if (scriptlets.length > 0) {
    scriptletBytes = Buffer.from(scriptlets.join('\n') + '\n', 'utf-8');
    console.log(`[${name}] ✓ Scriptlets built: ${scriptlets.length} rules (${scriptletBytes.length} bytes)`);
  }

  const info = {
    name,
    url,
    ruleCount: domains.length,
    updatedAt: new Date().toISOString(),
  };
  const infoBytes = Buffer.from(JSON.stringify(info, null, 2), 'utf-8');

  // ZIP Creation
  const zip = new JSZip();
  if (trieBytes) zip.file(`${name}.trie`, trieBytes);
  if (bloomBytes) zip.file(`${name}.bloom`, bloomBytes);
  if (cssBytes) zip.file(`${name}.css`, cssBytes);
  if (scriptletBytes) zip.file(`${name}.scriptlets`, scriptletBytes);
  zip.file("info.json", infoBytes);

  const zipData = await zip.generateAsync({ type: "nodebuffer" });
  console.log(`[${name}] ✅ Compilation complete: ${domains.length} rules, ${zipData.length} bytes zip package`);

  return {
    zipData,
    ruleCount: domains.length,
    fileSize: zipData.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// URL Validation
// ────────────────────────────────────────────────────────────────────────────

export async function validateFilterListURL(url: string): Promise<void> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must use http:// or https:// scheme");
  }

  // Stage 2: Content-Type Check (HEAD request)
  try {
    const headResp = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (headResp.status >= 400) {
      throw new Error(`URL returned HTTP ${headResp.status}`);
    }
    const ct = headResp.headers.get("content-type")?.toLowerCase() || "";
    const mediaType = ct.split(";")[0].trim();
    
    const rejectedTypes = ["text/html", "application/json", "application/xml", "text/xml"];
    const rejectedPrefixes = ["image/", "video/", "audio/", "application/zip", "application/pdf"];
    
    if (rejectedTypes.includes(mediaType) || rejectedPrefixes.some(p => mediaType.startsWith(p))) {
      throw new Error(`Content-Type is ${mediaType}; expected a plain text filter list`);
    }
  } catch (err: any) {
    // If HEAD fails, fallback to GET sniffing
  }

  // Stage 3: Content Sniffing (GET request)
  const resp = await fetch(url, {
    headers: { Range: "bytes=0-16383" },
    signal: AbortSignal.timeout(15000),
  });

  let responseText = "";
  if (resp.status === 206 || resp.ok) {
    responseText = await resp.text();
  } else {
    // Fallback to normal GET if range request failed
    const fallbackResp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!fallbackResp.ok) {
      throw new Error(`URL returned HTTP ${fallbackResp.status}`);
    }
    responseText = await fallbackResp.text();
  }

  const chunk = responseText.slice(0, 16384);
  if (!chunk.trim()) {
    throw new Error("URL returned empty response body");
  }

  const lowerChunk = chunk.trim().toLowerCase();
  if (lowerChunk.startsWith("<!doctype") || lowerChunk.startsWith("<html") || lowerChunk.startsWith("<head")) {
    throw new Error("URL contains HTML, not a filter list");
  }

  // Scan lines for ad-blocking heuristics
  const lines = chunk.split(/\r?\n/).slice(0, 300);
  let matched = false;
  let plainDomainCount = 0;
  const plainDomainThreshold = 3;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (
      trimmed.startsWith("[Adblock Plus") ||
      trimmed.startsWith("[Adblock") ||
      trimmed.startsWith("! Title:") ||
      trimmed.startsWith("! Homepage:") ||
      trimmed.startsWith("! Last modified:") ||
      trimmed.startsWith("# Title:") ||
      trimmed.startsWith("# Description:") ||
      trimmed.startsWith("# Homepage:") ||
      trimmed.startsWith("# Expires:") ||
      trimmed.startsWith("# Syntax:") ||
      trimmed.startsWith("# Version:") ||
      trimmed.startsWith("# License:") ||
      trimmed.startsWith("# Number of entries:") ||
      trimmed.startsWith("#Number of Entries:") ||
      trimmed.startsWith("# Last Updated:") ||
      trimmed.startsWith("#Last Updated:") ||
      trimmed.startsWith("Created using") ||
      trimmed.startsWith("0.0.0.0 ") ||
      trimmed.startsWith("0.0.0.0\t") ||
      trimmed.startsWith("127.0.0.1 ") ||
      trimmed.startsWith("127.0.0.1\t") ||
      trimmed.startsWith("||") ||
      trimmed.startsWith("@@||") ||
      (trimmed.includes("##") && !trimmed.startsWith("#"))
    ) {
      matched = true;
      break;
    }
    
    // Plain domain detection (Hagezi domain-list format)
    if (
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("!") &&
      trimmed.includes(".") &&
      !/[\s\t]/.test(trimmed)
    ) {
      plainDomainCount++;
      if (plainDomainCount >= plainDomainThreshold) {
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    throw new Error("URL does not contain recognizable ad-blocking filter list syntax");
  }
}

export function deriveNameFromURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL);
    if (!parsed.hostname) return "filter";
    
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (host.startsWith("raw.")) host = host.slice(4);
    if (host.startsWith("cdn.")) host = host.slice(4);
    
    const suffixes = [
      ".githubusercontent.com",
      ".github.io",
      ".jsdelivr.net",
      ".gitlab.io",
    ];
    for (const suffix of suffixes) {
      if (host.endsWith(suffix)) {
        host = host.slice(0, -suffix.length);
        break;
      }
    }
    
    const dotIdx = host.lastIndexOf('.');
    if (dotIdx > 0) {
      host = host.slice(0, dotIdx);
    }
    
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const skipSegments = new Set(["raw", "master", "main", "latest", "refs", "heads", "gh", "download", "downloads", "extension"]);
    const meaningful: string[] = [];
    
    for (const part of pathParts) {
      let seg = part.toLowerCase();
      const extensions = [".txt", ".csv", ".hosts", ".list", ".php"];
      for (const ext of extensions) {
        if (seg.endsWith(ext)) {
          seg = seg.slice(0, -ext.length);
        }
      }
      if (!seg || skipSegments.has(seg)) {
        continue;
      }
      meaningful.push(seg);
    }
    
    const parts: string[] = [];
    const hostClean = host.replace(/[\.-]/g, "_");
    if (hostClean) {
      parts.push(hostClean);
    }
    
    const maxSegments = 3;
    const pathSegments = meaningful.slice(-maxSegments);
    parts.push(...pathSegments);
    
    const hash = crypto.createHash("sha256").update(rawURL).digest("hex");
    const shortHash = hash.slice(0, 8);
    
    if (parts.length === 0) {
      return "filter_" + shortHash;
    }
    
    const name = parts.join("_").replace(/[\.\-\s@]/g, "_");
    return name + "_" + shortHash;
  } catch (err) {
    return "filter";
  }
}

export function sanitizeName(name: string): string {
  name = name.trim();
  let clean = "";
  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    if (/[a-zA-Z0-9_\-]/.test(char)) {
      clean += char;
    } else if (char === " ") {
      clean += "_";
    }
  }
  return clean;
}
