import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStreamUrl,
  detectEndpointConflicts,
  generateIpAssignments,
  intToIp,
  ipToInt,
  isValidIPv4,
  isValidPort,
} from './ipUtils';
import { createInitialStore } from './seedData';

test('isValidIPv4 validates standard addresses and rejects malformed octets', () => {
  assert.equal(isValidIPv4('192.168.178.1'), true);
  assert.equal(isValidIPv4('239.0.1.50'), true);
  assert.equal(isValidIPv4('0.0.0.0'), true);
  assert.equal(isValidIPv4('256.168.1.1'), false);
  assert.equal(isValidIPv4('192.168.01.1'), false);
  assert.equal(isValidIPv4('192.168.1'), false);
  assert.equal(isValidIPv4('nicht-eine-ip'), false);
});

test('isValidPort checks TCP/UDP port bounds', () => {
  assert.equal(isValidPort(1), true);
  assert.equal(isValidPort(8080), true);
  assert.equal(isValidPort(65535), true);
  assert.equal(isValidPort(0), false);
  assert.equal(isValidPort(65536), false);
  assert.equal(isValidPort(80.5), false);
});

test('ipToInt and intToIp round-trip cleanly', () => {
  const ip = '192.168.178.254';
  const num = ipToInt(ip);
  assert.equal(intToIp(num), ip);
  assert.equal(intToIp(num + 2), '192.168.179.0');
});

test('buildStreamUrl formats HTTP, HTTPS, and UDP multicast URLs', () => {
  assert.equal(
    buildStreamUrl({
      protocol: 'http',
      ip: '192.168.178.50',
      port: 8001,
      path: '/live/sky',
    }),
    'http://192.168.178.50:8001/live/sky'
  );
  assert.equal(
    buildStreamUrl({
      protocol: 'udp',
      ip: '239.0.1.10',
      port: 5000,
      path: '/ignored',
    }),
    'udp://@239.0.1.10:5000'
  );
  assert.equal(
    buildStreamUrl(
      { protocol: 'http', ip: '192.168.178.50', port: 8001, path: 'live/test' },
      'https'
    ),
    'https://192.168.178.50:8001/live/test'
  );
});

test('generateIpAssignments supports increment-port and increment-ip without conflicts', () => {
  const store = createInitialStore();
  const sample = store.channels.slice(0, 4);

  const portUpdated = generateIpAssignments(sample, {
    baseIp: '192.168.178.200',
    startPort: 9000,
    protocol: 'http',
    mode: 'increment-port',
    pathPrefix: '/tv',
    includeChannelSlugInPath: true,
  });

  assert.equal(portUpdated[0].ip, '192.168.178.200');
  assert.equal(portUpdated[0].port, 9000);
  assert.equal(portUpdated[3].port, 9003);
  assert.equal(portUpdated[0].path.startsWith('/tv/'), true);
  assert.equal(detectEndpointConflicts(portUpdated).length, 0);

  const ipUpdated = generateIpAssignments(sample, {
    baseIp: '239.0.1.10',
    startPort: 5000,
    protocol: 'udp',
    mode: 'increment-ip',
    pathPrefix: '',
    includeChannelSlugInPath: false,
  });

  assert.equal(ipUpdated[0].ip, '239.0.1.10');
  assert.equal(ipUpdated[2].ip, '239.0.1.12');
  assert.equal(ipUpdated[2].port, 5000);
  assert.equal(ipUpdated[2].path, '');
});

test('detectEndpointConflicts finds duplicate active endpoints', () => {
  const store = createInitialStore();
  const a = { ...store.channels[0], ip: '10.0.0.5', port: 8000, path: '/live/dup' };
  const b = { ...store.channels[1], ip: '10.0.0.5', port: 8000, path: '/live/dup' };
  const conflicts = detectEndpointConflicts([a, b]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].channels.length, 2);
});
