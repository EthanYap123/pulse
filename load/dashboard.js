// k6 load test for the signed-in dashboard (NFR-07: API p95 under 300 ms when warm).
//
//   k6 run -e BASE_URL=https://pulse-api-staging-fkbo.onrender.com load/dashboard.js
//
// setup() wakes the API, signs up a throwaway account with a random password, and creates a
// project with three monitors. Each virtual user then loads the same pages the dashboard does,
// with think time between them. teardown() deletes the project; the account stays (there is no
// account deletion yet), and its email makes it easy to spot: k6-<timestamp>@example.com.
//
// Only run this against staging or a local API, never production. See docs/PERFORMANCE.md.

import { check, fail, sleep } from "k6";
import http from "k6/http";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || "2m";

export const options = {
  scenarios: {
    // One user for 30 s so every route, the database and the checker are warm.
    warmup: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
      tags: { phase: "warmup" },
    },
    load: {
      executor: "ramping-vus",
      startTime: "30s",
      startVUs: 1,
      stages: [
        { duration: "20s", target: VUS },
        { duration: DURATION, target: VUS },
        { duration: "10s", target: 0 },
      ],
      tags: { phase: "load" },
    },
  },
  thresholds: {
    "http_req_duration{phase:load}": ["p(95)<300"],
    "http_req_failed{phase:load}": ["rate<0.01"],
    // Per endpoint, so a slow one shows up in the summary.
    "http_req_duration{phase:load,name:me}": ["p(95)<300"],
    "http_req_duration{phase:load,name:projects}": ["p(95)<300"],
    "http_req_duration{phase:load,name:project}": ["p(95)<300"],
    "http_req_duration{phase:load,name:monitors}": ["p(95)<300"],
    "http_req_duration{phase:load,name:monitor}": ["p(95)<300"],
    "http_req_duration{phase:load,name:checks}": ["p(95)<300"],
    "http_req_duration{phase:load,name:uptime}": ["p(95)<300"],
    "http_req_duration{phase:load,name:incidents}": ["p(95)<300"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function expectStatus(res, status, what) {
  if (res.status !== status) fail(`${what}: expected ${status}, got ${res.status} ${res.body}`);
  return res.json();
}

export function setup() {
  // A free Render instance can take about a minute to wake up.
  const health = http.get(`${BASE_URL}/health`, { timeout: "120s", tags: { name: "setup" } });
  expectStatus(health, 200, "GET /health");

  const stamp = Date.now();
  const password = `k6-${Math.random().toString(36).slice(2)}-${stamp}`;
  const signup = http.post(
    `${BASE_URL}/v1/auth/signup`,
    JSON.stringify({ email: `k6-${stamp}@example.com`, password }),
    { headers: { "content-type": "application/json" }, tags: { name: "setup" } },
  );
  const { accessToken } = expectStatus(signup, 201, "signup");
  const auth = {
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    tags: { name: "setup" },
  };

  const project = expectStatus(
    http.post(
      `${BASE_URL}/v1/projects`,
      JSON.stringify({ name: "k6 load test", slug: `k6-${stamp}` }),
      auth,
    ),
    201,
    "create project",
  );

  const monitorIds = [];
  for (const [name, url] of [
    ["Example", "https://example.com/"],
    ["Example org", "https://example.org/"],
    ["Example net", "https://example.net/"],
  ]) {
    const monitor = expectStatus(
      http.post(
        `${BASE_URL}/v1/projects/${project.id}/monitors`,
        JSON.stringify({ name, url }),
        auth,
      ),
      201,
      `create monitor ${name}`,
    );
    monitorIds.push(monitor.id);
  }

  return { token: accessToken, projectId: project.id, monitorIds };
}

export default function (data) {
  const headers = { authorization: `Bearer ${data.token}` };
  const get = (path, name) => {
    const res = http.get(`${BASE_URL}${path}`, { headers, tags: { name } });
    check(res, { [`${name} 200`]: (r) => r.status === 200 });
    return res;
  };
  const monitorId = data.monitorIds[Math.floor(Math.random() * data.monitorIds.length)];

  // Projects page.
  get("/v1/me", "me");
  get("/v1/projects", "projects");
  sleep(1);

  // Project page: project, its monitors and incidents.
  get(`/v1/projects/${data.projectId}`, "project");
  get(`/v1/projects/${data.projectId}/monitors`, "monitors");
  get(`/v1/projects/${data.projectId}/incidents`, "incidents");
  sleep(2);

  // Monitor page: details, the 24-hour chart, then the 7-day one.
  get(`/v1/monitors/${monitorId}`, "monitor");
  get(`/v1/monitors/${monitorId}/checks?range=24h`, "checks");
  get(`/v1/monitors/${monitorId}/uptime?days=90`, "uptime");
  sleep(1);
  get(`/v1/monitors/${monitorId}/checks?range=7d`, "checks");
  sleep(2);
}

export function teardown(data) {
  const res = http.del(`${BASE_URL}/v1/projects/${data.projectId}`, null, {
    headers: { authorization: `Bearer ${data.token}` },
    tags: { name: "setup" },
  });
  check(res, { "project deleted": (r) => r.status === 204 });
}
