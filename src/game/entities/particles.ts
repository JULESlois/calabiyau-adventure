export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  grav: number;
  shape: 'square' | 'spark' | 'note' | 'snow' | 'paper';
}

export class ParticleSystem {
  list: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.list.length > 400) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      life: 0.5,
      size: 2,
      color: '#ffffff',
      grav: 0,
      shape: 'square',
      ...p,
      maxLife: p.life ?? 0.5,
    });
  }

  burst(
    x: number,
    y: number,
    count: number,
    color: string,
    speed = 90,
    life = 0.5,
    shape: Particle['shape'] = 'square',
    grav = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.5 + Math.random() * 0.5),
        color,
        size: 1 + Math.random() * 2,
        shape,
        grav,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.fillStyle = p.color;
      const s = p.size;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      switch (p.shape) {
        case 'spark':
          ctx.fillRect(x - s, y, s * 2, 1);
          ctx.fillRect(x, y - s, 1, s * 2);
          break;
        case 'note': {
          ctx.fillRect(x, y - 3, 1, 4);
          ctx.fillRect(x - 1, y, 2, 2);
          break;
        }
        case 'snow':
          ctx.fillRect(x, y, 1, 1);
          ctx.fillRect(x - 1, y, 1, 1);
          ctx.fillRect(x + 1, y, 1, 1);
          ctx.fillRect(x, y - 1, 1, 1);
          ctx.fillRect(x, y + 1, 1, 1);
          break;
        case 'paper':
          ctx.fillRect(x - 2, y, 4, 1);
          break;
        default:
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}
