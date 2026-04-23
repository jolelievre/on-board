import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

function honoDevServer(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        // Dynamic import to pick up changes on reload
        const { default: app } = await server.ssrLoadModule(
          "./src/server/app.ts",
        );

        const request = new Request(
          new URL(req.url, `http://${req.headers.host}`),
          {
            method: req.method,
            headers: req.headers as Record<string, string>,
          },
        );

        const response = await app.fetch(request);

        res.statusCode = response.status;
        response.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value);
        });
        const body = await response.text();
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), honoDevServer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist/client",
  },
});
