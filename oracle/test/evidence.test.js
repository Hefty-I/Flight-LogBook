import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalJson, hashEvidence, storeEvidence } from "../src/evidence.js";

test("canonical JSON does not depend on key order", () => {
  const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } });
  const b = canonicalJson({ a: { c: null, d: [3, { y: 2, z: 1 }] }, b: 1 });
  assert.equal(a, b);
  assert.equal(hashEvidence(a), hashEvidence(b));
});

test("bigints are written as strings", () => {
  assert.equal(canonicalJson({ id: 5n }), '{"id":"5"}');
});

test("the stored file hashes to the on-chain value (local fallback)", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "fp-"));
  const json = canonicalJson({ hello: "world" });
  const hash = hashEvidence(json);
  const uri = await storeEvidence(json, hash, { pinataJwt: "", stateDir });
  assert.equal(uri, `local://evidence/${hash}.json`);
  const saved = readFileSync(path.join(stateDir, "evidence", `${hash}.json`), "utf8");
  assert.equal(keccak256(toUtf8Bytes(saved)), hash);
});

test("uses the IPFS CID when Pinata accepts the upload", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "fp-"));
  const fakeFetch = async () => new Response(JSON.stringify({ IpfsHash: "bafyTEST" }));
  const json = canonicalJson({ x: 1 });
  const uri = await storeEvidence(json, hashEvidence(json), { pinataJwt: "jwt", stateDir, fetchImpl: fakeFetch });
  assert.equal(uri, "ipfs://bafyTEST");
});
