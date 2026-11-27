import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { useFlights } from "../hooks/useFlights.js";
import { bytesToText } from "../lib/format.js";
import HoursProgress from "../components/HoursProgress.jsx";
import LicenceCard from "../components/LicenceCard.jsx";
import LogFlightForm from "../components/LogFlightForm.jsx";
import FlightTable from "../components/FlightTable.jsx";

/** "My logbook": progress, licence, log a flight, and the student's flights. */
export default function StudentPage({ roles }) {
  const { contracts, account, refreshKey } = useFlightProof();
  const { flights, loading, error: flightsError } = useFlights({ student: account });
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const schoolId = roles.studentSchoolId;

  useEffect(() => {
    if (!contracts || !account || !schoolId) return;
    let stopped = false;
    (async () => {
      const { authorities, registry, flightLog, licences } = contracts;
      const [home, count, aircraftCount, totals, licenceStatus, licence] = await Promise.all([
        registry.schoolAuthority(schoolId),
        authorities.authorityCount(),
        registry.aircraftCount(),
        flightLog.totalsOf(account),
        licences.licenceStatus(account),
        licences.getLicence(account),
      ]);
      const homeId = Number(home);
      const rules = await authorities.rulesOf(homeId);

      const authorityList = await Promise.all(
        Array.from({ length: Number(count) }, async (_, i) => {
          const id = i + 1;
          const [[name, , active], eligibility, validation] = await Promise.all([
            authorities.getAuthority(id),
            licences.eligibility(account, id),
            licences.validationStatus(account, id),
          ]);
          return { id, name, active, eligibility: Number(eligibility), validation: Number(validation) };
        }),
      );

      const aircraft = (
        await Promise.all(
          Array.from({ length: Number(aircraftCount) }, async (_, i) => {
            const a = await registry.aircraftInfo(i + 1);
            return {
              id: i + 1,
              schoolId: Number(a.schoolId),
              active: a.active,
              adsb: a.adsbEquipped,
              icao24: a.icao24.slice(2),
              registration: bytesToText(a.registration),
            };
          }),
        )
      ).filter((a) => a.schoolId === schoolId && a.active);

      if (!stopped) {
        setInfo({
          home: homeId,
          rules,
          totals,
          aircraft,
          authorities: authorityList,
          licence: { status: Number(licenceStatus), issuedAt: Number(licence.issuedAt) || null },
        });
        setError(null);
      }
    })().catch((err) => !stopped && setError(err.shortMessage || err.message));
    return () => {
      stopped = true;
    };
  }, [contracts, account, schoolId, refreshKey]);

  if (error) return <p className="error-text">{error}</p>;
  if (!info) return <p className="muted">Loading your logbook…</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>Progress to licence</h2>
        <HoursProgress totals={info.totals} rules={info.rules} />
      </section>

      <section className="card">
        <h2>Log a flight</h2>
        <LogFlightForm aircraft={info.aircraft} />
      </section>

      <section className="card wide">
        <h2>My flights</h2>
        {flightsError && <p className="error-text">{flightsError}</p>}
        {loading ? <p className="muted">Loading flights…</p> : <FlightTable flights={flights} actions="student" />}
        <p className="small muted">
          Logged → your instructor co-signs → the oracle checks OpenSky ADS-B data → Verified or Mismatch. This list
          refreshes every 15 seconds.
        </p>
      </section>

      <section className="card wide">
        <h2>My licence</h2>
        <LicenceCard info={info} />
      </section>
    </div>
  );
}
