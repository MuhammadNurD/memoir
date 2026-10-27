import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { IncomingMessage, ServerResponse } from "node:http";

function localApiServerPlugin(): Plugin {
  const attachMiddleware = (middlewares: {
    use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void;
  }) => {
    middlewares.use(async (req, res, next) => {
      if (!req.url || !req.url.startsWith("/api/")) {
        return next();
      }

      try {
        const { handleApiRequest } = await import("./src/server/router");
        const protocol = "http";
        const host = req.headers.host || "localhost:5173";
        const fullUrl = `${protocol}://${host}${req.url}`;

        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) {
            for (const item of v) headers.append(k, item);
          } else if (v !== undefined) {
            headers.set(k, v);
          }
        }

        const method = req.method || "GET";
        let bodyBuffer: Buffer | undefined;
        if (method !== "GET" && method !== "HEAD") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          bodyBuffer = Buffer.concat(chunks);
        }

        const webReq = new Request(fullUrl, {
          method,
          headers,
          body: bodyBuffer ? new Uint8Array(bodyBuffer) : undefined,
        });

        const webRes = await handleApiRequest(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });

        const resArrayBuffer = await webRes.arrayBuffer();
        res.end(Buffer.from(resArrayBuffer));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: err instanceof Error ? err.message : "Server error",
            },
          })
        );
      }
    });
  };

  return {
    name: "memoir-api-middleware",
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiServerPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
