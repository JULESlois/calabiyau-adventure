export interface CanvasDisplaySize {
  width: number;
  height: number;
  scale: number;
}

/** 大屏采用整数倍像素，小屏等比缩小并完整落在容器内。 */
export function calculateCanvasDisplaySize(
  containerWidth: number,
  containerHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  horizontalPadding = 16,
  verticalPadding = 8,
): CanvasDisplaySize {
  const availableWidth = Math.max(1, containerWidth - horizontalPadding);
  const availableHeight = Math.max(1, containerHeight - verticalPadding);
  const availableScale = Math.min(availableWidth / logicalWidth, availableHeight / logicalHeight);
  const scale = availableScale >= 1 ? Math.floor(availableScale) : availableScale;
  return {
    width: logicalWidth * scale,
    height: logicalHeight * scale,
    scale,
  };
}
