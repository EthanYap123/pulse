import { LIMITS } from "@pulse/shared";
import Link from "next/link";

export default function Home() {
  return (
    <main className="narrow hero">
      <h1>Know when your sites go down, before your users do.</h1>
      <p className="lead">
        Pulse checks your URLs and API endpoints every 5 minutes, tracks response times, and tells
        you when something breaks.
      </p>
      <div className="actions">
        <Link className="button" href="/signup">
          Create an account
        </Link>
        <Link className="button button-quiet" href="/login">
          Sign in
        </Link>
      </div>
      <p className="muted small">
        Free, with up to {LIMITS.projectsPerUser} projects and {LIMITS.monitorsPerUser} monitors per
        account.
      </p>
    </main>
  );
}
