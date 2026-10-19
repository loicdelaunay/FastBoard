const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8', '#ec4899', '#a855f7', '#facc15'];
const MIN_GAP_MS = 1200;
const DURATION_MS = 3600;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  round: boolean;
  wobble: number;
  wobbleSpeed: number;
}

let lastLaunch = 0;
let running = false;

/** Deux canons à confettis (bas gauche et bas droit) : une pluie de papier coloré qui retombe. */
export function launchConfetti(origin?: { x: number; y: number }): void {
  const now = Date.now();
  if (running || now - lastLaunch < MIN_GAP_MS || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  lastLaunch = now;
  running = true;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '99999' });
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  document.body.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.remove();
    running = false;
    return;
  }
  context.scale(ratio, ratio);

  const width = window.innerWidth;
  const height = window.innerHeight;
  const particles: Particle[] = [];
  const burst = (x: number, y: number, direction: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      const angle = (-Math.PI / 2 + direction * (0.15 + Math.random() * 0.55)) + (Math.random() - 0.5) * 0.4;
      const speed = 11 + Math.random() * 13;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        round: Math.random() < 0.25,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.08 + Math.random() * 0.12,
      });
    }
  };
  if (origin) {
    burst(origin.x, origin.y, -1, 55);
    burst(origin.x, origin.y, 1, 55);
  } else {
    burst(width * 0.08, height * 0.95, 1, 70);
    burst(width * 0.92, height * 0.95, -1, 70);
  }

  const start = performance.now();
  const frame = (time: number): void => {
    const elapsed = time - start;
    context.clearRect(0, 0, width, height);
    const fade = elapsed > DURATION_MS - 900 ? Math.max(0, (DURATION_MS - elapsed) / 900) : 1;
    for (const p of particles) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.42;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.wobble += p.wobbleSpeed;
      context.save();
      context.globalAlpha = fade;
      context.translate(p.x, p.y);
      context.rotate(p.rotation);
      context.scale(1, Math.abs(Math.cos(p.wobble)) * 0.8 + 0.2);
      context.fillStyle = p.color;
      if (p.round) {
        context.beginPath();
        context.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      }
      context.restore();
    }
    if (elapsed < DURATION_MS) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
      running = false;
    }
  };
  requestAnimationFrame(frame);
}
