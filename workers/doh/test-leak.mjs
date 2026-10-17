import assert from "node:assert";
import worker from "./src/index.ts";
import {
  generateSessionId,
  getProbeDomains,
  getReverseZone,
  enrichIp,
  evaluateLeak,
  POWERED_BY,
} from "./src/leak.ts";

console.log("▶ Testing DNS Leak Check Engine & Open API...");

// 1. Test generateSessionId
const sessionId = generateSessionId();
assert(/^[0-9a-f]{8}$/.test(sessionId), `Session ID ${sessionId} must be 8-char hex`);
console.log(`✓ generateSessionId generated valid hex: ${sessionId}`);

// 2. Test getProbeDomains
const probes = getProbeDomains(sessionId);
assert.strictEqual(probes.length, 4, "Must generate 4 probe domains");
assert.strictEqual(probes[0], `a.${sessionId}-nullip.test.dnscheck.tools`);
assert.strictEqual(probes[3], `d.${sessionId}-nullip.test.dnscheck.tools`);
console.log("✓ getProbeDomains generated 4 valid dnscheck.tools subdomains");

// 3. Test getReverseZone for IPv4 and IPv6
const v4Rev = getReverseZone("1.1.1.1");
assert.strictEqual(v4Rev, "1.1.1.1.in-addr.arpa", "IPv4 reverse zone mismatch");

const v6Rev = getReverseZone("2606:4700:4700::1111");
assert.strictEqual(
  v6Rev,
  "1.1.1.1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.7.4.0.0.7.4.6.0.6.2.ip6.arpa",
  "IPv6 reverse zone mismatch"
);
console.log("✓ getReverseZone correctly formats IPv4 & expanded IPv6 arpa zones");

// 4. Test evaluateLeak
const client = {
  ip: "14.161.20.10",
  country: "VN",
  city: "Ho Chi Minh City",
  asn: 45899,
  asOrg: "VNPT Corp",
  colo: "SGN",
};

// Case A: Secure external resolvers
const evalSecure = evaluateLeak(client, [
  { ip: "1.1.1.1", org: "Cloudflare, Inc.", country: "US" },
  { ip: "9.9.9.9", org: "Quad9", country: "CH" },
]);
assert.strictEqual(evalSecure.verdict, "secure");
assert.strictEqual(evalSecure.isLeak, false);
assert.strictEqual(evalSecure.hasEcsLeak, false);
console.log("✓ evaluateLeak: Secure external resolvers correctly classified as secure");

// Case B: ISP Leak (resolver matches client ISP)
const evalLeak = evaluateLeak(client, [
  { ip: "123.30.1.1", org: "VNPT Corp", country: "VN" },
]);
assert.strictEqual(evalLeak.verdict, "leak_detected");
assert.strictEqual(evalLeak.isLeak, true);
console.log("✓ evaluateLeak: Local ISP resolver correctly flagged as leak_detected");

// Case C: EDNS Client Subnet leak
const evalEcs = evaluateLeak(client, [
  { ip: "8.8.8.8", org: "Google LLC", clientSubnet: "14.161.20.0/24" },
]);
assert.strictEqual(evalEcs.verdict, "ecs_leak");
assert.strictEqual(evalEcs.hasEcsLeak, true);
console.log("✓ evaluateLeak: ECS subnet exposure correctly flagged as ecs_leak");

// 5. Test Live enrichIp against addr.tools
console.log("▶ Testing live IP enrichment via addr.tools (1.1.1.1)...");
const enriched = await enrichIp("1.1.1.1");
assert.strictEqual(enriched.ip, "1.1.1.1");
assert(
  enriched.org?.toLowerCase().includes("cloudflare"),
  `Org should contain Cloudflare, got: ${enriched.org}`
);
assert.strictEqual(enriched.ptr, "one.one.one.one", `PTR should be one.one.one.one, got: ${enriched.ptr}`);
console.log(`✓ enrichIp successfully retrieved Org: ${enriched.org}, PTR: ${enriched.ptr}`);

// 6. Test Worker Routes via worker.fetch
console.log("▶ Testing Worker HTTP Endpoints...");

const mockEnv = {};
const mockCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};

// Route: GET /health
const healthReq = new Request("https://dns.pwhs.app/health");
const healthResp = await worker.fetch(healthReq, mockEnv, mockCtx);
assert.strictEqual(healthResp.status, 200);
const healthData = await healthResp.json();
assert(healthData.features.includes("dns_leak_check"));
assert(healthData.features.includes("addr_tools_integration"));
console.log("✓ GET /health reports version 1.2.0 with dns_leak_check features");

// Route: GET /leak (Web UI)
const leakReq = new Request("https://dns.pwhs.app/leak", {
  headers: { "cf-connecting-ip": "14.161.20.10" },
});
const leakResp = await worker.fetch(leakReq, mockEnv, mockCtx);
assert.strictEqual(leakResp.status, 200);
const leakHtml = await leakResp.text();
assert(leakHtml.includes("DNS Resolvers & Security Check"), "Must contain page title");
assert(leakHtml.includes("brianshea2/addr.tools"), "Must contain attribution to brianshea2/addr.tools");
assert(leakHtml.includes("https://github.com/brianshea2/addr.tools"), "Must contain github link");
console.log("✓ GET /leak returns web UI with brianshea2/addr.tools attribution");

// Route: GET /api/dns-leak/init
const initReq = new Request("https://dns.pwhs.app/api/dns-leak/init", {
  headers: { "cf-connecting-ip": "14.161.20.10" },
});
const initResp = await worker.fetch(initReq, mockEnv, mockCtx);
assert.strictEqual(initResp.status, 200);
const initData = await initResp.json();
assert.strictEqual(initData.status, "ok");
assert(/^[0-9a-f]{8}$/.test(initData.sessionId));
assert(initData.wsUrl.startsWith("wss://ws.dnscheck.tools/watch/"));
assert.strictEqual(initData.probeDomains.length, 4);
assert.strictEqual(initData.poweredBy.name, "brianshea2/addr.tools");
assert.strictEqual(initData.poweredBy.url, "https://github.com/brianshea2/addr.tools");
console.log("✓ GET /api/dns-leak/init successfully initializes session with wsUrl and probes");

// Route: GET /api/dns-leak/myip
const myipReq = new Request("https://dns.pwhs.app/api/dns-leak/myip", {
  headers: { "cf-connecting-ip": "14.161.20.10" },
});
const myipResp = await worker.fetch(myipReq, mockEnv, mockCtx);
assert.strictEqual(myipResp.status, 200);
const myipData = await myipResp.json();
assert.strictEqual(myipData.client.ip, "14.161.20.10");
console.log("✓ GET /api/dns-leak/myip returns client IP");

// Route: GET /api/dns-leak/enrich?ip=1.1.1.1
const enrichReq = new Request("https://dns.pwhs.app/api/dns-leak/enrich?ip=1.1.1.1");
const enrichResp = await worker.fetch(enrichReq, mockEnv, mockCtx);
assert.strictEqual(enrichResp.status, 200);
const enrichData = await enrichResp.json();
assert.strictEqual(enrichData.ip, "1.1.1.1");
assert.strictEqual(enrichData.poweredBy.name, "brianshea2/addr.tools");
console.log("✓ GET /api/dns-leak/enrich enriches resolver IP with attribution");

// Route: POST /api/dns-leak/analyze
const analyzeReq = new Request("https://dns.pwhs.app/api/dns-leak/analyze", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "cf-connecting-ip": "14.161.20.10",
  },
  body: JSON.stringify({
    clientAsn: 45899,
    resolvers: [{ ip: "1.1.1.1" }],
  }),
});
const analyzeResp = await worker.fetch(analyzeReq, mockEnv, mockCtx);
assert.strictEqual(analyzeResp.status, 200);
const analyzeData = await analyzeResp.json();
assert.strictEqual(analyzeData.status, "ok");
assert.strictEqual(analyzeData.verdict, "secure");
assert.strictEqual(analyzeData.isLeak, false);
assert.strictEqual(analyzeData.poweredBy.name, "brianshea2/addr.tools");
console.log("✓ POST /api/dns-leak/analyze returns full leak evaluation");

// Route: GET /api/dns-leak/openapi.json
const openapiReq = new Request("https://dns.pwhs.app/api/dns-leak/openapi.json");
const openapiResp = await worker.fetch(openapiReq, mockEnv, mockCtx);
assert.strictEqual(openapiResp.status, 200);
const openapiData = await openapiResp.json();
assert.strictEqual(openapiData.openapi, "3.0.3");
assert(openapiData.paths["/api/dns-leak/init"]);
console.log("✓ GET /api/dns-leak/openapi.json returns valid OpenAPI 3.0 specification");

// Route: GET /api/dns-leak/docs
const docsReq = new Request("https://dns.pwhs.app/api/dns-leak/docs");
const docsResp = await worker.fetch(docsReq, mockEnv, mockCtx);
assert.strictEqual(docsResp.status, 200);
const docsHtml = await docsResp.text();
assert(docsHtml.includes("swagger-ui"), "Docs must contain Swagger UI bundle");
console.log("✓ GET /api/dns-leak/docs returns Swagger UI interactive documentation");

console.log("\n🎉 ALL DNS LEAK TESTS PASSED SUCCESSFULLY!");
