import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchFlight, Result } from "../src/matcher.js";
import { OpenSkyClient } from "../src/opensky.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "opensky");
const t = (iso) => Math.floor(Date.parse(iso) / 1000);

const realClaim = {
  icao24: "3c6444",
  adsbEquipped: true,
  departureTime: t("2026-11-20T08:00:00Z"),
  durationMinutes: 90,
  departureAirport: "EDFE",
  arrivalAirport: "EDFZ",
};

const openskyFlight = {
  icao24: "3c6444",
  firstSeen: t("2026-11-20T08:04:00Z"),
  lastSeen: t("2026-11-20T09:27:00Z"),
  estDepartureAirport: "EDFE",
  estArrivalAirport: "EDFZ",
};

test("matches a flight whose times are within tolerance and airports agree", () => {
  const m = matchFlight(realClaim, [openskyFlight]);
  assert.equal(m.result, Result.MATCH);
  assert.equal(m.startDiffSec, 240);
  assert.equal(m.endDiffSec, 180);
});

test("ghost flight: no ADS-B trace for an equipped aircraft is a MISMATCH", () => {
  const m = matchFlight(realClaim, []);
  assert.equal(m.result, Result.MISMATCH);
});

test("no ADS-B equipment and no data gives NO_DATA (instructor attestation only)", () => {
  const m = matchFlight({ ...realClaim, adsbEquipped: false }, []);
  assert.equal(m.result, Result.NO_DATA);
});

test("an untracked aircraft that WAS seen is still checked, and can match", () => {
  const m = matchFlight({ ...realClaim, adsbEquipped: false }, [openskyFlight]);
  assert.equal(m.result, Result.MATCH);
});

test("inflated duration (logged 3h, flew 1.5h) is a MISMATCH", () => {
  const m = matchFlight({ ...realClaim, durationMinutes: 180 }, [openskyFlight]);
  assert.equal(m.result, Result.MISMATCH);
  assert.match(m.reason, /landing differs by \d+ min/);
});

test("tolerance boundary: exactly 30 minutes off still matches, 31 does not", () => {
  const exact = { ...openskyFlight, firstSeen: realClaim.departureTime + 1800 };
  assert.equal(matchFlight(realClaim, [exact]).result, Result.MATCH);
  const over = { ...openskyFlight, firstSeen: realClaim.departureTime + 1860 };
  assert.equal(matchFlight(realClaim, [over]).result, Result.MISMATCH);
});

test("wrong airport is a MISMATCH; an unknown (null) airport is not", () => {
  const wrong = { ...openskyFlight, estArrivalAirport: "EDDS" };
  const m = matchFlight(realClaim, [wrong]);
  assert.equal(m.result, Result.MISMATCH);
  assert.match(m.reason, /arrived EDDS, not EDFZ/);
  assert.equal(matchFlight(realClaim, [{ ...openskyFlight, estArrivalAirport: null }]).result, Result.MATCH);
});

test("picks the right flight when the aircraft flew several times that day", () => {
  const morning = { ...openskyFlight, firstSeen: t("2026-11-20T05:00:00Z"), lastSeen: t("2026-11-20T06:00:00Z") };
  assert.equal(matchFlight(realClaim, [morning, openskyFlight]).result, Result.MATCH);
});

test("fixture client returns only flights overlapping the requested window", async () => {
  const client = new OpenSkyClient({ mode: "fixture", fixturesDir });
  const { flights } = await client.flightsByAircraft("3C6444", t("2026-11-20T06:00:00Z"), t("2026-11-20T11:30:00Z"));
  assert.equal(flights.length, 1);
  assert.equal(flights[0].estDepartureAirport, "EDFE");
  const none = await client.flightsByAircraft("ffffff", 0, 10);
  assert.deepEqual(none.flights, []);
});

test("live client treats HTTP 404 as 'no flights' and uses a bearer token", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("token")) return new Response(JSON.stringify({ access_token: "abc", expires_in: 1800 }));
    return new Response("", { status: 404 });
  };
  const client = new OpenSkyClient({
    mode: "live",
    clientId: "id",
    clientSecret: "secret",
    tokenUrl: "https://auth.example/token",
    apiUrl: "https://api.example",
    fetchImpl: fakeFetch,
  });
  const { flights } = await client.flightsByAircraft("3c6444", 100, 200);
  assert.deepEqual(flights, []);
  assert.equal(calls[1].init.headers.Authorization, "Bearer abc");
  assert.match(calls[1].url, /icao24=3c6444&begin=100&end=200/);
});
