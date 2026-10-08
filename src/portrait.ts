import { tr } from '../shared/i18n';
import type { Portrait } from '../shared/model';

export type PortraitTransform = Omit<Portrait, 'source'>;
type ImageSize = { width: number; height: number };

export function defaultPortraitTransform(): PortraitTransform {
  return { zoom: 1, rotation: 0, flipX: false, offsetX: 0, offsetY: 0 };
}

// Offsets are relative to the square frame, so preview and saved image share a crop.
export function portraitBounds(size: ImageSize, transform: PortraitTransform) {
  const rotated = transform.rotation === 90 || transform.rotation === 270;
  const width = rotated ? size.height : size.width;
  const height = rotated ? size.width : size.height;
  const scale = transform.zoom / Math.min(width, height);
  return { x: Math.max(0, (width * scale - 1) / 2), y: Math.max(0, (height * scale - 1) / 2) };
}

export function clampPortraitTransform(
  size: ImageSize,
  transform: PortraitTransform,
): PortraitTransform {
  const zoom = Math.max(1, Math.min(4, transform.zoom));
  const bounds = portraitBounds(size, { ...transform, zoom });
  return {
    ...transform,
    zoom,
    offsetX: Math.max(-bounds.x, Math.min(bounds.x, transform.offsetX)) || 0,
    offsetY: Math.max(-bounds.y, Math.min(bounds.y, transform.offsetY)) || 0,
  };
}

export function rotatePortraitTransform(
  transform: PortraitTransform,
  direction: -1 | 1,
): PortraitTransform {
  const angle = direction * (transform.flipX ? -1 : 1);
  return {
    ...transform,
    rotation: ((transform.rotation + angle * 90 + 360) % 360) as PortraitTransform['rotation'],
    offsetX: -direction * transform.offsetY,
    offsetY: direction * transform.offsetX,
  };
}

export async function loadPortraitImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(tr('errors.imageRead')));
    image.src = source;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(tr('errors.imageEmpty'));
  return image;
}

export function drawPortrait(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  transform: PortraitTransform,
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error(tr('errors.portraitPrepare'));
  const size = canvas.width;
  const crop = clampPortraitTransform(
    { width: image.naturalWidth, height: image.naturalHeight },
    transform,
  );
  const scale = (size / Math.min(image.naturalWidth, image.naturalHeight)) * crop.zoom;
  context.clearRect(0, 0, size, size);
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.translate(size * (0.5 + crop.offsetX), size * (0.5 + crop.offsetY));
  context.scale(crop.flipX ? -1 : 1, 1);
  context.rotate((crop.rotation * Math.PI) / 180);
  context.scale(scale, scale);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}

export function renderPortrait(image: HTMLImageElement, transform: PortraitTransform): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  drawPortrait(canvas, image, transform);
  return canvas.toDataURL('image/webp', 0.9);
}

// Keep the whole image for future edits, limiting its size rather than cropping it.
export async function readPortrait(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(tr('validation.imageType'));
  if (file.size > 20 * 1024 * 1024) throw new Error(tr('validation.imageSize'));
  const url = URL.createObjectURL(file);
  try {
    const image = await loadPortraitImage(url);
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(tr('errors.portraitPrepare'));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let source = canvas.toDataURL('image/webp', 0.92);
    // Detailed transparent PNGs can remain large even after WebP compression.
    while (source.length > 7_000_000) {
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      source = canvas.toDataURL('image/webp', 0.92);
    }
    return source;
  } finally {
    URL.revokeObjectURL(url);
  }
}
