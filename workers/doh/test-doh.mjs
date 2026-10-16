import assert from "node:assert";
import { parseDnsQuery, createBlockedResponse, DNS_TYPES } from "./src/dns.ts";
import { isDomainBlocked } from "./src/blocklist.ts";

console.log("▶ Testing DoH DNS parser & blocklist...");

// 1. Build a synthetic A query for "ad.doubleclick.net"
// Header: ID=0x1234, Flags=0x0100 (RD=1), QDCOUNT=1, ANCOUNT=0, NSCOUNT=0, ARCOUNT=0
const qnameBytes = [
  2, 0x61, 0x64, // "ad"
  11, 0x64, 0x6f, 0x75, 0x62, 0x6c, 0x65, 0x63, 0x6c, 0x69, 0x63, 0x6b, // "doubleclick"
  3, 0x6e, 0x65, 0x74, // "net"
  0 // null terminator
];
const queryPacket = new Uint8Array([
  0x12, 0x34, // ID
  0x01, 0x00, // Flags (RD=1)
  0x00, 0x01, // QDCOUNT=1
  0x00, 0x00, // ANCOUNT=0
  0x00, 0x00, // NSCOUNT=0
  0x00, 0x00, // ARCOUNT=0
  ...qnameBytes,
  0x00, 0x01, // QTYPE=A (1)
  0x00, 0x01  // QCLASS=IN (1)
]);

// Test parseDnsQuery
const parsed = parseDnsQuery(queryPacket);
assert(parsed !== null, "parseDnsQuery returned null");
assert.strictEqual(parsed.id, 0x1234, "ID mismatch");
assert.strictEqual(parsed.name, "ad.doubleclick.net", "QNAME mismatch");
assert.strictEqual(parsed.type, DNS_TYPES.A, "QTYPE mismatch");
console.log("✓ parseDnsQuery parsed 'ad.doubleclick.net' successfully");

// Test isDomainBlocked
const blocklist = new Set(["doubleclick.net", "tracking.com"]);
assert.strictEqual(isDomainBlocked("ad.doubleclick.net", blocklist), true, "Subdomain should be blocked");
assert.strictEqual(isDomainBlocked("sub.ad.doubleclick.net", blocklist), true, "Deep subdomain should be blocked");
assert.strictEqual(isDomainBlocked("doubleclick.net", blocklist), true, "Exact domain should be blocked");
assert.strictEqual(isDomainBlocked("google.com", blocklist), false, "Non-blocked domain should be allowed");
assert.strictEqual(isDomainBlocked("notdoubleclick.net", blocklist), false, "Partial suffix match must NOT be blocked");
console.log("✓ isDomainBlocked accurate with subdomain hierarchy matching");

// Test createBlockedResponse in ZERO sinkhole mode
const blockedZero = createBlockedResponse(queryPacket, parsed, "zero", 300);
const zeroView = new DataView(blockedZero.buffer, blockedZero.byteOffset, blockedZero.byteLength);
assert.strictEqual(zeroView.getUint16(0), 0x1234, "Response ID mismatch");
assert.strictEqual(zeroView.getUint16(2), 0x8180, "Response Flags should be 0x8180 (NoError)");
assert.strictEqual(zeroView.getUint16(6), 1, "ANCOUNT should be 1");
// Last 4 bytes should be 0.0.0.0
const rdata = blockedZero.subarray(blockedZero.length - 4);
assert.deepStrictEqual(Array.from(rdata), [0, 0, 0, 0], "Sinkhole IP should be 0.0.0.0");
console.log("✓ createBlockedResponse (zero) returned valid 0.0.0.0 sinkhole answer");

// Test createBlockedResponse in NXDOMAIN mode
const blockedNx = createBlockedResponse(queryPacket, parsed, "nxdomain");
const nxView = new DataView(blockedNx.buffer, blockedNx.byteOffset, blockedNx.byteLength);
assert.strictEqual(nxView.getUint16(0), 0x1234, "NXDOMAIN ID mismatch");
assert.strictEqual(nxView.getUint16(2), 0x8183, "NXDOMAIN Flags should be 0x8183 (RCODE=3)");
assert.strictEqual(nxView.getUint16(6), 0, "ANCOUNT should be 0 for NXDOMAIN");
console.log("✓ createBlockedResponse (nxdomain) returned valid NXDOMAIN response");

console.log("🎉 All DoH tests passed cleanly!");
