import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, JsonRpcProvider } from "ethers";
import { deploymentForChain, LOCAL_CHAIN_ID, LOCAL_RPC } from "../lib/config.js";
import { getContracts } from "../lib/contracts.js";
import { explainError } from "../lib/errors.js";
import { useWallet } from "../hooks/useWallet.js";

const FlightProofContext = createContext(null);

/**
 * Shared state for every page:
 *  - "wallet" mode: MetaMask is connected, pages can send transactions
 *  - "readonly" mode: no wallet, pages read the local chain (e.g. the public verify page)
 * Also keeps a log of recent transactions so every page shows the same status panel.
 */
export function FlightProofProvider({ children }) {
  const wallet = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const { provider, deployment, mode } = useMemo(() => {
    if (wallet.hasMetaMask && wallet.account && wallet.chainId) {
      return {
        provider: new BrowserProvider(window.ethereum),
        deployment: deploymentForChain(wallet.chainId),
        mode: "wallet",
      };
    }
    return {
      provider: new JsonRpcProvider(LOCAL_RPC, LOCAL_CHAIN_ID, { staticNetwork: true }),
      deployment: deploymentForChain(LOCAL_CHAIN_ID),
      mode: "readonly",
    };
  }, [wallet.hasMetaMask, wallet.account, wallet.chainId]);

  const contracts = useMemo(() => (deployment ? getContracts(deployment, provider) : null), [deployment, provider]);

  // Chain time matters: the local demo chain can start on a different date than your computer.
  const [chain, setChain] = useState({ online: null, time: null, block: null });
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const b = await provider.getBlock("latest");
        if (!stopped) setChain({ online: true, time: b.timestamp, block: b.number });
      } catch {
        if (!stopped) setChain((c) => ({ ...c, online: false }));
      }
    };
    load();
    const timer = setInterval(load, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [provider, refreshKey]);

  // ── Transactions ──
  const [txs, setTxs] = useState([]);
  const updateTx = (id, patch) => setTxs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /**
   * Sends a transaction and tracks it: waiting for MetaMask -> pending -> confirmed / failed.
   * `send` receives the contracts connected to the MetaMask signer.
   * Returns the receipt, or null if it failed.
   */
  const runTx = useCallback(
    async (label, send) => {
      const id = Date.now() + Math.random();
      setTxs((list) => [{ id, label, state: "wallet" }, ...list].slice(0, 6));
      try {
        if (mode !== "wallet" || !deployment) throw new Error("Connect MetaMask to a network with FlightProof deployed.");
        const signer = await provider.getSigner();
        const tx = await send(getContracts(deployment, signer));
        updateTx(id, { state: "pending", hash: tx.hash });
        const receipt = await tx.wait();
        updateTx(id, { state: "confirmed", block: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() });
        refresh();
        return receipt;
      } catch (err) {
        console.error(err);
        updateTx(id, { state: "failed", error: explainError(err) });
        return null;
      }
    },
    [mode, deployment, provider, refresh],
  );

  const value = { ...wallet, provider, deployment, mode, contracts, chain, refresh, refreshKey, runTx, txs };
  return <FlightProofContext.Provider value={value}>{children}</FlightProofContext.Provider>;
}

export const useFlightProof = () => useContext(FlightProofContext);
