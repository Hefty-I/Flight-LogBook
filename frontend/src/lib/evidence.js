import { keccak256 } from "ethers";

/** Where to download an evidence file from its URI. */
export function evidenceUrl(uri) {
  if (uri?.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri?.startsWith("local://evidence/")) return `/evidence/${uri.slice("local://evidence/".length)}`; // dev server
  return null;
}

/**
 * Downloads the oracle's evidence file and checks it against the hash stored on-chain.
 * If even one character of the file was changed, the hashes will not match.
 */
export async function checkEvidence({ uri, hash }) {
  const url = evidenceUrl(uri);
  if (!url) throw new Error(`Unknown evidence location: ${uri}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the evidence file (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const computed = keccak256(bytes);
  const json = JSON.parse(new TextDecoder().decode(bytes));
  return { matches: computed.toLowerCase() === hash.toLowerCase(), computed, onChain: hash, json };
}
