import { DEFAULT_EXPECTED_STATUS } from "@pulse/shared";

export default function Home() {
  return (
    <main className="home">
      <h1>Pulse</h1>
      <p>Uptime monitoring with public status pages.</p>
      <p className="muted">
        Monitors pass on HTTP {DEFAULT_EXPECTED_STATUS.min}-{DEFAULT_EXPECTED_STATUS.max} by
        default. The dashboard arrives in Phase 2.
      </p>
    </main>
  );
}
