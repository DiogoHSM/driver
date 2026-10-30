import type { BlockStatus } from './phases.js';

export interface StatusColors {
  fill: string;
  stroke: string;
  text: string;
  strokeWidth: number;
  dashed?: boolean;
}

export const STATUS_COLORS: Record<BlockStatus, StatusColors> = {
  not_started: { fill: '#e5e7eb', stroke: '#6b7280', text: '#111827', strokeWidth: 1 },
  in_progress: { fill: '#bfdbfe', stroke: '#2563eb', text: '#111827', strokeWidth: 2.5 },
  blocked: { fill: '#fecaca', stroke: '#dc2626', text: '#111827', strokeWidth: 2.5 },
  in_review: { fill: '#fef08a', stroke: '#ca8a04', text: '#111827', strokeWidth: 2 },
  done: { fill: '#bbf7d0', stroke: '#16a34a', text: '#111827', strokeWidth: 1.5 },
  needs_rework: { fill: '#fed7aa', stroke: '#ea580c', text: '#111827', strokeWidth: 2.5, dashed: true },
};

export const ACCENT = '#2563eb';
export const EDGE_PENDING = '#6b7280';
export const EDGE_DONE = '#9ca3af';
export const EDGE_BACK = '#dc2626';
export const GATE_OK = '#16a34a';
export const GATE_PENDING = '#ca8a04';
export const LANE_BG = 'rgba(127,127,127,.08)';
export const TEXT_DARK = '#111827';
export const TEXT_MUTED = '#6b7280';
