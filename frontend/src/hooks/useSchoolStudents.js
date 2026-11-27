import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { queryAll } from "../lib/events.js";

/**
 * Students of one school, found through StudentRegistered events (schoolId is indexed,
 * so the node can filter them), with each student's running totals from FlightLog.
 */
export function useSchoolStudents(schoolId) {
  const { contracts, deployment, refreshKey } = useFlightProof();
  const [state, setState] = useState({ loading: true, students: [], error: null });

  useEffect(() => {
    if (!contracts || !deployment || !schoolId) return;
    let stopped = false;
    (async () => {
      const { registry, flightLog } = contracts;
      const events = await queryAll(registry, registry.filters.StudentRegistered(null, schoolId), deployment.startBlock ?? 0);
      const students = await Promise.all(
        events.map(async (e) => {
          const address = e.args.student;
          const t = await flightLog.totalsOf(address);
          return { address, total: Number(t.total), verified: Number(t.verified), solo: Number(t.solo) };
        }),
      );
      if (!stopped) setState({ loading: false, students, error: null });
    })().catch((err) => !stopped && setState({ loading: false, students: [], error: err.shortMessage || err.message }));
    return () => {
      stopped = true;
    };
  }, [contracts, deployment, schoolId, refreshKey]);

  return state;
}
