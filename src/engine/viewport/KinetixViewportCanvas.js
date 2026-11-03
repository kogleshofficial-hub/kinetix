import './kinetix-viewport.css';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class KinetixViewportCanvas {
  constructor({
    canvas,
    frame = canvas?.parentElement,
    getPalette = () => ['#75e8d2', '#b99cff', '#eff7ff'],
    reducedMotion = () => false
  } = {}) {
    if (!canvas || !frame) throw new TypeError('A game canvas and frame element are required.');
    this.canvas = canvas;
    this.frame = frame;
    this.getPalette = getPalette;
    this.reducedMotion = reducedMotion;
    this.fxCanvas = document.createElement('canvas');
    this.fxCanvas.className = 'kinetix-fx-canvas';
    this.fxCanvas.setAttribute('aria-hidden', 'true');
    this.frame.appendChild(this.fxCanvas);
    this.ctx = this.fxCanvas.getContext('2d', { alpha: true, desynchronized: true });
    this.flash = document.createElement('div');
    this.flash.className = 'kinetix-nova-flash';
    this.flash.setAttribute('aria-hidden', 'true');
    this.frame.appendChild(this.flash);
    this.particles = [];
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.lastFrame = 0;
    this.disposers = [];
    this.shakeAnimation = null;
    this.flashAnimation = null;
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(this.frame);
    this.resize();
  }

  connect(bus) {
    if (!bus?.on) throw new TypeError('A KinetixEventBus instance is required.');
    this.disposers.push(bus.on('combat:action', (event) => {
      if (event.kind === 'PULSE') {
        const style = event.details?.pulseStyle;
        const pattern = style === 'ARC' ? 'arc' : style === 'LINEAR' ? 'linear' : 'radial';
        this.burst({ player: event.player, strength: 0.75, pattern });
      }
      if (event.kind === 'GUARD') this.burst({ player: event.player, strength: 0.3, count: 8 });
      if (event.kind === 'PHASE_LEFT' || event.kind === 'PHASE_RIGHT') this.burst({ player: event.player, strength: 0.4, count: 10 });
    }));
    this.disposers.push(bus.on('combat:notice', (event) => {
      if (event.event === 'nova') this.nova();
    }));
    this.disposers.push(bus.on('combat:state', (event) => {
      if (event.state === 'TIME_CRITICAL') this.frame.dataset.critical = 'true';
      if (event.state === 'MATCH_OVER') delete this.frame.dataset.critical;
    }));
    return this;
  }

  resize() {
    const rect = this.frame.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    const pixelWidth = Math.max(1, Math.round(this.width * this.dpr));
    const pixelHeight = Math.max(1, Math.round(this.height * this.dpr));
    if (this.fxCanvas.width !== pixelWidth || this.fxCanvas.height !== pixelHeight) {
      this.fxCanvas.width = pixelWidth;
      this.fxCanvas.height = pixelHeight;
    }
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  burst({ player = 1, strength = 1, count = 18, pattern = 'radial' } = {}) {
    if (this.reducedMotion()) return;
    const palette = this.getPalette() || ['#75e8d2', '#b99cff', '#eff7ff'];
    const originX = player === 2 ? this.width * 0.75 : this.width * 0.25;
    const originY = this.height * 0.52;
    const total = clamp(Math.floor(count), 6, 20);
    const now = performance.now();

    for (let index = 0; index < total; index += 1) {
      const jitter = (Math.random() - 0.5) * 0.22;
      const forward = player === 2 ? Math.PI : 0;
      const angle = pattern === 'arc'
        ? forward + ((index / Math.max(1, total - 1)) - 0.5) * Math.PI * 0.72 + jitter
        : pattern === 'linear'
          ? forward + ((index / Math.max(1, total - 1)) - 0.5) * Math.PI * 0.18 + jitter
          : (Math.PI * 2 * index / total) + jitter;
      const speed = (55 + Math.random() * 140) * clamp(strength, 0.15, 1.5);
      this.particles.push({
        x: originX + (Math.random() - 0.5) * 18,
        y: originY + (Math.random() - 0.5) * 14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.1 + Math.random() * 2.6,
        color: palette[index % palette.length],
        born: now,
        life: 500 + Math.random() * 70
      });
    }
    if (this.particles.length > 320) this.particles.splice(0, this.particles.length - 320);
  }

  impact({ player = 1, damage = 0 } = {}) {
    this.burst({ player, strength: clamp(0.5 + Number(damage || 0) / 45, 0.5, 1.5), count: 20 });
    if (this.reducedMotion()) return;
    this.shakeAnimation?.cancel();
    this.shakeAnimation = this.frame.animate([
      { transform: 'translate3d(0,0,0)' },
      { transform: 'translate3d(-3px,1px,0)' },
      { transform: 'translate3d(3px,-1px,0)' },
      { transform: 'translate3d(-2px,0,0)' },
      { transform: 'translate3d(0,0,0)' }
    ], { duration: damage >= 25 ? 340 : 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }

  heal({ player = 1 } = {}) {
    this.burst({ player, strength: 0.35, count: 12 });
  }

  nova() {
    if (this.reducedMotion()) return;
    this.flashAnimation?.cancel();
    this.flashAnimation = this.flash.animate([
      { opacity: 0 },
      { opacity: 0.92, offset: 0.18 },
      { opacity: 0.35, offset: 0.52 },
      { opacity: 0 }
    ], { duration: 720, easing: 'ease-out' });
    this.burst({ player: 1, strength: 1.45, count: 20 });
  }

  render(now = performance.now()) {
    if (!this.ctx) return;
    const elapsed = this.lastFrame ? clamp((now - this.lastFrame) / 1000, 0, 0.05) : 0;
    this.lastFrame = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const gravity = 190;
    const survivors = [];
    for (const particle of this.particles) {
      const age = now - particle.born;
      const lifeRatio = clamp(age / particle.life, 0, 1);
      if (lifeRatio >= 1) continue;
      particle.vy += gravity * elapsed;
      particle.x += particle.vx * elapsed;
      particle.y += particle.vy * elapsed;
      const alpha = 1 - lifeRatio;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 9 * alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (1 - lifeRatio * 0.25), 0, Math.PI * 2);
      ctx.fill();
      survivors.push(particle);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    this.particles = survivors;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.particles.length = 0;
    this.fxCanvas.remove();
    this.flash.remove();
  }
}
