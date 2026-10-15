import type { DialConfig } from 'dialkit/vanilla';

export const dialConfig = {
  view: {
    type: 'select',
    options: [
      { value: 'lidar', label: 'LiDAR' },
      { value: 'depth', label: 'Depth' },
    ],
    default: 'depth',
  },
  lens: {
    radius: [520, 80, 520, 1],
    cell: [16, 16, 128, 8],
    tiers: [1, 1, 3, 1],
    organic: [0.55, 0, 1, 0.01],
    drift: [0.22, 0, 2, 0.01],
    diamond: [0.15, 0, 1, 0.01],
    follow: { type: 'spring', visualDuration: 0.4, bounce: 0.08 },
    growth: {
      type: 'select',
      options: [
        { value: 'scale', label: 'Scale' },
        { value: 'blocks', label: 'Blocks (quarters)' },
      ],
      default: 'scale',
    },
    attack: [14, 2, 40, 0.5],
    release: [8, 0.5, 24, 0.1],
    processing: [0.18, 0, 1, 0.01],
  },
  machine: {
    colorBy: {
      type: 'select',
      options: [
        { value: 'distance', label: 'Distance (turbo)' },
        { value: 'height', label: 'Height' },
        { value: 'class', label: 'Class' },
      ],
      default: 'height',
    },
    pointSize: [2.6, 0.6, 6, 0.1],
    sweep: [0.9, 0, 1, 0.01],
    edgeGlow: [1, 0, 3, 0.01],
    edgeColor: '#40e8ff',
  },
  // every visual layer, so the scene can be stripped back (handy when zoomed in)
  layers: {
    lattice: false,
    gridMarks: false,
    scanBoxes: true,
    groundRings: false,
    facadePoints: true,
    agentPoints: true,
    depthContours: false,
    boxes: true,
    trajectories: true,
    ghosts: true,
    focusRing: true,
    alerts: true,
    connections: {
      type: 'select',
      options: [
        { value: 'all', label: 'All' },
        { value: 'inside', label: 'Inside the reveal only' },
        { value: 'off', label: 'Off' },
      ],
      default: 'all',
    },
    corridor: true,
  },
  world: {
    timeScale: [1, 0, 2, 0.01],
    traffic: [1, 0.3, 1.8, 0.01],
    jaywalkers: [0.22, 0, 0.6, 0.01],
    sunHour: [17.4, 7, 19.4, 0.05],
  },
  post: {
    quality: {
      type: 'select',
      options: [
        { value: 'ultra', label: 'Ultra (2×)' },
        { value: 'high', label: 'High (1.5×)' },
        { value: 'medium', label: 'Medium (1.25×)' },
        { value: 'low', label: 'Low (1×, no AO)' },
      ],
      default: 'high',
    },
    ao: [1, 0, 2, 0.01],
    tiltShift: [0.6, 0, 1, 0.01],
    bloom: [0.85, 0, 3, 0.01],
    bloomThreshold: [1, 0.2, 3, 0.01],
    grain: [0.16, 0, 0.6, 0.01],
    vignette: [0.42, 0, 1, 0.01],
    exposure: [1, 0.4, 2, 0.01],
  },
  camera: {
    zoom: [6.09, 1, 8, 0.01],
    orbit: [72, -180, 180, 0.5],
    pitch: [31.76, 16, 88, 0.01],
    tiltIn: [0.55, 0, 1, 0.01],
    invertRotate: false,
    invertPan: false,
    smoothing: [0.35, 0.05, 1.5, 0.01],
    sway: [1, 0, 3, 0.01],
    reset: { type: 'action', label: 'Reset camera' },
  },
  tracking: {
    follow: true,
    lensLock: true,
    releaseOffscreen: true,
    xray: {
      type: 'select',
      options: [
        { value: 'tracked', label: 'Tracked road user' },
        { value: 'focused', label: 'Whatever is being read' },
        { value: 'off', label: 'Off' },
      ],
      default: 'tracked',
    },
    xrayGhost: [0.16, 0, 0.6, 0.01],
    // tracking floods the whole screen with the machine view; releasing pulls it back to the lens
    fullscreen: true,
    floodTime: [0.9, 0.2, 3, 0.05],
  },
  ui: {
    scale: [1, 0.75, 2.5, 0.01],
    hudPanels: true,
  },
  intelligence: {
    card: true,
    labels: true,
    dwell: [90, 0, 400, 5],
  },
  replayIntro: { type: 'action', label: 'Replay intro' },
} satisfies DialConfig;
