// Small axonometric part studies, drawn as mechanical illustrations rather than UI glyphs.
const parts = {
  base: `<path fill="currentColor" opacity=".055" d="m12 36 20-7 20 7v12l-20 8-20-8z"/>
    <path d="m12 36 20-7 20 7-20 8zM12 36v12l20 8 20-8V36M32 44v12"/>
    <ellipse cx="32" cy="31" rx="15" ry="5.8"/><path d="M17 31v9c0 3.2 6.7 5.8 15 5.8s15-2.6 15-5.8v-9"/>
    <ellipse cx="32" cy="24" rx="8" ry="3.2"/><path d="M24 24v8c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-8"/>
    <ellipse cx="32" cy="16" rx="5" ry="2.1"/><path d="M27 16v9c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1v-9"/>
    <path d="m12 43-5 3v7l5 2 5-3v-7M7 46l5 2 5-3M12 48v7m35-10 5-2 5 3v7l-5 2-5-3M52 48v7m-28-2 3 1v4l-3 1-3-1v-4z"/>
    <ellipse cx="12" cy="50" rx="1.1" ry="1.7"/><ellipse cx="52" cy="50" rx="1.1" ry="1.7"/>
    <path opacity=".45" d="m19 37 7 3m15-3-7 3M20 48l7 3m10 0 7-3"/>`,
  shoulder: `<path fill="currentColor" opacity=".055" d="m13 45 24-28 9 3-22 31z"/>
    <path d="m13 44 25-29 8 3-24 31M19 51l25-30M14 46l7 3 3 7M39 15l5 6"/>
    <ellipse cx="15" cy="48" rx="7.5" ry="9" transform="rotate(-35 15 48)"/>
    <ellipse cx="15" cy="48" rx="4.5" ry="5.7" transform="rotate(-35 15 48)"/>
    <ellipse cx="15" cy="48" rx="2" ry="2.7" transform="rotate(-35 15 48)"/>
    <path d="m10 40 5-2c4-1 9 4 10 9s-1 9-4 10l-3 1"/>
    <ellipse cx="43" cy="17" rx="7.5" ry="9" transform="rotate(-35 43 17)"/>
    <ellipse cx="43" cy="17" rx="4.6" ry="5.7" transform="rotate(-35 43 17)"/>
    <ellipse cx="43" cy="17" rx="2" ry="2.7" transform="rotate(-35 43 17)"/>
    <path d="m39 9 5-2c4-1 9 4 10 9s-1 9-4 10l-3 1M25 35l8-10M28 38l8-10"/>
    <path opacity=".45" d="m22 37 13-15m-9 19 12-15M12 44l2-1m2 9 2-1M40 13l2-1m2 9 2-1"/>`,
  elbow: `<path fill="currentColor" opacity=".055" d="m23 49 8-34 9 2-7 35z"/>
    <path d="m23 48 8-33 7 1-7 35M31 51l8-33 4-2-7 35M31 15l5-3 7 4M26 47l6-26M30 47l6-26"/>
    <ellipse cx="27" cy="52" rx="7" ry="7.7" transform="rotate(-15 27 52)"/>
    <ellipse cx="27" cy="52" rx="4.2" ry="4.8" transform="rotate(-15 27 52)"/>
    <ellipse cx="27" cy="52" rx="1.7" ry="2"/>
    <path d="m26 44 5-1c4 0 7 4 7 8s-2 8-6 9l-5 1"/>
    <ellipse cx="35" cy="13" rx="6.5" ry="7" transform="rotate(-15 35 13)"/>
    <ellipse cx="35" cy="13" rx="3.6" ry="4" transform="rotate(-15 35 13)"/>
    <path d="m34 6 5-1c4 0 7 4 7 8s-2 7-5 8l-4 1M36 10v5"/>
    <path opacity=".45" d="m26 30 2 .5m-4 9 2 .5m9-17 3 1m-7 30 2-1"/>`,
  gripper: `<path fill="currentColor" opacity=".055" d="m23 24 10-4 10 4v18l-10 4-10-4z"/>
    <ellipse cx="33" cy="12" rx="7" ry="3"/><path d="M26 12v11c0 1.7 3.1 3 7 3s7-1.3 7-3V12"/>
    <ellipse cx="33" cy="21" rx="7" ry="3"/><path d="m23 26 10-4 10 4-10 4zM23 26v14l10 5 10-5V26M33 30v15"/>
    <path d="m26 41-6 5v12l5 2 4-2V47m11-6 6 4v13l-5 2-4-2V47M20 46l5 2 4-1M25 48v12M37 47l4 1 5-3M41 48v12"/>
    <path d="M29 32v7m8-7v7M30 10v5m6-5v5"/>
    <ellipse cx="27" cy="35" rx="1" ry="1.4"/><ellipse cx="39" cy="35" rx="1" ry="1.4"/>
    <path opacity=".45" d="M23 51v5m20-6v6M27 17c3 2 9 2 12 0"/>`,
};
export const structureIcon = (name: keyof typeof parts) => `<svg class="part-study" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width=".85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts[name]}</svg>`;
