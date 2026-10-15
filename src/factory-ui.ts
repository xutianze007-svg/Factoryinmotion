import { installTextMotion } from './text-motion';
import type { LensGrid } from './lens/grid';

import { structureIcon as icon } from './structure-icons';

export function mountFactoryUI(app: HTMLElement) {
  app.innerHTML = `<canvas></canvas><div id="interface"><header><button class="brand" id="home" aria-label="KINET overview"><svg class="wordmark" viewBox="0 0 222 52" role="img" aria-label="KINET"><path d="M0 2h11v19L28 2h14L20 26l23 24H28L11 32v18H0z"/><path d="M49 2h12v48H49z"/><path d="M70 2h12l20 29V2h12v48h-12L82 21v29H70z"/><path d="M124 2h38v10h-26v9h23v10h-23v9h26v10h-38z"/><path d="M171 2h49v11h-18v37h-12V13h-19z"/></svg></button><nav aria-label="Factory navigation"><button class="nav-item active" data-tab="overview">Overview</button><button class="nav-item" data-tab="systems">Systems</button><button class="nav-item" data-tab="technical">Technical</button></nav><div class="live"><i></i>LIVE SIMULATION</div></header><section class="intro"><div class="eyebrow">INDUSTRIAL INTELLIGENCE / 004</div><h1>Factory in motion.</h1><p>A living production line.<br>Two ways of seeing it.</p></section><aside class="readout" aria-label="Equipment inspector"><div class="panel-kicker">LIVE INSPECTION <span>↗</span></div><h2 id="equipment-title">FACTORY / 01</h2><p class="equipment-subtitle" id="equipment-subtitle">Interactive production system</p><div class="parameters"><div><span id="param-one-label">Transport</span><b id="param-one">1.30 m/s</b></div><div><span id="param-two-label">Units sorted</span><b id="param-two">0000</b></div><div><span>Status</span><b id="stage">Running</b></div></div><details open id="structure-panel"><summary>Structure<span></span></summary><div id="structure-list" class="structure-list"><div>${icon('base')}<span>Base</span></div><div>${icon('shoulder')}<span>Shoulder</span></div><div>${icon('elbow')}<span>Elbow</span></div><div>${icon('gripper')}<span>Gripper</span></div></div></details><details id="drive-panel"><summary>Drive system<span></span></summary><p>Motor → gearbox → chain → rollers<br>Linked mechanical motion at 1.30 m/s.</p><button class="inline-action" id="inspect-drive">Inspect transmission ↗</button></details><details id="spec-panel"><summary>Specifications<span></span></summary><p>2 articulated robots · 2 transport lines<br>14 circulating packages<br>Local visual simulation</p></details><div class="inspection" id="inspection"></div><div class="panel-bottom"><i></i><span>SIMULATED TELEMETRY</span><span id="units">0000</span></div></aside><footer><div class="instructions">MOVE TO INSPECT · DRAG TO ORBIT · SCROLL TO ZOOM</div><div class="controls" role="group" aria-label="Scene controls"><button id="physical">Physical</button><button id="mode" class="active">Section</button><button id="detail">Drive detail</button><button id="pause" class="icon-button" aria-label="Pause production">Ⅱ</button><button id="reset" class="icon-button" aria-label="Reset camera">↻</button></div><div class="corner">KINET LABS / FACTORY SIGHT</div></footer><div class="credit">Based on <a href="https://github.com/kaolti/machine-sight" target="_blank" rel="noopener noreferrer">Machine Sight by Zsolt Kacso / Whitespace</a></div></div><div id="labels"></div><div id="scan-copy" aria-hidden="true" inert></div>`;
  const ui = app.querySelector<HTMLElement>('#interface')!;
  const copy = app.querySelector<HTMLElement>('#scan-copy')!;
  installTextMotion(ui);
  let next = 0;
  return { update(time: number, grid: LensGrid, full: boolean) {
    if (time < next) return; next = time + .09;
    copy.innerHTML = ui.innerHTML;
    for (const e of copy.querySelectorAll('[id]')) e.removeAttribute('id');
    const inset = innerWidth <= 760 ? 8 : 14;
    const cell = grid.fineSize(); let path = '';
    for (let y = 0; y < innerHeight; y += cell) {
      let start = -1;
      for (let x = 0; x <= innerWidth + cell; x += cell) {
        const on = x < innerWidth && (full || grid.coverage(x + cell / 2, y + cell / 2) > .65);
        if (on && start < 0) start = x;
        if (!on && start >= 0) { path += `M${start - inset} ${y - inset}H${x - inset}V${y + cell - inset}H${start - inset}Z`; start = -1; }
      }
    }
    copy.style.clipPath = path ? `path('${path}')` : 'inset(100%)';
  } };
}
