import { useCallback, useEffect, useState } from "react";
import { LOCAL_CHAIN_ID, LOCAL_RPC } from "../lib/config.js";

/** MetaMask connection: account, chain, connect, and switching to the local chain. */
export function useWallet() {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    if (!eth) return;
    eth.request({ method: "eth_accounts" }).then((a) => setAccount(a[0] ?? null));
    eth.request({ method: "eth_chainId" }).then((c) => setChainId(Number(c)));
    const onAccounts = (a) => setAccount(a[0] ?? null);
    const onChain = (c) => setChainId(Number(c));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChain);
    };
  }, [eth]);

  const connect = useCallback(async () => {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    setAccount(accounts[0] ?? null);
  }, [eth]);

  const switchToLocal = useCallback(async () => {
    const chainIdHex = "0x" + LOCAL_CHAIN_ID.toString(16);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      if (err.code !== 4902) throw err; // 4902 = MetaMask does not know this chain yet
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: "Hardhat Local",
            rpcUrls: [LOCAL_RPC],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    }
  }, [eth]);

  return { hasMetaMask: !!eth, account, chainId, connect, switchToLocal };
}
