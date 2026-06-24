// k6 SOAK test for Elfaria's public API (doc roadmap, "load/soak testing").
//
//   k6 run load/api-soak.js                                  # 2h, 30 VUs
//   VUS=50 DURATION=4h BASE_URL=http://elfaria-bot:8080 k6 run load/api-soak.js
//
// A long, steady, moderate load. The point isn't peak throughput — it's to catch
// slow problems: memory growth, event-loop lag creep, connection/handle leaks,
// and replica lag under sustained reporting reads. Watch the Grafana dashboard's
// memory + event-loop-lag panels (k8s/monitoring) across the run; a healthy soak
// is a FLAT line, not a slow climb.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 30),
      duration: __ENV.DURATION || '2h',
    },
  },
  thresholds: {
    // Looser than the ramp test — we care about stability over time, not peak.
    http_req_duration: ['p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // top-tracks is the heaviest read (an aggregate over the events table) — the
  // one most likely to expose a leak or replica lag over hours.
  const res = http.get(`${BASE}/api/top-tracks`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
