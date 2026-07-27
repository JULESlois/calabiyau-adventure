export type PickupKind = 'heart' | 'energy' | 'crystal' | 'dust';

export interface Pickup {
  x: number; // 中心
  y: number;
  kind: PickupKind;
  t: number; // 浮动动画相位
  vy: number; // 掉落用
  landed: boolean;
}

export function makePickup(x: number, y: number, kind: PickupKind, drop = false): Pickup {
  return { x, y, kind, t: Math.random() * Math.PI * 2, vy: drop ? -120 : 0, landed: !drop };
}
