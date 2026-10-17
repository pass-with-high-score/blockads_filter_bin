/**
 * OpenAPI 3.0 Specification & Swagger UI for BlockAds DNS Leak Check
 * Powered by: brianshea2/addr.tools
 */

import { POWERED_BY } from "./leak";

export function getOpenApiSpec(host: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "BlockAds DNS Leak Check Open API",
      version: "1.0.0",
      description:
        "Open REST API for detecting DNS leaks, EDNS Client Subnet (ECS) exposure, and inspecting DNS resolvers. Powered by brianshea2/addr.tools.",
      contact: {
        name: "BlockAds Team",
        url: `https://${host}`,
      },
      "x-powered-by": POWERED_BY,
    },
    servers: [
      {
        url: `https://${host}`,
        description: "BlockAds Edge Serverless API",
      },
    ],
    paths: {
      "/api/dns-leak/init": {
        get: {
          summary: "Initialize a DNS leak test session",
          description:
            "Generates a unique 8-character hex session ID, probe subdomains to resolve, real-time WebSocket watcher URL, and client IP/ASN identity.",
          responses: {
            "200": {
              description: "Session successfully initialized",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      sessionId: { type: "string", example: "3f82a1b9" },
                      wsUrl: {
                        type: "string",
                        example: "wss://ws.dnscheck.tools/watch/3f82a1b9",
                      },
                      watchWebUrl: {
                        type: "string",
                        example: "https://dnscheck.tools/watch/3f82a1b9",
                      },
                      probeDomains: {
                        type: "array",
                        items: { type: "string" },
                        example: [
                          "a.3f82a1b9-nullip.test.dnscheck.tools",
                          "b.3f82a1b9-nullip.test.dnscheck.tools",
                          "c.3f82a1b9-nullip.test.dnscheck.tools",
                          "d.3f82a1b9-nullip.test.dnscheck.tools",
                        ],
                      },
                      dnssecSuite: {
                        type: "object",
                        description: "Full suite of DNSSEC cryptographic validation test domains (ECDSA P-256, P-384, Ed25519, MLDSA44 across badsig, expiredsig, nosig)",
                      },
                      dualStackEndpoints: {
                        type: "object",
                        properties: {
                          ipv4: { type: "string", example: "https://myipv4.addr.tools/plain" },
                          ipv6: { type: "string", example: "https://myipv6.addr.tools/plain" },
                        },
                      },
                      stunServers: {
                        type: "array",
                        items: { type: "string" },
                        example: [
                          "stun:myip.addr.tools:3478",
                          "stun:stun.l.google.com:19302",
                        ],
                      },
                      client: {
                        type: "object",
                        properties: {
                          ip: { type: "string", example: "14.161.20.10" },
                          country: { type: "string", example: "VN" },
                          city: { type: "string", example: "Ho Chi Minh City" },
                          asn: { type: "integer", example: 45899 },
                          asOrg: { type: "string", example: "VNPT Corp" },
                          colo: { type: "string", example: "SGN" },
                        },
                      },
                      poweredBy: {
                        type: "object",
                        properties: {
                          name: { type: "string", example: "brianshea2/addr.tools" },
                          url: {
                            type: "string",
                            example: "https://github.com/brianshea2/addr.tools",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/dns-leak/myip": {
        get: {
          summary: "Get current client network identity",
          description:
            "Returns the calling client's public IP, ASN, ISP name, country, city, and Cloudflare Edge colocation point.",
          responses: {
            "200": {
              description: "Client identity info",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ip: { type: "string", example: "14.161.20.10" },
                      country: { type: "string", example: "VN" },
                      city: { type: "string", example: "Ho Chi Minh City" },
                      asn: { type: "integer", example: 45899 },
                      asOrg: { type: "string", example: "VNPT Corp" },
                      colo: { type: "string", example: "SGN" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/dns-leak/enrich": {
        get: {
          summary: "Enrich a resolver IP address with Geo, Org & PTR",
          description:
            "Performs reverse DNS (PTR) lookup and ISP/Geo resolution for any given IP address via addr.tools.",
          parameters: [
            {
              name: "ip",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "The IP address of the DNS resolver to inspect",
              example: "1.1.1.1",
            },
          ],
          responses: {
            "200": {
              description: "Enriched resolver details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ip: { type: "string", example: "1.1.1.1" },
                      org: { type: "string", example: "Cloudflare, Inc." },
                      country: { type: "string", example: "US" },
                      city: { type: "string", example: "San Francisco" },
                      ptr: { type: "string", nullable: true, example: "one.one.one.one" },
                      ns: { type: "string", nullable: true, example: "cruz.ns.cloudflare.com" },
                      poweredBy: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/dns-leak/analyze": {
        post: {
          summary: "Evaluate DNS resolver list for leaks",
          description:
            "Takes client ASN and a list of detected resolver IPs, and determines whether an ISP leak or EDNS Client Subnet (ECS) exposure exists.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    clientAsn: { type: "integer", example: 45899 },
                    resolvers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          ip: { type: "string", example: "1.1.1.1" },
                          clientSubnet: { type: "string", nullable: true, example: null },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Comprehensive DNS leak verdict and breakdown",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                      verdict: { type: "string", enum: ["secure", "leak_detected", "ecs_leak"] },
                      isLeak: { type: "boolean", example: false },
                      hasEcsLeak: { type: "boolean", example: false },
                      message: { type: "string" },
                      client: { type: "object" },
                      resolvers: { type: "array", items: { type: "object" } },
                      poweredBy: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function renderSwaggerDocsHtml(host: string): string {
  const specJson = JSON.stringify(getOpenApiSpec(host));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BlockAds DNS Leak Check - API Reference</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
  <link rel="icon" type="image/svg+xml" href="https://complier.pwhs.app/icon.svg">
  <style>
    body { margin: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .topbar {
      background: #111827;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #00E676;
    }
    .topbar a { color: #ffffff; text-decoration: none; font-weight: 700; font-size: 16px; }
    .topbar a span { color: #00E676; }
    .topbar .nav-right a {
      color: #9ca3af;
      font-size: 13px;
      margin-left: 16px;
      text-decoration: none;
    }
    .topbar .nav-right a:hover { color: #ffffff; }
  </style>
</head>
<body>
  <div class="topbar">
    <a href="/leak">Block<span>Ads</span> DNS Leak API</a>
    <div class="nav-right">
      <a href="/leak">← Back to Leak Test</a>
      <a href="/api/dns-leak/openapi.json" target="_blank">Raw JSON</a>
      <a href="https://github.com/brianshea2/addr.tools" target="_blank">addr.tools ↗</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        spec: ${specJson},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}
