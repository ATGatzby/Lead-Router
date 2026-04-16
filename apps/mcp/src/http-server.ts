import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { TokenVerifier } from "./auth/token-verifier.js";
import { LeadRoutingOAuthProvider } from "./auth/oauth-provider.js";
import type { McpConfig } from "./config.js";

export interface HttpServerOptions {
  port: number;
  host: string;
  oauthMode: boolean;
  issuerUrl?: string;
}

export async function startHttpServer(
  createServerFn: () => Server,
  config: McpConfig,
  options: HttpServerOptions,
) {
  const app = express();
  app.set("trust proxy", 1); // Trust first proxy (Caddy)
  app.use(express.json());

  const verifier = new TokenVerifier(config.appUrl);

  // Request logging for debugging
  app.use((req, _res, next) => {
    console.log(`[MCP HTTP] ${req.method} ${req.url} [${req.headers["content-type"] || "no-ct"}] auth=${req.headers["authorization"] ? "yes" : "no"}`);
    next();
  });

  // Health check — no auth required
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "http", oauth: options.oauthMode });
  });

  // OAuth routes — must be mounted BEFORE bearer auth middleware
  // MCP SDK requires HTTPS issuer URL — only enable OAuth when MCP_PUBLIC_URL is set
  const publicUrl = process.env.MCP_PUBLIC_URL || options.issuerUrl;
  if (options.oauthMode && publicUrl?.startsWith("https://")) {
    const oauthProvider = new LeadRoutingOAuthProvider(config.appUrl);

    app.use(mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(publicUrl),
      scopesSupported: ["read", "route", "agent"],
      serviceDocumentationUrl: new URL(config.appUrl),
    }));

    console.log(`[OAuth] Issuer URL: ${publicUrl}`);
  } else if (options.oauthMode) {
    console.log("[OAuth] Skipped — MCP_PUBLIC_URL not set or not HTTPS. MCP running without OAuth.");
  }

  // Bearer auth middleware for MCP routes
  const authMiddleware = requireBearerAuth({ verifier });

  // Per-session transport + server map for stateful sessions
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, Server>();

  // MCP endpoint — handles POST (messages), GET (SSE stream), DELETE (session close)
  // Mounted on both / and /mcp — Claude.ai sends to /, other clients may use /mcp
  app.all("/mcp", authMiddleware, mcpHandler);
  app.all("/", authMiddleware, mcpHandler);

  async function mcpHandler(req: any, res: any) {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        // Existing session
        transport = transports.get(sessionId)!;
      } else if (!sessionId && req.method === "POST") {
        // New session — create NEW server + transport pair
        const sessionServer = createServerFn();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            servers.set(id, sessionServer);
          },
        });

        // Clean up on close
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
            servers.delete(sid);
          }
        };

        await sessionServer.connect(transport);
      } else if (sessionId && !transports.has(sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      } else {
        res.status(400).json({ error: "Bad request" });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[MCP HTTP] Error handling request:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error", details: String(err) });
      }
    }
  }

  // Global error handler — catch anything the SDK middleware throws
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[MCP HTTP] Unhandled error:", err?.message || err, err?.stack?.split("\n").slice(0, 3).join("\n"));
    if (!res.headersSent) {
      res.status(500).json({ error: "server_error", error_description: err?.message || "Internal Server Error" });
    }
  });

  // Catch-all for unmatched routes
  app.use((_req: any, res: any) => {
    console.log(`[MCP HTTP] 404: ${_req.method} ${_req.url}`);
    res.status(404).json({ error: "not_found" });
  });

  app.listen(options.port, options.host, () => {
    console.log(
      `MCP HTTP server listening on http://${options.host}:${options.port}/mcp`,
    );
    console.log(
      `Health check: http://${options.host}:${options.port}/health`,
    );
    if (options.oauthMode) {
      console.log(
        "OAuth enabled — discovery at /.well-known/oauth-authorization-server",
      );
    }
  });
}
