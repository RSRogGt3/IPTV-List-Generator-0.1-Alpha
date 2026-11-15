import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import {
  Channel,
  ChannelReachabilityResult,
  ChannelReachabilityStatus,
} from './types';

export type ReachabilityTrafficLight = 'green' | 'yellow' | 'red' | 'pending';

export const DEFAULT_REACHABILITY_INTERVAL_MS = 30_000;
export const MIN_REACHABILITY_INTERVAL_MS = 10_000;
export const MAX_REACHABILITY_INTERVAL_MS = 3_600_000;
export const REACHABILITY_INTERVAL_STORAGE_KEY =
  'streamgrid.reachabilityIntervalMs';

export const REACHABILITY_INTERVAL_PRESETS: { ms: number; label: string }[] = [
  { ms: 15_000, label: '15 Sekunden' },
  { ms: 30_000, label: '30 Sekunden' },
  { ms: 60_000, label: '1 Minute' },
  { ms: 300_000, label: '5 Minuten' },
  { ms: 900_000, label: '15 Minuten' },
  { ms: 0, label: 'Manuell (Aus)' },
];

const CHUNK_SIZE = 40;

export function normalizeReachabilityIntervalMs(rawMs: number): number {
  if (!Number.isFinite(rawMs)) return DEFAULT_REACHABILITY_INTERVAL_MS;
  const rounded = Math.round(rawMs);
  if (rounded <= 0) return 0;
  return Math.max(
    MIN_REACHABILITY_INTERVAL_MS,
    Math.min(MAX_REACHABILITY_INTERVAL_MS, rounded)
  );
}

export function formatReachabilityIntervalLabel(ms: number): string {
  const normalized = normalizeReachabilityIntervalMs(ms);
  if (normalized === 0) return 'Manuell';
  if (normalized < 60_000) return `${Math.round(normalized / 1000)}s`;
  if (normalized % 60_000 === 0) return `${normalized / 60_000}m`;
  return `${Math.round(normalized / 1000)}s`;
}

export function readStoredReachabilityIntervalMs(): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_REACHABILITY_INTERVAL_MS;
    }
    const raw = window.localStorage.getItem(REACHABILITY_INTERVAL_STORAGE_KEY);
    if (raw === null) return DEFAULT_REACHABILITY_INTERVAL_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_REACHABILITY_INTERVAL_MS;
    return normalizeReachabilityIntervalMs(parsed);
  } catch {
    return DEFAULT_REACHABILITY_INTERVAL_MS;
  }
}

export function writeStoredReachabilityIntervalMs(ms: number): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        REACHABILITY_INTERVAL_STORAGE_KEY,
        String(normalizeReachabilityIntervalMs(ms))
      );
    }
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function getReachabilityTrafficLight(
  result: ChannelReachabilityResult | undefined
): ReachabilityTrafficLight {
  if (!result) return 'pending';
  const status: ChannelReachabilityStatus = result.status;
  if (status === 'reachable') return 'green';
  if (status === 'private-lan') return 'yellow';
  return 'red';
}

export function getReachabilityLabel(
  result: ChannelReachabilityResult | undefined,
  checking: boolean
): string {
  if (!result) {
    return checking ? 'Prüft…' : 'Wartet…';
  }
  switch (result.status) {
    case 'reachable':
      return 'Erreichbar';
    case 'private-lan':
      return 'Lokales LAN';
    case 'timeout':
      return 'Timeout';
    case 'invalid':
      return 'Ungültig';
    case 'unreachable':
    default:
      return 'Nicht erreichbar';
  }
}

export function useEndpointReachability(
  channels: Channel[],
  storeLoading: boolean
) {
  const [reachabilityById, setReachabilityById] = useState<
    Record<string, ChannelReachabilityResult>
  >({});
  const [checkingReachability, setCheckingReachability] = useState(false);
  const [lastReachabilityAt, setLastReachabilityAt] = useState<string | null>(
    null
  );
  const [intervalMs, setIntervalMsState] = useState<number>(() =>
    readStoredReachabilityIntervalMs()
  );

  const setIntervalMs = useCallback((nextMs: number) => {
    const normalized = normalizeReachabilityIntervalMs(nextMs);
    setIntervalMsState(normalized);
    writeStoredReachabilityIntervalMs(normalized);
  }, []);

  const channelsRef = useRef<Channel[]>(channels);
  channelsRef.current = channels;
  const inFlightRef = useRef(false);
  const runIdRef = useRef(0);

  const endpointSignature = useMemo(
    () =>
      channels
        .map(
          (c) =>
            `${c.id}:${c.protocol}:${c.ip}:${c.port}:${c.path}:${c.upstreamUrl ?? ''}`
        )
        .join('|'),
    [channels]
  );

  // Drop results for deleted channels cleanly
  useEffect(() => {
    const validIds = new Set(channels.map((c) => c.id));
    setReachabilityById((prev) => {
      let changed = false;
      const next: Record<string, ChannelReachabilityResult> = {};
      for (const [id, val] of Object.entries(prev)) {
        if (validIds.has(id)) {
          next[id] = val;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [channels]);

  const runReachabilityCheck = useCallback(async (force = false) => {
    const list = channelsRef.current;
    if (list.length === 0) return;
    if (inFlightRef.current && !force) return;

    const myRunId = ++runIdRef.current;
    inFlightRef.current = true;
    setCheckingReachability(true);

    try {
      for (let i = 0; i < list.length; i += CHUNK_SIZE) {
        if (runIdRef.current !== myRunId) return;
        const batch = list.slice(i, i + CHUNK_SIZE);
        const res = await api.checkEndpoints(batch);
        if (runIdRef.current !== myRunId) return;

        setReachabilityById((prev) => {
          const next = { ...prev };
          for (const item of res.results) {
            next[item.channelId] = item;
          }
          return next;
        });
      }
      if (runIdRef.current === myRunId) {
        setLastReachabilityAt(new Date().toISOString());
      }
    } catch {
      // Background check failure should not block UI editing
    } finally {
      if (runIdRef.current === myRunId) {
        inFlightRef.current = false;
        setCheckingReachability(false);
      }
    }
  }, []);

  // Trigger initial & endpoint-change debounced check, plus configurable background loop
  useEffect(() => {
    if (storeLoading || channelsRef.current.length === 0) return;

    const initialTimer = window.setTimeout(() => {
      if (!document.hidden) {
        runReachabilityCheck(false).catch(() => {});
      }
    }, 650);

    const interval =
      intervalMs > 0
        ? window.setInterval(() => {
            if (!document.hidden) {
              runReachabilityCheck(false).catch(() => {});
            }
          }, intervalMs)
        : null;

    const handleVisibility = () => {
      if (!document.hidden && intervalMs > 0 && !inFlightRef.current) {
        runReachabilityCheck(false).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearTimeout(initialTimer);
      if (interval !== null) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [storeLoading, endpointSignature, intervalMs, runReachabilityCheck]);

  return {
    reachabilityById,
    checkingReachability,
    lastReachabilityAt,
    intervalMs,
    setIntervalMs,
    checkReachabilityNow: () => runReachabilityCheck(true),
  };
}
