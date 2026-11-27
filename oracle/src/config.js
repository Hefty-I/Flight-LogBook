import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ quiet: true });

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SHARED = path.resolve(ROOT, "..", "shared");

export function loadConfig() {
  const network = process.env.NETWORK || "localhost";
  const deploymentFile = path.join(SHARED, "deployments", `${network}.json`);
  if (!existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile}. Deploy the contracts first.`);
  }
  if (!process.env.ORACLE_PRIVATE_KEY) {
    throw new Error("ORACLE_PRIVATE_KEY is missing. Copy .env.example to .env and fill it in.");
  }

  return {
    network,
    deployment: JSON.parse(readFileSync(deploymentFile, "utf8")),
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    privateKey: process.env.ORACLE_PRIVATE_KEY,
    opensky: {
      mode: process.env.OPENSKY_MODE || "fixture",
      clientId: process.env.OPENSKY_CLIENT_ID,
      clientSecret: process.env.OPENSKY_CLIENT_SECRET,
      tokenUrl:
        process.env.OPENSKY_TOKEN_URL ||
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      apiUrl: process.env.OPENSKY_API_URL || "https://opensky-network.org/api",
      fixturesDir: path.join(ROOT, "fixtures", "opensky"),
    },
    toleranceSec: Number(process.env.MATCH_TOLERANCE_MIN || 30) * 60,
    // OpenSky builds its flight table in a nightly batch, so live checks wait a day.
    liveDelaySec: Number(process.env.LIVE_DELAY_HOURS || 24) * 3600,
    pollMs: Number(process.env.POLL_INTERVAL_MS || 5000),
    maxBlockRange: Number(process.env.MAX_BLOCK_RANGE || 5000),
    pinataJwt: process.env.PINATA_JWT || "",
    stateDir: path.join(ROOT, "state"),
  };
}
