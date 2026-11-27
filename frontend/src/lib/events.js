/**
 * Reads contract events in block ranges. Public RPCs (e.g. Sepolia) refuse very large
 * ranges, so we ask for `chunk` blocks at a time.
 */
export async function queryAll(contract, filter, fromBlock, chunk = 5000) {
  const provider = contract.runner.provider ?? contract.runner;
  const latest = await provider.getBlockNumber();
  const out = [];
  for (let start = fromBlock; start <= latest; start += chunk) {
    const end = Math.min(latest, start + chunk - 1);
    out.push(...(await contract.queryFilter(filter, start, end)));
  }
  return out;
}
