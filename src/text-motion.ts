// Lightweight Decrypted Text-style interaction for this vanilla TypeScript scene.
export function installTextMotion(root: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/[]<>_';
  const animations = new WeakMap<HTMLElement, number>();
  const selectors = '.nav-item, h1, .eyebrow, .instructions, .corner, .controls button:not(.icon-button), .live';
  for (const el of root.querySelectorAll<HTMLElement>(selectors)) {
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
      const wrapper = document.createElement('span'); wrapper.className = 'motion-text';
      const text = node.textContent;
      wrapper.setAttribute('aria-label', text);
      for (const char of text) { const span = document.createElement('span'); span.className = 'motion-char'; span.textContent = char; span.setAttribute('aria-hidden', 'true'); span.dataset.glyph = char; wrapper.append(span); }
      node.replaceWith(wrapper);
      function play() {
        if (reduced.matches || animations.has(wrapper)) return;
        const start = performance.now(); wrapper.classList.add('is-decoding');
        let lastStep = -1;
        function tick(now: number) {
          const progress = Math.min(1, (now - start) / 560); const step = Math.floor((now - start) / 42);
          if (step !== lastStep) { lastStep = step; [...wrapper.children].forEach((child, i) => { const span = child as HTMLElement; span.dataset.glyph = i / Math.max(1, text.length) < progress || text[i] === ' ' ? text[i] : glyphs[Math.floor(Math.random() * glyphs.length)]; }); }
          if (progress < 1) animations.set(wrapper, requestAnimationFrame(tick));
          else { wrapper.classList.remove('is-decoding'); animations.delete(wrapper); }
        }
        animations.set(wrapper, requestAnimationFrame(tick));
      }
      el.addEventListener('pointerenter', play); el.addEventListener('focusin', play);
    }
  }
}
