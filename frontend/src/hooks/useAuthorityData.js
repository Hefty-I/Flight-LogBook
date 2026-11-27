import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { queryAll } from "../lib/events.js";
import { bytes4ToAirport } from "../lib/format.js";

/** "data:text/plain,flew%20in..." -> "flew in..." (dispute reasons are stored this way in events) */
function decodeReason(uri) {
  if (uri?.startsWith("data:text/plain,")) return decodeURIComponent(uri.slice("data:text/plain,".length));
  return uri || "";
}

/**
 * Everything one authority's admin page needs: its rules, schools, instructors, pilots
 * (with licence and review state), open disputes, and validation requests addressed to it.
 * Lists come from indexed events; current state comes from contract view functions.
 */
export function useAuthorityData(authorityId) {
  const { contracts, deployment, refreshKey } = useFlightProof();
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    if (!contracts || !deployment || !authorityId) return;
    let stopped = false;
    (async () => {
      const { authorities, registry, flightLog, licences } = contracts;
      const from = deployment.startBlock ?? 0;

      const [[name, , , rules], authorityCount] = await Promise.all([
        authorities.getAuthority(authorityId),
        authorities.authorityCount(),
      ]);
      const authorityNames = {};
      for (let i = 1; i <= Number(authorityCount); i++) authorityNames[i] = (await authorities.getAuthority(i))[0];

      // Schools of this authority
      const schoolEvents = await queryAll(registry, registry.filters.SchoolRegistered(null, authorityId), from);
      const schools = await Promise.all(
        schoolEvents.map(async (e) => {
          const id = Number(e.args.schoolId);
          const s = await registry.getSchool(id);
          return { id, admin: s.admin, active: s.active };
        }),
      );
      const schoolIds = schools.map((s) => s.id);

      let instructors = [];
      let pilots = [];
      let disputes = [];
      if (schoolIds.length) {
        // Instructors of those schools
        const insEvents = await queryAll(registry, registry.filters.InstructorRegistered(null, schoolIds), from);
        instructors = await Promise.all(
          insEvents.map(async (e) => ({
            address: e.args.instructor,
            schoolId: Number(e.args.schoolId),
            active: Number(await registry.instructorStatus(e.args.instructor)) === 1,
          })),
        );
        const revoked = instructors.filter((i) => !i.active);

        // Students (pilots) of those schools, with hours, eligibility and licence state
        const stuEvents = await queryAll(registry, registry.filters.StudentRegistered(null, schoolIds), from);
        pilots = await Promise.all(
          stuEvents.map(async (e) => {
            const address = e.args.student;
            const [totals, eligibility, effective, stored] = await Promise.all([
              flightLog.totalsOf(address),
              licences.eligibility(address, authorityId),
              licences.licenceStatus(address),
              licences.getLicence(address),
            ]);
            // Revoked instructors whose signed hours still wait for a re-check
            const toClear = [];
            for (const ins of revoked) {
              const [minutes, cleared] = await Promise.all([
                flightLog.minutesWith(address, ins.address),
                licences.reviewCleared(address, ins.address),
              ]);
              if (Number(minutes) > 0 && !cleared) toClear.push({ instructor: ins.address, minutes: Number(minutes) });
            }
            return {
              address,
              schoolId: Number(e.args.schoolId),
              total: Number(totals.total),
              verified: Number(totals.verified),
              eligibility: Number(eligibility),
              licence: Number(effective), // EffectiveStatus
              storedStatus: Number(stored.status), // LicenceStatus: 0 none, 1 active, 2 suspended, 3 revoked
              toClear,
            };
          }),
        );

        // Open disputes from these students
        const students = pilots.map((p) => p.address);
        if (students.length) {
          const dEvents = await queryAll(flightLog, flightLog.filters.DisputeOpened(null, students), from);
          const open = await Promise.all(
            dEvents.map(async (e) => {
              const f = await flightLog.getFlight(e.args.flightId);
              if (Number(f.status) !== 6) return null; // 6 = Disputed (still open)
              return {
                id: e.args.flightId.toString(),
                student: f.student,
                departureTime: Number(f.departureTime),
                minutes: Number(f.durationMinutes),
                route: `${bytes4ToAirport(f.departureAirport)} → ${bytes4ToAirport(f.arrivalAirport)}`,
                reason: decodeReason(e.args.reasonURI),
              };
            }),
          );
          disputes = open.filter(Boolean);
        }
      }

      // Validation requests addressed to this authority (foreignAuthority is the 3rd indexed topic)
      const vEvents = await queryAll(licences, licences.filters.ValidationRequested(null, null, authorityId), from);
      const seen = new Map();
      for (const e of vEvents) seen.set(e.args.pilot, Number(e.args.homeAuthority));
      const validations = await Promise.all(
        [...seen.entries()].map(async ([pilot, home]) => {
          const [status, eligibility] = await Promise.all([
            licences.validationStatus(pilot, authorityId),
            licences.eligibility(pilot, authorityId),
          ]);
          return { pilot, home, homeName: authorityNames[home], status: Number(status), eligibility: Number(eligibility) };
        }),
      );

      if (!stopped) {
        setState({
          loading: false,
          error: null,
          data: { name, rules, schools, instructors, pilots, disputes, validations },
        });
      }
    })().catch((err) => !stopped && setState({ loading: false, data: null, error: err.shortMessage || err.message }));
    return () => {
      stopped = true;
    };
  }, [contracts, deployment, authorityId, refreshKey]);

  return state;
}
