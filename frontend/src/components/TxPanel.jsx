import { useFlightProof } from "../context/FlightProofContext.jsx";

const LABEL = {
  wallet: "Confirm in MetaMask…",
  pending: "Pending…",
  confirmed: "Confirmed",
  failed: "Failed",
};

/** Bottom-right list of recent transactions with their status (rubric: transaction feedback). */
export default function TxPanel() {
  const { txs } = useFlightProof();
  if (!txs.length) return null;

  return (
    <aside className="tx-panel">
      <div className="tx-title">Recent transactions</div>
      {txs.map((t) => (
        <div key={t.id} className={`tx ${t.state}`}>
          <div className="tx-row">
            <span className="tx-label">{t.label}</span>
            <span className="tx-state">{LABEL[t.state]}</span>
          </div>
          {t.hash && <div className="mono small muted">tx {t.hash.slice(0, 18)}…</div>}
          {t.state === "confirmed" && (
            <div className="small muted">
              block {t.block} · gas used {Number(t.gasUsed).toLocaleString()}
            </div>
          )}
          {t.error && <div className="small error-text">{t.error}</div>}
        </div>
      ))}
    </aside>
  );
}
