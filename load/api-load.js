// k6 load test for Elfaria's public stats API (doc roadmap, "load/soak testing").
//
//   k6 run load/api-load.js                         # against localhost:8080
//   BASE_URL=http://elfaria-bot:8080 k6 run load/api-load.js
//
// Ramps virtual users up to a sustained peak and back down while hitting the
// read-only API endpoints. The thresholds mirror the SLOs (docs/SLO.md): if p95
// latency or the error rate blow past budget, k6 exits non-zero — so this can
// gate a release in CI.
//
// What this validates: the bot's HTTP/CPU headroom and that command-success /
// latency SLOs hold under request load. See load/README.md for using it
// alongside `kubectl get hpa -w` to watch autoscaling thresholds.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const errors = new Rate('elfaria_api_errors');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 }, // warm up
        { duration: '3m', target: 200 }, // ramp to peak
        { duration: '3m', target: 200 }, // hold at peak
        { duration: '1m', target: 0 }, // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'], // command-latency SLO: 95% < 1s
    http_req_failed: ['rate<0.01'], // command-success SLO: < 1% errors
    elfaria_api_errors: ['rate<0.01'],
  },
};

const ENDPOINTS = ['/api/health', '/api/stats', '/api/top-tracks'];

export default function () {
  const path = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = http.get(`${BASE}${path}`, { tags: { endpoint: path } });
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body is JSON': (r) => String(r.headers['Content-Type'] || '').includes('application/json'),
  });
  errors.add(!ok);
  sleep(Math.random() * 0.5);
}
