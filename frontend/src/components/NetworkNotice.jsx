import { useFlightProof } from "../context/FlightProofContext.jsx";

/** Explains what is wrong when the app cannot reach FlightProof, and how to fix it. */
export default function NetworkNotice() {
  const { mode, deployment, chain, hasMetaMask, account, switchToLocal } = useFlightProof();

  if (mode === "wallet" && !deployment) {
    return (
      <div className="notice warn">
        <strong>FlightProof is not deployed on this network.</strong> Switch MetaMask to the local Hardhat chain
        (or to Sepolia once you have deployed there).
        <button className="btn small" onClick={switchToLocal}>
          Switch to Local Hardhat
        </button>
      </div>
    );
  }
  if (mode === "readonly" && !deployment) {
    return (
      <div className="notice warn">
        <strong>No local deployment found.</strong> Start the chain (<code>npx hardhat node</code>) and run{" "}
        <code>npm run deploy:local</code> and <code>npm run seed:local</code> in <code>contracts/</code>, then reload.
      </div>
    );
  }
  if (chain.online === false) {
    return (
      <div className="notice bad">
        <strong>Cannot reach the blockchain.</strong> Is the local chain running at 127.0.0.1:8545? If you restarted it,
        deploy and seed again, then reload this page.
      </div>
    );
  }
  if (mode === "readonly") {
    return (
      <div className="notice info">
        Read-only mode: you can look up flights and licences.{" "}
        {hasMetaMask && !account ? "Connect MetaMask to log, sign or approve." : "Install MetaMask to send transactions."}
      </div>
    );
  }
  return null;
}
