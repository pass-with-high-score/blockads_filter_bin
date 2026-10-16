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
