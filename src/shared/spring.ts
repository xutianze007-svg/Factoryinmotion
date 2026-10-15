/** Convert a Motion-style spring (visualDuration/bounce or stiffness/damping) to stiffness/damping. */
export function springToPhysics(s: {
  visualDuration?: number;
  bounce?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
}) {
  if (s.stiffness != null && s.damping != null) {
    const m = s.mass ?? 1;
    return { stiffness: s.stiffness / m, damping: s.damping / m };
  }
  const vd = Math.max(0.05, s.visualDuration ?? 0.38);
  const bounce = Math.min(0.95, Math.max(0, s.bounce ?? 0.1));
  const root = (2 * Math.PI) / (vd * 1.2);
  const stiffness = root * root;
  const damping = 2 * Math.max(0.05, 1 - bounce) * Math.sqrt(stiffness);
  return { stiffness, damping };
}
