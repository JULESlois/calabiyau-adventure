import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCanvasDisplaySize } from '../src/components/canvasSizing';

test('large containers use an integer pixel scale', () => {
  const size = calculateCanvasDisplaySize(1456, 818, 480, 270);
  assert.deepEqual(size, { width: 1440, height: 810, scale: 3 });
});

test('small containers shrink the canvas without cropping', () => {
  const size = calculateCanvasDisplaySize(320, 568, 480, 270);
  assert.ok(size.scale > 0 && size.scale < 1);
  assert.ok(size.width <= 320 - 16);
  assert.ok(size.height <= 568 - 8);
  assert.equal(size.width / size.height, 480 / 270);
});
