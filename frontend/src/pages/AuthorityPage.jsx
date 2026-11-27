import { useAuthorityData } from "../hooks/useAuthorityData.js";
import RulesPanel from "../components/authority/RulesPanel.jsx";
import DisputesPanel from "../components/authority/DisputesPanel.jsx";
import LicencesPanel from "../components/authority/LicencesPanel.jsx";
import ValidationsPanel from "../components/authority/ValidationsPanel.jsx";
import SchoolsPanel from "../components/authority/SchoolsPanel.jsx";

/**
 * The aviation authority's console. Every button here is checked again by the contracts:
 * an authority can only act on its own schools and pilots, and cannot bypass the rules.
 */
export default function AuthorityPage({ roles }) {
  const authorityId = roles.authorityId;
  const { loading, data, error } = useAuthorityData(authorityId);

  if (error) return <p className="error-text">{error}</p>;
  if (loading || !data) return <p className="muted">Loading authority data…</p>;

  const underReview = data.pilots.filter((p) => p.toClear.length).length;

  return (
    <div className="grid">
      <section className="card wide">
        <div className="eyebrow">Authority #{authorityId}</div>
        <h2 className="title">{data.name}</h2>
        <ul className="stats inline-stats">
          <li>
            <span>Schools</span>
            <strong>{data.schools.length}</strong>
          </li>
          <li>
            <span>Instructors</span>
            <strong>{data.instructors.length}</strong>
          </li>
          <li>
            <span>Pilots</span>
            <strong>{data.pilots.length}</strong>
          </li>
          <li>
            <span>Open disputes</span>
            <strong className={data.disputes.length ? "error-text" : ""}>{data.disputes.length}</strong>
          </li>
          <li>
            <span>Under review</span>
            <strong className={underReview ? "error-text" : ""}>{underReview}</strong>
          </li>
        </ul>
      </section>

      <section className="card wide">
        <h2>Open disputes</h2>
        <DisputesPanel disputes={data.disputes} />
      </section>

      <section className="card wide">
        <h2>Pilots and licences</h2>
        <LicencesPanel pilots={data.pilots} />
      </section>

      <section className="card wide">
        <h2>Validation requests from foreign pilots</h2>
        <ValidationsPanel authorityId={authorityId} validations={data.validations} />
      </section>

      <section className="card wide">
        <h2>Schools</h2>
        <SchoolsPanel authorityId={authorityId} schools={data.schools} instructors={data.instructors} />
      </section>

      <section className="card wide">
        <h2>Your licence rules</h2>
        <RulesPanel authorityId={authorityId} rules={data.rules} />
      </section>
    </div>
  );
}
