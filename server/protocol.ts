export type Point = { x: number; y: number; p: number };
export type Stroke = { id: string; points: Point[]; color: string; width: number; author: string; order: number };
export const MAX_POINTS = 600;
export const MAX_STROKES = 100000;
export const MAX_BOARD_POINTS = 2000000;
export const DEFAULT_COLOR = '#b31919';
export const COLORS = ['#303b35','#b31919','#3e83b7','#a16bc0','#e47f55','#789542','#c49c31'];
export function validColor(value: unknown): value is string { return typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value); }
export function validPoint(p: unknown): p is Point { const v = p as Point; return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) <= 1e7 && Math.abs(v.y) <= 1e7 && Number.isFinite(v.p) && v.p >= 0 && v.p <= 1; }
export function validStroke(s: unknown): s is Stroke { const v = s as Stroke; return !!v && typeof v.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v.id) && validColor(v.color) && Number.isFinite(v.width) && v.width >= 0.5 && v.width <= 40 && Array.isArray(v.points) && v.points.length > 0 && v.points.length <= MAX_POINTS && v.points.every(validPoint); }
