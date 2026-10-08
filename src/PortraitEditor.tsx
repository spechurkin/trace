import { tr } from '../shared/i18n';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { FlipHorizontal2, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import type { Portrait } from '../shared/model';
import {
  clampPortraitTransform,
  defaultPortraitTransform,
  drawPortrait,
  loadPortraitImage,
  type PortraitTransform,
  renderPortrait,
  rotatePortraitTransform,
} from './portrait';

export function PortraitEditor({
  portrait,
  onApply,
  onCancel,
}: {
  portrait: Portrait;
  onApply: (image: string, portrait: Portrait) => void;
  onCancel: () => void;
}) {
  const [transform, setTransform] = useState<PortraitTransform>(portrait);
  const [image, setImage] = useState<HTMLImageElement>();
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; transform: PortraitTransform } | null>(
    null,
  );
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    let active = true;
    void loadPortraitImage(portrait.source)
      .then((image) => {
        if (active) {
          setImage(image);
          setTransform((value) =>
            clampPortraitTransform(
              { width: image.naturalWidth, height: image.naturalHeight },
              value,
            ),
          );
        }
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : tr('errors.image'));
      });
    canvas.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel.current();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      active = false;
      document.removeEventListener('keydown', key, true);
    };
  }, [portrait.source]);

  useEffect(() => {
    if (image && canvas.current) drawPortrait(canvas.current, image, transform);
  }, [image, transform]);

  const update = (next: PortraitTransform) => {
    if (image)
      setTransform(
        clampPortraitTransform({ width: image.naturalWidth, height: image.naturalHeight }, next),
      );
  };
  const rotate = (direction: -1 | 1) => update(rotatePortraitTransform(transform, direction));
  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section className="portrait-crop-editor" aria-label={tr('portrait.editor')}>
      <h3>{tr('portrait.editor')}</h3>
      <p id="portrait-crop-hint" className="muted">
        {tr('portrait.cropHint')}
      </p>
      <div className={`portrait-crop-viewport ${dragging ? 'dragging' : ''}`}>
        <canvas
          ref={canvas}
          width={512}
          height={512}
          tabIndex={0}
          role="img"
          aria-label={tr('portrait.cropLabel')}
          aria-describedby="portrait-crop-hint portrait-keyboard-hint"
          onPointerDown={(event) => {
            if (!image || event.button !== 0 || drag.current) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, transform };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            const side = event.currentTarget.getBoundingClientRect().width;
            update({
              ...start.transform,
              offsetX: start.transform.offsetX + (event.clientX - start.x) / side,
              offsetY: start.transform.offsetY + (event.clientY - start.y) / side,
            });
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={(event) => {
            const steps: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const step = steps[event.key];
            if (!step) return;
            event.preventDefault();
            const distance = event.shiftKey ? 0.05 : 0.01;
            update({
              ...transform,
              offsetX: transform.offsetX + step[0] * distance,
              offsetY: transform.offsetY + step[1] * distance,
            });
          }}
        />
        <div className="portrait-crop-mask" aria-hidden="true" />
        {!image && !error && (
          <span className="portrait-crop-loading">{tr('portrait.loading')}</span>
        )}
      </div>
      <label className="portrait-zoom">
        <span>
          {tr('portrait.zoomLabel')}
          <output>{Math.round(transform.zoom * 100)}%</output>
        </span>
        <input
          type="range"
          aria-label={tr('portrait.zoomControlLabel')}
          min="1"
          max="4"
          step="0.01"
          value={transform.zoom}
          disabled={!image}
          onChange={(event) => {
            const zoom = Number(event.target.value);
            const ratio = zoom / transform.zoom;
            update({
              ...transform,
              zoom,
              offsetX: transform.offsetX * ratio,
              offsetY: transform.offsetY * ratio,
            });
          }}
        />
      </label>
      <div className="portrait-crop-tools">
        <button
          type="button"
          className="button secondary"
          aria-label={tr('portrait.rotateLeft')}
          title={tr('portrait.rotateLeft')}
          disabled={!image}
          onClick={() => rotate(-1)}
        >
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          className="button secondary"
          aria-label={tr('portrait.rotateRight')}
          title={tr('portrait.rotateRight')}
          disabled={!image}
          onClick={() => rotate(1)}
        >
          <RotateCw size={17} />
        </button>
        <button
          type="button"
          className="button secondary"
          aria-label={tr('portrait.flip')}
          title={tr('portrait.flip')}
          aria-pressed={transform.flipX}
          disabled={!image}
          onClick={() =>
            update({ ...transform, flipX: !transform.flipX, offsetX: -transform.offsetX })
          }
        >
          <FlipHorizontal2 size={17} />
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!image}
          onClick={() => update(defaultPortraitTransform())}
        >
          <Undo2 size={15} />
          {tr('portrait.reset')}
        </button>
      </div>
      <p id="portrait-keyboard-hint" className="field-hint">
        {tr('portrait.keyboardHint')}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onCancel}>
          {tr('actions.cancel')}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!image || !!error}
          onClick={() => {
            if (!image) return;
            try {
              onApply(renderPortrait(image, transform), { ...transform, source: portrait.source });
            } catch (error) {
              setError(error instanceof Error ? error.message : tr('errors.image'));
            }
          }}
        >
          {tr('portrait.apply')}
        </button>
      </div>
    </section>
  );
}
