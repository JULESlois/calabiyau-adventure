// 无 React 测试外壳:直接实例化引擎,用于无依赖冒烟测试与独立打包。
import { Engine } from '../src/game/Engine';
import { VIEW_H, VIEW_W } from '../src/game/constants';

const canvas = document.createElement('canvas');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
canvas.style.width = `${VIEW_W * 2}px`;
canvas.style.height = `${VIEW_H * 2}px`;
canvas.style.imageRendering = 'pixelated';
canvas.style.display = 'block';
canvas.style.margin = '24px auto';
document.body.style.background = '#0b0e1a';
document.body.style.margin = '0';
document.body.appendChild(canvas);

const engine = new Engine(canvas);
engine.start();
