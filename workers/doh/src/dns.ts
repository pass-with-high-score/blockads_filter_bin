/**
 * Minimal, zero-dependency DNS Wire Format parser and generator (RFC 1035 / RFC 8484)
 */

export interface ParsedDnsQuery {
  id: number;
  name: string;
  type: number;
  class: number;
  questionEndOffset: number;
}

export const DNS_TYPES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  HTTPS: 65,
  ANY: 255,
} as const;

/**
 * Decode base64url string to Uint8Array (RFC 8484)
 */
export function base64UrlToUint8Array(base64url: string): Uint8Array {
  // Convert base64url to regular base64
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parse a raw DNS wire format packet (RFC 1035)
 */
export function parseDnsQuery(buffer: Uint8Array): ParsedDnsQuery | null {
  if (buffer.length < 12) return null;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const id = view.getUint16(0);
  const qdcount = view.getUint16(4);
  if (qdcount < 1) return null;

  let offset = 12;
  const labels: string[] = [];

  while (offset < buffer.length) {
    const len = buffer[offset++];
    if (len === 0) break; // End of QNAME

    // Pointers not expected in standard query QNAME, but safeguard against them
    if ((len & 0xc0) === 0xc0) {
      offset++; // skip pointer byte
      break;
    }

    if (offset + len > buffer.length) return null;

    let label = "";
    for (let i = 0; i < len; i++) {
      label += String.fromCharCode(buffer[offset++]);
    }
    labels.push(label.toLowerCase());
  }

  if (offset + 4 > buffer.length) return null;

  const type = view.getUint16(offset);
  const qclass = view.getUint16(offset + 2);
  const questionEndOffset = offset + 4;

  return {
    id,
    name: labels.join("."),
    type,
    class: qclass,
    questionEndOffset,
  };
}

/**
 * Synthesizes a blocked DNS response (0.0.0.0, ::, NODATA, or NXDOMAIN)
 */
export function createBlockedResponse(
  queryBuffer: Uint8Array,
  query: ParsedDnsQuery,
  blockMode: "zero" | "nxdomain" = "zero",
  ttl = 300
): Uint8Array {
  const isA = query.type === DNS_TYPES.A;
  const isAAAA = query.type === DNS_TYPES.AAAA;

  // NXDOMAIN Mode: Returns RCODE 3 (Name Error) with 0 answers
  if (blockMode === "nxdomain") {
    const resp = new Uint8Array(query.questionEndOffset);
    resp.set(queryBuffer.subarray(0, query.questionEndOffset));

    const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
    // Flags: QR=1 (response), AA=1, RD=1, RA=1, RCODE=3 (NXDOMAIN) -> 0x8183
    view.setUint16(2, 0x8183);
    view.setUint16(4, 1); // QDCOUNT
    view.setUint16(6, 0); // ANCOUNT
    view.setUint16(8, 0); // NSCOUNT
    view.setUint16(10, 0); // ARCOUNT
    return resp;
  }

  // ZERO Sinkhole Mode:
  // For A: answer 0.0.0.0 (4 bytes)
  // For AAAA: answer :: (16 bytes)
  // For others (HTTPS, TXT): return NOERROR with 0 answers (NODATA)
  if (!isA && !isAAAA) {
    const resp = new Uint8Array(query.questionEndOffset);
    resp.set(queryBuffer.subarray(0, query.questionEndOffset));
    const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
    // Flags: QR=1, AA=1, RD=1, RA=1, RCODE=0 (NOERROR, NODATA) -> 0x8180
    view.setUint16(2, 0x8180);
    view.setUint16(4, 1);
    view.setUint16(6, 0);
    view.setUint16(8, 0);
    view.setUint16(10, 0);
    return resp;
  }

  const rdataLen = isA ? 4 : 16;
  const answerLen = 2 + 2 + 2 + 4 + 2 + rdataLen; // pointer(2) + type(2) + class(2) + ttl(4) + rdlen(2) + rdata
  const totalLen = query.questionEndOffset + answerLen;

  const resp = new Uint8Array(totalLen);
  resp.set(queryBuffer.subarray(0, query.questionEndOffset));

  const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);

  // Flags: QR=1, AA=1, RD=1, RA=1, RCODE=0 (NoError) -> 0x8180
  view.setUint16(2, 0x8180);
  view.setUint16(4, 1); // QDCOUNT
  view.setUint16(6, 1); // ANCOUNT = 1
  view.setUint16(8, 0); // NSCOUNT
  view.setUint16(10, 0); // ARCOUNT

  let offset = query.questionEndOffset;

  // Answer Section:
  // Name: pointer to QNAME at byte 12 (0xc00c)
  view.setUint16(offset, 0xc00c);
  offset += 2;

  // Type: A (1) or AAAA (28)
  view.setUint16(offset, query.type);
  offset += 2;

  // Class: IN (1)
  view.setUint16(offset, 1);
  offset += 2;

  // TTL (e.g. 300 seconds)
  view.setUint32(offset, ttl);
  offset += 4;

  // RDLENGTH
  view.setUint16(offset, rdataLen);
  offset += 2;

  // RDATA (all zeros: 0.0.0.0 or ::)
  resp.fill(0, offset, offset + rdataLen);

  return resp;
}

/**
 * Strips EDNS Client Subnet (ECS, option code 8, RFC 7871) from DNS query packets
 * to prevent leaking the user's client IP / location to upstream resolvers.
 */
export function stripEcs(queryBuffer: Uint8Array): Uint8Array {
  if (queryBuffer.length < 12) return queryBuffer;

  const view = new DataView(queryBuffer.buffer, queryBuffer.byteOffset, queryBuffer.byteLength);
  const arcount = view.getUint16(10);
  if (arcount === 0) return queryBuffer;

  const parsed = parseDnsQuery(queryBuffer);
  if (!parsed) return queryBuffer;

  let offset = parsed.questionEndOffset;

  // Check if Additional Section starts with an OPT record (RFC 6891)
  // Root domain (1 byte: 0x00) + Type OPT (2 bytes: 41 / 0x0029)
  if (offset + 11 > queryBuffer.length) return queryBuffer;
  if (queryBuffer[offset] !== 0) return queryBuffer; // Not root name
  const optType = view.getUint16(offset + 1);
  if (optType !== 41) return queryBuffer; // Not OPT RR

  const udpPayloadSize = view.getUint16(offset + 3);
  const extRcodeFlags = view.getUint32(offset + 5);
  const rdlength = view.getUint16(offset + 9);
  const rdataStart = offset + 11;
  const rdataEnd = rdataStart + rdlength;

  if (rdataEnd > queryBuffer.length) return queryBuffer;

  // Scan for ECS option (code 8) inside OPT RDATA
  let hasEcs = false;
  let optOffset = rdataStart;
  const filteredOptions: Uint8Array[] = [];

  while (optOffset + 4 <= rdataEnd) {
    const code = view.getUint16(optOffset);
    const len = view.getUint16(optOffset + 2);
    const optTotalLen = 4 + len;

    if (optOffset + optTotalLen > rdataEnd) break;

    if (code === 8) {
      // Found EDNS Client Subnet option! Strip it!
      hasEcs = true;
    } else {
      filteredOptions.push(queryBuffer.subarray(optOffset, optOffset + optTotalLen));
    }
    optOffset += optTotalLen;
  }

  if (!hasEcs) {
    return queryBuffer; // No ECS option found, return unchanged
  }

  // If no other options remain, we can simply drop the OPT record (set ARCOUNT=0 and truncate)
  if (filteredOptions.length === 0) {
    const clean = new Uint8Array(parsed.questionEndOffset);
    clean.set(queryBuffer.subarray(0, parsed.questionEndOffset));
    const cleanView = new DataView(clean.buffer, clean.byteOffset, clean.byteLength);
    cleanView.setUint16(10, 0); // ARCOUNT = 0
    return clean;
  }

  // Rebuild OPT record without ECS option
  let newRdlength = 0;
  for (const opt of filteredOptions) {
    newRdlength += opt.length;
  }

  const newTotalLen = parsed.questionEndOffset + 11 + newRdlength;
  const clean = new Uint8Array(newTotalLen);
  clean.set(queryBuffer.subarray(0, parsed.questionEndOffset));

  let outOffset = parsed.questionEndOffset;
  const cleanView = new DataView(clean.buffer, clean.byteOffset, clean.byteLength);
  clean[outOffset++] = 0; // Root name
  cleanView.setUint16(outOffset, 41); // OPT type
  outOffset += 2;
  cleanView.setUint16(outOffset, udpPayloadSize);
  outOffset += 2;
  cleanView.setUint32(outOffset, extRcodeFlags);
  outOffset += 4;
  cleanView.setUint16(outOffset, newRdlength);
  outOffset += 2;

  for (const opt of filteredOptions) {
    clean.set(opt, outOffset);
    outOffset += opt.length;
  }

  return clean;
}

/**
 * Replaces the 2-byte Transaction ID in a DNS packet.
 * Used for edge caching to match the client's query ID.
 */
export function replaceTransactionId(buffer: Uint8Array, newId: number): Uint8Array {
  const copy = new Uint8Array(buffer.length);
  copy.set(buffer);
  copy[0] = (newId >> 8) & 0xff;
  copy[1] = newId & 0xff;
  return copy;
}

/**
 * Extracts minimum TTL (in seconds) from DNS response answers for edge caching.
 */
export function extractMinTtl(buffer: Uint8Array, defaultTtl = 120): number {
  if (buffer.length < 12) return defaultTtl;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const ancount = view.getUint16(6);
  if (ancount === 0) return defaultTtl;

  const parsed = parseDnsQuery(buffer);
  if (!parsed) return defaultTtl;

  let offset = parsed.questionEndOffset;
  let minTtl = 86400;

  for (let i = 0; i < ancount && offset < buffer.length; i++) {
    // Skip NAME (could be labels or pointer 0xc0..)
    while (offset < buffer.length) {
      const len = buffer[offset];
      if ((len & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset++;
      if (len === 0) break;
      offset += len;
    }

    if (offset + 10 > buffer.length) break;

    const ttl = view.getUint32(offset + 4);
    const rdlen = view.getUint16(offset + 8);
    offset += 10 + rdlen;

    if (ttl > 0 && ttl < minTtl) {
      minTtl = ttl;
    }
  }

  // Cap between 60 seconds and 3600 seconds
  return Math.max(60, Math.min(minTtl, 3600));
}

/**
 * Convert Uint8Array to base64url string
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

