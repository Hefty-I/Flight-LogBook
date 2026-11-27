import { useFlightProof } from "../context/FlightProofContext.jsx";
import { CHAIN_NAMES } from "../lib/config.js";
import { shortAddress, utc } from "../lib/format.js";

export default function Header() {
  const { hasMetaMask, account, chainId, connect, mode, chain } = useFlightProof();
  const network = mode === "wallet" ? CHAIN_NAMES[chainId] ?? `Chain ${chainId}` : "Local Hardhat (read-only)";

  return (
    <header className="header">
      <div className="brand">
        <span className="logo">✈</span>
        <div>
          <div className="brand-name">FlightProof</div>
          <div className="brand-tag">Verified pilot logbook</div>
        </div>
      </div>

      <div className="header-right">
        <div className="chain-info">
          <span className={`dot ${chain.online ? "ok" : chain.online === false ? "bad" : ""}`} />
          <span>{network}</span>
          {chain.online && <span className="muted">· chain time {utc(chain.time)}</span>}
        </div>
        {!hasMetaMask ? (
          <a className="btn secondary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
            Install MetaMask
          </a>
        ) : account ? (
          <span className="account" title={account}>
            {shortAddress(account)}
          </span>
        ) : (
          <button className="btn" onClick={connect}>
            Connect MetaMask
          </button>
        )}
      </div>
    </header>
  );
}
