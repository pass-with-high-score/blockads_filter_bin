import JSZip from "jszip";
import crypto from "crypto";

// Binary format constants
const trieMagic = 0x54524945; // "TRIE"
const trieVersion = 2;
const bloomMagic = 0x424C4F4D; // "BLOM"
const bloomVersion = 1;
const bloomFPR = 0.001; // 0.1%

export interface CompileResult {
  zipData: Uint8Array;
  ruleCount: number;
  fileSize: number;
  contentHash: string;
  skipped: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Domain Parser Heuristics (High Performance)
// ────────────────────────────────────────────────────────────────────────────

export function parseDomainLine(line: string): string {
  line = line.trim();
  if (line === "") return "";
  if (line[0] === "#" || line[0] === "!") return "";
  if (line.startsWith("@@")) return "";

  // Cosmetic element-hiding, CSS injection, or scriptlet rules are never DNS domains
  if (
    line.includes("##") ||
    line.includes("#@#") ||
    line.includes("#?#") ||
    line.includes("#$#") ||
    line.includes("#%#")
  ) {
    return "";
  }

  // Support Wildcard domain format: *.example.com (HaGeZi wildcard, OISD domainswild)
  if (line.startsWith("*.")) {
    line = line.slice(2);
  }

  // dnsmasq format: server=/domain.com/ or address=/domain.com/0.0.0.0
  if (line.startsWith("server=/") || line.startsWith("address=/")) {
    const clean = line.replace(/^(server|address)=\//, "");
    const slashIdx = clean.indexOf("/");
    if (slashIdx !== -1) {
      line = clean.slice(0, slashIdx);
    }
  }

  const containsAnyUnsafe = /[\$\/\\\*]/.test(line);
  if (containsAnyUnsafe && !line.startsWith("||")) return "";

  let domain = "";
  const isABP = line.startsWith("||");

  if (isABP) {
    domain = line.slice(2);

    // Handle wildcard prefixes: ||*.example.com^ or ||*.tld^
    if (domain.startsWith("*.")) {
      domain = domain.slice(2);
    } else if (domain.startsWith("*")) {
      domain = domain.slice(1);
    }

    if (/[\/\*\?]/.test(domain)) return "";

    // Inspect options after $ (e.g. $domain=..., $third-party, $badfilter, etc.)
    const dollarIdx = domain.indexOf("$");
    if (dollarIdx !== -1) {
      const options = domain.slice(dollarIdx + 1);
      const opts = options.split(",");
      for (let opt of opts) {
        opt = opt.trim();
        if (
          opt === "" ||
          opt === "important" ||
          opt === "empty" ||
          opt === "mp4" ||
          opt === "all" ||
          opt === "popup" ||
          opt === "document" ||
          opt === "doc" ||
          opt === "dns" ||
          opt.startsWith("dnstype") ||
          opt === "cname" ||
          opt === "network" ||
          opt.startsWith("ctag") ||
          opt.startsWith("denyallow")
        ) {
          continue;
        }
        return "";
      }
      domain = domain.slice(0, dollarIdx);
    }

    const carrotIdx = domain.indexOf("^");
    if (carrotIdx !== -1) domain = domain.slice(0, carrotIdx);
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
    const hashIdx = domain.indexOf("#");
    if (hashIdx !== -1) domain = domain.slice(0, hashIdx);
  } else {
    let cleanLine = line;
    const hashIdx = cleanLine.indexOf("#");
    if (hashIdx !== -1) {
      cleanLine = cleanLine.slice(0, hashIdx).trim();
    }
    if (!/\s/.test(cleanLine) && cleanLine.includes(".")) {
      domain = cleanLine;
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

  // Reject IP addresses
  const firstChar = domain.charCodeAt(0);
  if (firstChar >= 48 && firstChar <= 57) {
    if (/^[0-9\.]+$/.test(domain)) {
      return "";
    }
  }

  // Validate valid hostname labels [a-z0-9-]
  const labels = domain.split(".");
  if (labels.length < 2 && !isABP) return "";
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return "";
    if (label.startsWith("-") || label.endsWith("-")) return "";
    if (!/^[a-z0-9-]+$/.test(label)) return "";
  }

  return domain;
}

export function parseFilterText(text: string) {
  const contentHash = crypto.createHash("sha256").update(text).digest("hex");
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

    // 1. Skip comments and empty lines
    if (rawLine.startsWith("!") || (rawLine.startsWith("#") && !rawLine.startsWith("##"))) {
      continue;
    }

    // 2. Extract Scriptlet Rules
    if (rawLine.includes("##+js(") || rawLine.includes("#%#//scriptlet(")) {
      if (!seenScriptlets.has(rawLine)) {
        seenScriptlets.add(rawLine);
        scriptlets.push(rawLine);
      }
      continue;
    }

    // 3. Extract Generic Cosmetic CSS Rules
    if (
      rawLine.startsWith("##") &&
      !rawLine.includes("##+js") &&
      !rawLine.includes("##^")
    ) {
      const selector = rawLine.slice(2).trim();
      if (selector && !seenCSS.has(selector)) {
        seenCSS.add(selector);
        cssRules.push(selector);
      }
      continue;
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
  return { domains, cssRules, scriptlets, contentHash };
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
      const labelBytes = Buffer.from(label, "utf-8");

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
      const labelBytes = Buffer.from(label, "utf-8");

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
// Bloom Filter implementation (Optimized 64-bit BigInt FNV hashes)
// ────────────────────────────────────────────────────────────────────────────

export function fnv1a64(str: string): bigint {
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash ^ BigInt(str.charCodeAt(i))) * prime) & mask;
  }
  return hash;
}

export function fnv164(str: string): bigint {
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    hash = (((hash * prime) & mask) ^ BigInt(str.charCodeAt(i)));
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

export function optimalBloomParams(
  expectedItems: number,
  fpRate: number = 0.001
): { bitCount: bigint; hashCount: number } {
  if (expectedItems <= 0) expectedItems = 1;
  const n = expectedItems;
  const ln2 = Math.LN2;
  const m = (-n * Math.log(fpRate)) / (ln2 * ln2);
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

    const [h1, h2] = bloomDoubleHash(domain);
    const mask = (1n << 64n) - 1n;

    for (let i = 0; i < this.hashCount; i++) {
      const hashVal = (h1 + BigInt(i) * h2) & mask;
      const idx = hashVal % this.bitCount;
      const byteIdx = Number(idx / 8n);
      const bitIdx = Number(idx % 8n);
      this.bits[byteIdx] |= 1 << bitIdx;
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
// Compilation Pipeline
// ────────────────────────────────────────────────────────────────────────────

export async function compileFilterFromRawText(
  name: string,
  url: string,
  text: string
): Promise<{ zipData: Uint8Array; ruleCount: number; fileSize: number; contentHash: string }> {
  const { domains, cssRules, scriptlets, contentHash } = parseFilterText(text);

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
  }

  let bloomBytes: Buffer | null = null;
  if (domains.length > 0) {
    const bf = new BloomFilter(domains.length);
    for (const domain of domains) {
      bf.add(domain);
    }
    bloomBytes = bf.serializeToBytes();
  }

  let cssBytes: Buffer | null = null;
  if (cssRules.length > 0) {
    cssBytes = Buffer.from(cssRules.join("\n") + "\n", "utf-8");
  }

  let scriptletBytes: Buffer | null = null;
  if (scriptlets.length > 0) {
    scriptletBytes = Buffer.from(scriptlets.join("\n") + "\n", "utf-8");
  }

  const info = {
    name,
    url,
    ruleCount: domains.length,
    updatedAt: new Date().toISOString(),
  };
  const infoBytes = Buffer.from(JSON.stringify(info, null, 2), "utf-8");

  const zip = new JSZip();
  if (trieBytes) zip.file(`${name}.trie`, trieBytes);
  if (bloomBytes) zip.file(`${name}.bloom`, bloomBytes);
  if (cssBytes) zip.file(`${name}.css`, cssBytes);
  if (scriptletBytes) zip.file(`${name}.scriptlets`, scriptletBytes);
  zip.file("info.json", infoBytes);

  const zipData = await zip.generateAsync({ type: "uint8array" });

  return {
    zipData,
    ruleCount: domains.length,
    fileSize: zipData.length,
    contentHash,
  };
}
