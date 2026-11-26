import { radians } from 'pdf-lib';

export function stampGeometry({ x, y, width, height }, toPdf) {
  const [left, bottom] = toPdf(x, y + height);
  const [right, bottomRight] = toPdf(x + width, y + height);
  const [topX, topY] = toPdf(x, y);
  return {
    x: left, y: bottom,
    width: Math.hypot(right - left, bottomRight - bottom),
    height: Math.hypot(topX - left, topY - bottom),
    rotate: radians(Math.atan2(bottomRight - bottom, right - left)),
  };
}

export function drawStamp(page, image, placement, toPdf) {
  page.drawImage(image, stampGeometry(placement, toPdf));
}
