import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(here, "..", "oracle", "state", "evidence");

/**
 * Local demo only: the oracle keeps evidence files in oracle/state/evidence when no IPFS
 * service is configured. This serves them at /evidence/<hash>.json so the "Verify a pilot"
 * page can download one and check it against the hash stored on-chain.
 * Only names that look like a keccak256 hash are allowed (no path tricks).
 */
function localEvidence() {
  return {
    name: "flightproof-local-evidence",
    configureServer(server) {
      server.middlewares.use("/evidence", (req, res, next) => {
        const name = decodeURIComponent((req.url || "").replace(/^\//, ""));
        if (!/^0x[0-9a-f]{64}\.json$/.test(name)) return next();
        const file = path.join(EVIDENCE_DIR, name);
        if (!existsSync(file)) {
          res.statusCode = 404;
          return res.end("not found");
        }
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localEvidence()],
  server: {
    port: 5173,
    strictPort: true,
    // ABIs and deployment addresses live in ../shared
    fs: { allow: [".."] },
  },
});
