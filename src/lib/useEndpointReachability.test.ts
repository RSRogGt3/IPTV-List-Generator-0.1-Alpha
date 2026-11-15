import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelReachabilityResult } from './types';
import {
  DEFAULT_REACHABILITY_INTERVAL_MS,
  REACHABILITY_INTERVAL_PRESETS,
  formatReachabilityIntervalLabel,
  getReachabilityLabel,
  getReachabilityTrafficLight,
  normalizeReachabilityIntervalMs,
} from './useEndpointReachability';

function makeResult(
  status: ChannelReachabilityResult['status']
): ChannelReachabilityResult {
  return {
    channelId: 'ch-1',
    targetUrl: 'http://192.168.178.10:8001/live/ch-1',
    source: 'local-ip',
    status,
    detail: 'test detail',
    checkedAt: '2026-11-15T12:00:00.000Z',
  };
}

test('getReachabilityTrafficLight maps statuses to green, yellow, red, pending', () => {
  assert.equal(getReachabilityTrafficLight(undefined), 'pending');
  assert.equal(getReachabilityTrafficLight(makeResult('reachable')), 'green');
  assert.equal(getReachabilityTrafficLight(makeResult('private-lan')), 'yellow');
  assert.equal(getReachabilityTrafficLight(makeResult('unreachable')), 'red');
  assert.equal(getReachabilityTrafficLight(makeResult('timeout')), 'red');
  assert.equal(getReachabilityTrafficLight(makeResult('invalid')), 'red');
});

test('getReachabilityLabel returns accurate German labels', () => {
  assert.equal(getReachabilityLabel(undefined, true), 'Prüft…');
  assert.equal(getReachabilityLabel(undefined, false), 'Wartet…');
  assert.equal(getReachabilityLabel(makeResult('reachable'), false), 'Erreichbar');
  assert.equal(getReachabilityLabel(makeResult('private-lan'), false), 'Lokales LAN');
  assert.equal(getReachabilityLabel(makeResult('timeout'), false), 'Timeout');
  assert.equal(getReachabilityLabel(makeResult('invalid'), false), 'Ungültig');
  assert.equal(
    getReachabilityLabel(makeResult('unreachable'), false),
    'Nicht erreichbar'
  );
});

test('normalizeReachabilityIntervalMs clamps custom values and preserves manual mode', () => {
  assert.equal(normalizeReachabilityIntervalMs(0), 0);
  assert.equal(normalizeReachabilityIntervalMs(-5000), 0);
  assert.equal(normalizeReachabilityIntervalMs(2000), 10_000);
  assert.equal(normalizeReachabilityIntervalMs(30_000), 30_000);
  assert.equal(normalizeReachabilityIntervalMs(9_999_999), 3_600_000);
  assert.equal(
    normalizeReachabilityIntervalMs(Number.NaN),
    DEFAULT_REACHABILITY_INTERVAL_MS
  );
  assert.ok(REACHABILITY_INTERVAL_PRESETS.some((p) => p.ms === 30_000));
  assert.ok(REACHABILITY_INTERVAL_PRESETS.some((p) => p.ms === 60_000));
  assert.ok(REACHABILITY_INTERVAL_PRESETS.some((p) => p.ms === 300_000));
});

test('formatReachabilityIntervalLabel formats seconds, minutes, and manual mode cleanly', () => {
  assert.equal(formatReachabilityIntervalLabel(0), 'Manuell');
  assert.equal(formatReachabilityIntervalLabel(30_000), '30s');
  assert.equal(formatReachabilityIntervalLabel(60_000), '1m');
  assert.equal(formatReachabilityIntervalLabel(300_000), '5m');
  assert.equal(formatReachabilityIntervalLabel(90_000), '90s');
});
