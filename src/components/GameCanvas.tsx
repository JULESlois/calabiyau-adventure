import { useEffect, useRef } from 'react';
import { Engine } from '../game/Engine';
import { VIEW_W, VIEW_H } from '../game/constants';
import { calculateCanvasDisplaySize } from './canvasSizing';

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const uiCanvas = uiCanvasRef.current;
    if (!canvas) return;
    // React 18 StrictMode mounts twice in dev — guard against double engine.
    if (engineRef.current) return;

    const engine = new Engine(canvas);
    engineRef.current = engine;
    engine.start();

    const fit = () => {
      const shell = canvas.parentElement?.parentElement ?? canvas.parentElement;
      if (!shell) return;
      const display = calculateCanvasDisplaySize(shell.clientWidth, shell.clientHeight, VIEW_W, VIEW_H);
      canvas.style.width = `${display.width}px`;
      canvas.style.height = `${display.height}px`;
      if (uiCanvas) {
        // UI 画布按显示分辨率(含 dpr)开背板:文字在真实像素上栅格化,
        // 世界画面仍是 480×270 整数放大 —— 像素风与可读性各取所需。
        const dpr = window.devicePixelRatio || 1;
        uiCanvas.style.width = `${display.width}px`;
        uiCanvas.style.height = `${display.height}px`;
        uiCanvas.width = Math.max(1, Math.round(display.width * dpr));
        uiCanvas.height = Math.max(1, Math.round(display.height * dpr));
        engine.setUiSurface(uiCanvas, display.scale * dpr);
      }
    };
    fit();
    window.addEventListener('resize', fit);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (canvas.parentElement) resizeObserver?.observe(canvas.parentElement);

    return () => {
      window.removeEventListener('resize', fit);
      resizeObserver?.disconnect();
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  return (
    <>
      <div className="game-canvas-stack" style={{ position: 'relative', display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          width={VIEW_W}
          height={VIEW_H}
          tabIndex={0}
          aria-label="卡拉比丘弦间冒险游戏画面"
          aria-describedby="game-controls"
        >
          当前浏览器不支持 Canvas，无法运行游戏。
        </canvas>
        <canvas
          ref={uiCanvasRef}
          className="game-canvas-ui"
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
        />
      </div>
      <p id="game-controls" className="sr-only">
        A、D 移动，空格跳跃，J 射击，K 近战，L 技能，Shift 弦化或空中飘飞，E 贴墙，F 交互，Escape 暂停。
      </p>
    </>
  );
}
