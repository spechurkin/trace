import { describe, expect, it } from 'vitest';
import {
  clampPortraitTransform,
  defaultPortraitTransform,
  portraitBounds,
  rotatePortraitTransform,
} from '../src/portrait';
import { databaseSchema } from '../shared/model';
import { demoDatabase } from './original-demo';
import { createCharactersTransfer, mergeTransfer } from '../shared/transfer';

describe('portrait crop boundaries', () => {
  it('rotates in the requested screen direction even when the portrait is reflected', () => {
    const initial = {
      ...defaultPortraitTransform(),
      rotation: 90 as const,
      flipX: true,
      offsetX: 0.2,
      offsetY: -0.4,
    };
    const rotated = rotatePortraitTransform(initial, 1);
    expect(rotated).toMatchObject({ rotation: 0, offsetX: 0.4, offsetY: 0.2 });
    expect(rotatePortraitTransform(rotated, -1)).toEqual(initial);
  });
  it('allows selecting the edges of a wide image without exposing empty space', () => {
    const size = { width: 1200, height: 600 };
    const transform = defaultPortraitTransform();
    expect(portraitBounds(size, transform)).toEqual({ x: 0.5, y: 0 });
    expect(clampPortraitTransform(size, { ...transform, offsetX: 10, offsetY: -10 })).toEqual({
      ...transform,
      offsetX: 0.5,
      offsetY: 0,
    });
    expect(portraitBounds(size, { ...transform, zoom: 2 })).toEqual({ x: 1.5, y: 0.5 });
  });

  it('swaps movement limits after rotation and clamps the crop after zooming out', () => {
    const size = { width: 600, height: 1200 };
    const transform = { ...defaultPortraitTransform(), rotation: 90 as const };
    expect(portraitBounds(size, transform)).toEqual({ x: 0.5, y: 0 });
    expect(portraitBounds(size, { ...transform, rotation: 270, flipX: true })).toEqual({
      x: 0.5,
      y: 0,
    });
    expect(
      clampPortraitTransform(size, { ...transform, zoom: 0.5, offsetX: -3, offsetY: 2 }),
    ).toEqual({
      ...transform,
      zoom: 1,
      offsetX: -0.5,
      offsetY: 0,
    });
    expect(clampPortraitTransform(size, { ...transform, zoom: 10 }).zoom).toBe(4);
  });
});

describe('editable portraits in local and portable libraries', () => {
  it('preserves the full source and crop across JSON transfer and repeated import', () => {
    const original = demoDatabase();
    original.characters[0].image = 'data:image/webp;base64,YWJj';
    original.characters[0].portrait = {
      source: 'data:image/webp;base64,ZGVm',
      ...defaultPortraitTransform(),
      zoom: 2,
      rotation: 90,
      flipX: true,
      offsetX: 0.25,
    };
    const file = createCharactersTransfer(original, { characterIds: [original.characters[0].id] });
    const roundTrip = JSON.parse(JSON.stringify(file));
    expect(roundTrip.data.characters[0].portrait).toEqual(original.characters[0].portrait);
    const existing = structuredClone(original);
    existing.characters[0].portrait!.source = 'data:image/webp;base64,Z2hp';
    const merged = mergeTransfer(existing, roundTrip);
    expect(merged.summary.characters).toBe(1);
    expect(merged.data.characters.at(-1)?.portrait).toEqual(original.characters[0].portrait);
    const again = mergeTransfer(merged.data, roundTrip);
    expect(again.summary.characters).toBe(0);
    expect(again.data.characters).toEqual(merged.data.characters);
    expect(databaseSchema.parse(again.data)).toEqual(again.data);
  });

  it('accepts legacy portraits and rejects unsafe sources and invalid crop settings', () => {
    const data = demoDatabase();
    data.characters[0].image = 'data:image/png;base64,YWJj';
    expect(databaseSchema.safeParse(data).success).toBe(true);
    data.characters[0].portrait = {
      source: data.characters[0].image,
      ...defaultPortraitTransform(),
    };
    expect(databaseSchema.safeParse(data).success).toBe(true);
    for (const invalid of [
      { source: 'https://example.com/portrait.png' },
      { zoom: 0 },
      { zoom: 5 },
      { rotation: 45 },
      { offsetX: Infinity },
    ]) {
      const bad = structuredClone(data);
      Object.assign(bad.characters[0].portrait!, invalid);
      expect(databaseSchema.safeParse(bad).success).toBe(false);
    }
  });
});
