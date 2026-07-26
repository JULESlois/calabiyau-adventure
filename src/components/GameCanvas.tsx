import { useEffect, useRef } from 'react';
import { Engine } from '../game/Engine';
import { VIEW_W, VIEW_H } from '../game/constants';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React 18 StrictMode mounts twice in dev — guard against double engine.
    if (engineRef.current) return;

    const engine = new Engine(canvas);
    engineRef.current = engine;
    engine.start();

    const fit = () => {
      const shell = canvas.parentElement;
      if (!shell) return;
      const availW = shell.clientWidth - 16;
      const availH = shell.clientHeight - 8;
      const scale = Math.max(1, Math.floor(Math.min(availW / VIEW_W, availH / VIEW_H)));
      canvas.style.width = `${VIEW_W * scale}px`;
      canvas.style.height = `${VIEW_H * scale}px`;
    };
    fit();
    window.addEventListener('resize', fit);

    return () => {
      window.removeEventListener('resize', fit);
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      width={VIEW_W}
      height={VIEW_H}
      tabIndex={0}
    />
  );
}
