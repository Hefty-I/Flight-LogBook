import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { queryAll } from "../lib/events.js";
import { bytes4ToAirport, bytesToText } from "../lib/format.js";

/**
 * Loads flights from the blockchain.
 *  - Event logs find the flights (FlightLogged) and the oracle's evidence links (FlightVerified),
 *    because the evidence URI is only stored in events, not in contract storage (gas saving).
 *  - getFlight() gives each flight's current status.
 * `student`: only that student's flights. Omit it to load every flight.
 * Refreshes after each transaction and every 15 seconds (to pick up oracle results).
 */
export function useFlights({ student } = {}) {
  const { contracts, deployment, refreshKey } = useFlightProof();
  const [state, setState] = useState({ loading: true, flights: [], error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!contracts || !deployment) return;
    let stopped = false;
    (async () => {
      const { flightLog, registry } = contracts;
      const from = deployment.startBlock ?? 0;
      const [logged, verified] = await Promise.all([
        queryAll(flightLog, flightLog.filters.FlightLogged(null, student ?? null), from),
        queryAll(flightLog, flightLog.filters.FlightVerified(), from),
      ]);
      const evidence = new Map(
        verified.map((e) => [e.args.flightId.toString(), { uri: e.args.evidenceURI, hash: e.args.evidenceHash }]),
      );

      const aircraftCache = new Map();
      const aircraftOf = (id) => {
        if (!aircraftCache.has(id)) aircraftCache.set(id, registry.aircraftInfo(id));
        return aircraftCache.get(id);
      };

      const flights = await Promise.all(
        logged.map(async (e) => {
          const id = e.args.flightId.toString();
          const f = await flightLog.getFlight(id);
          const ac = await aircraftOf(Number(f.aircraftId));
          return {
            id,
            student: f.student,
            instructor: f.instructor,
            departureTime: Number(f.departureTime),
            minutes: Number(f.durationMinutes),
            flags: Number(f.flags),
            from: bytes4ToAirport(f.departureAirport),
            to: bytes4ToAirport(f.arrivalAirport),
            status: Number(f.status),
            aircraft: {
              id: Number(f.aircraftId),
              registration: bytesToText(ac.registration),
              icao24: ac.icao24.slice(2),
              adsb: ac.adsbEquipped,
            },
            evidence: evidence.get(id) ?? null,
          };
        }),
      );
      flights.sort((a, b) => b.departureTime - a.departureTime);
      if (!stopped) setState({ loading: false, flights, error: null });
    })().catch((err) => !stopped && setState((s) => ({ ...s, loading: false, error: err.shortMessage || err.message })));
    return () => {
      stopped = true;
    };
  }, [contracts, deployment, student, refreshKey, tick]);

  return state;
}
