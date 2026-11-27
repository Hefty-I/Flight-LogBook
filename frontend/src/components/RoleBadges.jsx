/** Shows which roles the connected wallet holds, as read from the contracts. */
export default function RoleBadges({ roles }) {
  if (!roles) return null;
  if (roles.error) return <span className="error-text">Could not read roles: {roles.error}</span>;

  const badges = [];
  if (roles.authorityId) badges.push(`Authority admin (#${roles.authorityId})`);
  if (roles.schoolId) badges.push(`School admin (school #${roles.schoolId})`);
  if (roles.instructor) {
    badges.push(`Instructor (school #${roles.instructor.schoolId})${roles.instructor.active ? "" : " — REVOKED"}`);
  }
  if (roles.studentSchoolId) badges.push(`Student (school #${roles.studentSchoolId})`);
  if (roles.isOracle) badges.push("Oracle");
  if (roles.isDeployer) badges.push("Deployer / emergency pauser");

  if (!badges.length) return <span className="muted">This wallet has no FlightProof role yet.</span>;
  return (
    <div className="badges">
      {badges.map((b) => (
        <span key={b} className="badge">
          {b}
        </span>
      ))}
    </div>
  );
}
