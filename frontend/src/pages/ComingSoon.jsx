/** Placeholder for pages that are built in later steps. */
export default function ComingSoon({ title, description }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <p className="small muted">This page is built in a later step.</p>
    </section>
  );
}
