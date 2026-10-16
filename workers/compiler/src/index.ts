import { Container } from "@cloudflare/containers";

export interface Env {
  COMPILER_CONTAINER: {
    getByName(name: string): {
      fetch(req: Request): Promise<Response>;
    };
  };
  DATABASE_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export class CompilerContainer extends Container<Env> {
  defaultPort = 8080;
  enableInternet = true;
  sleepAfter = "10m";

  constructor(ctx: any, env: Env) {
    super(ctx, env);
    this.envVars = {
      DATABASE_URL: env.DATABASE_URL || "",
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID || "",
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID || "",
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY || "",
      R2_BUCKET_NAME: env.R2_BUCKET_NAME || "blockads-filters",
      R2_PUBLIC_URL: env.R2_PUBLIC_URL || "https://filter.pwhs.app",
      PORT: "8080",
      ENVIRONMENT: "production",
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || "",
      TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID || "",
    };
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "blockads-compiler-container", version: "1.0.2" });
    }

    try {
      // Forward all compilation requests to the Go container
      const container = env.COMPILER_CONTAINER.getByName("default");
      return await container.fetch(req);
    } catch (err: any) {
      console.error("[Container Worker] Proxy error:", err);
      return Response.json(
        { status: "error", message: `Container proxy error: ${err.message}` },
        { status: 500 }
      );
    }
  },
};
