import assert from 'node:assert/strict';
import test from 'node:test';
import { CircuitBreaker } from './circuitBreaker.js';

test('opens after the failure threshold and fast-fails', () => {
  const cb = new CircuitBreaker(3, 10_000);
  assert.equal(cb.isOpen(), false);
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.isOpen(), false, 'still closed below threshold');
  cb.recordFailure(); // 3rd → open
  assert.equal(cb.isOpen(), true);
});

test('a success resets the failure count', () => {
  const cb = new CircuitBreaker(3, 10_000);
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess();
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.isOpen(), false, 'success cleared the earlier failures');
});

test('half-opens after the cooldown elapses', () => {
  const cb = new CircuitBreaker(1, 0); // opens immediately, 0ms cooldown
  cb.recordFailure();
  // cooldown is 0ms, so the next check should already be half-open (closed).
  assert.equal(cb.isOpen(), false);
});
