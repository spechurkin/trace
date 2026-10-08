import { tr } from '../shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import Diagram from './Diagram';
import { storage } from './storage';
import type { Club, Database, ExportFormat } from '../shared/model';
import { boardBounds } from './geometry';
import { investigationTypes } from '../shared/investigation';

export async function exportDiagram(
  data: Database,
  club: Club,
  format: ExportFormat,
  labels: boolean,
) {
  let svg = renderToStaticMarkup(
    <Diagram
      club={club}
      characters={data.characters}
      types={investigationTypes()}
      clean
      showLabels={labels}
    />,
  );
  // React may prepend image preload links; the exported document starts at svg.
  svg = svg.slice(svg.indexOf('<svg'));
  if (format === 'svg') return storage.exportDiagram(club.name, format, svg);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(tr('errors.imagePrepare')));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const bounds = boardBounds(club, 5);
    canvas.width = 1840;
    canvas.height = Math.round((1840 * bounds.height) / bounds.width);
    const context = canvas.getContext('2d');
    if (!context) throw new Error(tr('errors.imageExportUnavailable'));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return storage.exportDiagram(club.name, format, canvas.toDataURL('image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
