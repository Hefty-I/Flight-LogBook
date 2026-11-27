import { FLIGHT_STATUS } from "../lib/format.js";

const INFO = {
  Logged: ["wait", "Waiting for the instructor to co-sign"],
  Signed: ["wait", "Waiting for the oracle to check the ADS-B data"],
  Verified: ["ok", "Confirmed by real ADS-B tracking data"],
  Attested: ["neutral", "Counted on the instructor's signature only (no ADS-B data)"],
  Mismatch: ["bad", "ADS-B data does not match this claim. Not counted."],
  Disputed: ["wait", "Waiting for the authority to decide the dispute"],
  Rejected: ["bad", "Rejected by the authority. Not counted."],
  Closed: ["muted", "Closed. The time slot was released."],
};

export default function StatusBadge({ status }) {
  const name = FLIGHT_STATUS[status] ?? "Unknown";
  const [tone, tip] = INFO[name] ?? ["muted", ""];
  return (
    <span className={`status ${tone}`} title={tip}>
      {name}
    </span>
  );
}
