/** Free-tier caps (docs/COSTS.md, "Caps that follow from these limits"). */
export const LIMITS = {
  projectsPerUser: 3,
  monitorsPerUser: 10,
  channelsPerProject: 5,
  /** 5 shards x 40 checks per tick; see ADR-0004. */
  activeMonitorsGlobal: 200,
  shards: 5,
  maxHeadersPerMonitor: 5,
} as const;
