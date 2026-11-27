import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Errors worth retrying later (rate limits, network trouble, OpenSky outages). */
export class RetryableError extends Error {}

/**
 * Minimal OpenSky Network client for GET /flights/aircraft.
 *
 * mode "live":    real API. Since March 2026 OpenSky only accepts OAuth2 client
 *                 credentials (create an API client on your OpenSky account page).
 * mode "fixture": reads fixtures/opensky/<icao24>.json, recorded earlier with
 *                 `npm run record`. Used for tests and as a demo fallback.
 */
export class OpenSkyClient {
  #token = null;

  constructor({ mode = "fixture", clientId, clientSecret, tokenUrl, apiUrl, fixturesDir, fetchImpl = fetch }) {
    this.mode = mode;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenUrl = tokenUrl;
    this.apiUrl = apiUrl;
    this.fixturesDir = fixturesDir;
    this.fetch = fetchImpl;
  }

  /** Flights of one aircraft between two UNIX times (seconds). */
  async flightsByAircraft(icao24, begin, end) {
    const id = icao24.toLowerCase();
    if (end <= begin) throw new Error("end must be after begin");
    if (this.mode === "fixture") return this.#fromFixture(id, begin, end);
    if (this.mode === "live") return this.#live(id, begin, end);
    throw new Error(`Unknown OPENSKY_MODE "${this.mode}" (use "live" or "fixture")`);
  }

  #fromFixture(icao24, begin, end) {
    const file = path.join(this.fixturesDir, `${icao24}.json`);
    const query = { icao24, begin, end };
    if (!existsSync(file)) return { flights: [], source: "fixture:none", query };
    const data = JSON.parse(readFileSync(file, "utf8"));
    // Same filter the API applies: flights that overlap the requested interval.
    const flights = (data.flights || []).filter((f) => f.lastSeen >= begin && f.firstSeen <= end);
    return { flights, source: `fixture:${path.basename(file)}`, query };
  }

  async #accessToken() {
    if (this.#token && Date.now() < this.#token.expiresAt) return this.#token.value;
    if (!this.clientId || !this.clientSecret) {
      throw new Error("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are required in live mode");
    }
    const res = await this.fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) throw new RetryableError(`OpenSky token request failed: HTTP ${res.status}`);
    const json = await res.json();
    const lifetime = Math.max(60, Number(json.expires_in || 1800) - 60);
    this.#token = { value: json.access_token, expiresAt: Date.now() + lifetime * 1000 };
    return this.#token.value;
  }

  async #live(icao24, begin, end) {
    const url = new URL(`${this.apiUrl}/flights/aircraft`);
    url.searchParams.set("icao24", icao24);
    url.searchParams.set("begin", String(begin));
    url.searchParams.set("end", String(end));
    const query = { icao24, begin, end, url: url.toString() };

    let res;
    try {
      res = await this.fetch(url, { headers: { Authorization: `Bearer ${await this.#accessToken()}` } });
    } catch (err) {
      throw new RetryableError(`OpenSky request failed: ${err.message}`);
    }
    if (res.status === 401) this.#token = null; // expired early; next attempt gets a new one
    // OpenSky answers 404 when it has no flights for the aircraft in that interval.
    if (res.status === 404) return { flights: [], source: "opensky:live", query };
    if (res.status === 429 || res.status === 401 || res.status >= 500) {
      throw new RetryableError(`OpenSky HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
    return { flights: await res.json(), source: "opensky:live", query };
  }
}
