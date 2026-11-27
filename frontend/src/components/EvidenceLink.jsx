/**
 * Link to the oracle's evidence file (the claim, the exact OpenSky answer and the decision).
 * The file's keccak256 hash is stored on-chain, so anyone can check it was not changed.
 */
export default function EvidenceLink({ evidence }) {
  if (!evidence) return <span className="muted">—</span>;
  const { uri, hash } = evidence;
  if (uri?.startsWith("ipfs://")) {
    return (
      <a href={`https://ipfs.io/ipfs/${uri.slice(7)}`} target="_blank" rel="noreferrer" title={`on-chain hash ${hash}`}>
        IPFS ↗
      </a>
    );
  }
  return (
    <span className="muted" title={`Kept by the oracle (${uri}). On-chain hash ${hash}`}>
      oracle copy · {hash.slice(0, 8)}…
    </span>
  );
}
