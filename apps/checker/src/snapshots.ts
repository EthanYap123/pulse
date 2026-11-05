import { DurableObject } from "cloudflare:workers";
import { connectDb } from "./db.js";
import type { Env } from "./env.js";
import { doSql } from "./do-sql.js";
import { runHourly, type HourlySummary } from "./maintenance.js";
import { SnapshotStore, buildSnapshots, type StatusSnapshot } from "./status.js";

/**
 * Holds every public project's status page snapshot, so visitors never touch Postgres
 * (ADR-0004). It has its own subrequest budget, so a rebuild doesn't eat into a shard's.
 */
export class Snapshots extends DurableObject<Env> {
  private readonly store = new SnapshotStore(doSql(this.ctx.storage));

  get(slug: string): StatusSnapshot | null {
    return this.store.get(slug);
  }

  /**
   * The hourly job: rollups, retention, then fresh snapshots. If Postgres is unavailable this
   * throws and the old snapshots keep being served.
   */
  async runHourly(): Promise<HourlySummary> {
    const db = await connectDb(this.env.DB_DRIVER, this.env.DATABASE_URL);
    try {
      return await runHourly(db, this.store, Date.now(), (entry) => {
        console.log(JSON.stringify(entry));
      });
    } finally {
      await db.close();
    }
  }

  async refreshProjects(projectIds: string[]): Promise<void> {
    const db = await connectDb(this.env.DB_DRIVER, this.env.DATABASE_URL);
    try {
      const data = await db.loadStatusData(projectIds);
      this.store.replaceProjects(projectIds, buildSnapshots(data, Date.now()));
    } finally {
      await db.close();
    }
  }

  /** After an incident opens or resolves, so the status page lists it straight away. */
  async refreshMonitors(monitorIds: string[]): Promise<void> {
    const db = await connectDb(this.env.DB_DRIVER, this.env.DATABASE_URL);
    try {
      const projectIds = await db.projectIdsForMonitors(monitorIds);
      const data = await db.loadStatusData(projectIds);
      this.store.replaceProjects(projectIds, buildSnapshots(data, Date.now()));
    } finally {
      await db.close();
    }
  }
}
