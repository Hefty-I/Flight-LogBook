import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";

/**
 * Works out what the connected wallet is allowed to do, straight from the contracts.
 * No backend and no login: the blockchain is the source of truth for roles.
 */
export function useRoles() {
  const { contracts, account, refreshKey, mode } = useFlightProof();
  const [roles, setRoles] = useState(null);

  useEffect(() => {
    if (!contracts || !account || mode !== "wallet") {
      setRoles(null);
      return;
    }
    let stopped = false;
    (async () => {
      const { authorities, registry, flightLog } = contracts;
      const [authorityId, schoolId, instructorStatus, instructorSchool, studentSchool, oracleRole, adminRole] =
        await Promise.all([
          authorities.adminOf(account),
          registry.schoolAdminOf(account),
          registry.instructorStatus(account),
          registry.instructorSchool(account),
          registry.studentSchool(account),
          flightLog.ORACLE_ROLE(),
          authorities.DEFAULT_ADMIN_ROLE(),
        ]);
      const [isOracle, isDeployer] = await Promise.all([
        flightLog.hasRole(oracleRole, account),
        authorities.hasRole(adminRole, account),
      ]);
      if (stopped) return;
      setRoles({
        authorityId: Number(authorityId),
        schoolId: Number(schoolId),
        instructor:
          Number(instructorStatus) === 0
            ? null
            : { schoolId: Number(instructorSchool), active: Number(instructorStatus) === 1 },
        studentSchoolId: Number(studentSchool),
        isOracle,
        isDeployer,
      });
    })().catch((err) => !stopped && setRoles({ error: err.shortMessage || err.message }));
    return () => {
      stopped = true;
    };
  }, [contracts, account, refreshKey, mode]);

  return roles;
}
