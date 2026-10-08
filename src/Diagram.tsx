import { tr } from '../shared/i18n';
import { useRef, useState } from 'react';
import { boardEdges, BRANCH_COLORS, branchOf, CULPRIT } from '../shared/investigation';
import type { Character, Club, RelationType } from '../shared/model';
import { sortByName } from './sorting';
import {
  boardBounds,
  boardPositions,
  CENTER,
  edgeGeometry,
  initials,
  type Point,
  truncate,
} from './geometry';

type Props = {
  club: Club;
  characters: Character[];
  types: RelationType[];
  selectedCharacter?: string;
  selectedEdge?: string;
  hiddenTypes?: Set<string>;
  showLabels?: boolean;
  clean?: boolean;
  onCharacter?: (id: string) => void;
  onEdge?: (id: string) => void;
  onBackground?: () => void;
  onMove?: (id: string, position: Point) => void;
};

export default function Diagram({
  club,
  characters,
  types,
  selectedCharacter,
  selectedEdge,
  hiddenTypes = new Set(),
  showLabels = false,
  clean,
  onCharacter,
  onEdge,
  onBackground,
  onMove,
}: Props) {
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    origin: Point;
    point: Point;
    inverse: DOMMatrix;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const positions = boardPositions(club);
  if (preview) positions.set(preview.id, preview.point);
  const edges = boardEdges(club, characters);
  const legend = sortByName(types.filter((t) => edges.some((e) => e.typeId === t.id)));
  const bounds = boardBounds(club, clean ? legend.length : 0);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      width={clean ? bounds.width : undefined}
      height={clean ? bounds.height : undefined}
      className="diagram"
      role={clean ? 'img' : 'group'}
      aria-label={tr('diagram.titleLabel', club.name)}
      data-testid="diagram"
    >
      <defs>
        <pattern id="paper-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="#bec5da" opacity="0.5" />
        </pattern>
        {types.map((type) => (
          <marker
            key={type.id}
            id={`arrow-${type.id}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 1 L 8 5 L 0 9"
              fill="none"
              stroke={type.color}
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        ))}
        {characters
          .filter((c) => c.image)
          .map((c) => (
            <clipPath key={c.id} id={`portrait-${c.id}`}>
              <circle r="32" />
            </clipPath>
          ))}
      </defs>
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="#f1f4fb"
        onClick={onBackground}
      />
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="url(#paper-dots)"
        pointerEvents="none"
      />
      {clean && (
        <>
          <text
            x={bounds.x + 38}
            y={bounds.y + 46}
            fontFamily="sans-serif"
            fontSize="19"
            fontWeight="700"
            fill="#22293c"
          >
            {club.name}
          </text>
          <text
            x={bounds.x + 38}
            y={bounds.y + 69}
            fontFamily="sans-serif"
            fontSize="12"
            fill="#586899"
          >
            {truncate(club.description, 95)}
          </text>
        </>
      )}
      {edges.map((edge) => {
        if (hiddenTypes.has(edge.typeId)) return null;
        const type = types.find((t) => t.id === edge.typeId);
        if (!type || !positions.has(edge.sourceId) || !positions.has(edge.targetId)) return null;
        const { path, label } = edgeGeometry(edge, edges, positions);
        const selected = selectedEdge === edge.id;
        const faded =
          !!selectedCharacter &&
          edge.sourceId !== selectedCharacter &&
          edge.targetId !== selectedCharacter;
        return (
          <g key={edge.id} opacity={faded ? 0.13 : 1} className="diagram-edge">
            <title>
              {edge.sourceId === CULPRIT
                ? tr('trace.culprit')
                : characters.find((c) => c.id === edge.sourceId)?.name}{' '}
              {edge.directed ? '→' : '—'} {characters.find((c) => c.id === edge.targetId)?.name}:{' '}
              {type.name}
              {edge.notes ? ` (${edge.notes})` : ''}
            </title>
            {selected && (
              <path d={path} fill="none" stroke={type.color} strokeWidth="9" opacity="0.15" />
            )}
            <path
              d={path}
              fill="none"
              stroke={type.color}
              strokeWidth={selected ? 2.8 : 1.8}
              opacity={selected ? 1 : 0.75}
              markerEnd={edge.directed ? `url(#arrow-${type.id})` : undefined}
            />
            {!clean && (
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                role="button"
                tabIndex={0}
                aria-label={tr(
                  'diagram.connectionLabel',
                  edge.sourceId === CULPRIT
                    ? tr('trace.culprit')
                    : characters.find((c) => c.id === edge.sourceId)?.name,
                  characters.find((c) => c.id === edge.targetId)?.name,
                  type.name,
                )}
                onClick={() => onEdge?.(edge.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdge?.(edge.id);
                  }
                }}
              />
            )}
            {showLabels && (
              <g pointerEvents="none">
                <rect
                  x={label.x - Math.min(86, type.name.length * 3.5 + 12)}
                  y={label.y - 12}
                  width={Math.min(172, type.name.length * 7 + 24)}
                  height="24"
                  rx="12"
                  fill="#f1f4fb"
                  stroke={type.color}
                  strokeOpacity="0.25"
                />
                <text
                  x={label.x}
                  y={label.y + 4}
                  textAnchor="middle"
                  fill={type.color}
                  fontFamily="sans-serif"
                  fontSize="11"
                >
                  {truncate(type.name, 20)}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {club.characterIds.map((id) => {
        const character = characters.find((c) => c.id === id);
        const position = positions.get(id);
        if (!character || !position) return null;
        const selected = selectedCharacter === id;
        const labelY = 58;
        const locked = !!club.layout?.[id]?.locked;
        return (
          <g
            key={id}
            transform={`translate(${position.x}, ${position.y})`}
            className={`diagram-node ${locked ? 'locked' : ''}`}
            data-node-id={id}
            data-locked={locked}
            style={{ cursor: clean ? undefined : locked ? 'pointer' : 'grab', touchAction: 'none' }}
            role={clean ? undefined : 'button'}
            tabIndex={clean ? undefined : 0}
            aria-label={tr('diagram.characterLabel', character.name)}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onCharacter?.(id);
            }}
            onPointerDown={(e) => {
              if (clean || e.button !== 0) return;
              e.stopPropagation();
              if (locked || !onMove) return;
              const matrix = e.currentTarget.ownerSVGElement?.getScreenCTM();
              if (!matrix) return;
              const inverse = matrix.inverse();
              const origin = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
              drag.current = {
                id,
                pointer: e.pointerId,
                origin,
                point: position,
                inverse,
                moved: false,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== id || d.pointer !== e.pointerId) return;
              const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(d.inverse);
              const dx = point.x - d.origin.x,
                dy = point.y - d.origin.y;
              if (Math.hypot(dx, dy) > 3) d.moved = true;
              if (d.moved)
                setPreview({
                  id,
                  point: {
                    x: Math.max(-10000, Math.min(10000, d.point.x + dx)),
                    y: Math.max(-10000, Math.min(10000, d.point.y + dy)),
                  },
                });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              if (!d || d.id !== id) return;
              if (d.moved) {
                const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(d.inverse);
                onMove?.(id, {
                  x: Math.max(-10000, Math.min(10000, d.point.x + point.x - d.origin.x)),
                  y: Math.max(-10000, Math.min(10000, d.point.y + point.y - d.origin.y)),
                });
                suppressClick.current = true;
              }
              drag.current = null;
              setPreview(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCharacter?.(id);
              }
            }}
          >
            <title>
              {character.name}
              {character.notes ? ` — ${character.notes}` : ''}
            </title>
            <circle
              r={selected ? 42 : 38}
              fill="#f1f4fb"
              stroke={selected ? '#4169E1' : BRANCH_COLORS[branchOf(character)]}
              strokeWidth={selected ? 1.8 : 1}
            />
            {character.image ? (
              <image
                href={character.image}
                x="-32"
                y="-32"
                width="64"
                height="64"
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#portrait-${id})`}
              />
            ) : (
              <>
                <circle r="32" fill={BRANCH_COLORS[branchOf(character)]} fillOpacity="0.13" />
                <text
                  y="7"
                  textAnchor="middle"
                  fill="#181e2f"
                  fontFamily="sans-serif"
                  fontWeight="600"
                  fontSize="20"
                >
                  {initials(character.name)}
                </text>
              </>
            )}
            <text
              y={labelY}
              textAnchor="middle"
              fill="#2d364f"
              fontFamily="sans-serif"
              fontWeight="600"
              fontSize="12.5"
            >
              {truncate(character.name, club.characterIds.length > 12 ? 14 : 24)}
            </text>
            {locked && (
              <g transform="translate(25,-30)" pointerEvents="none">
                <circle r="10" fill="#4169E1" />
                <path
                  d="M -4 0 V -3 A 4 4 0 0 1 4 -3 V 0 M -5 0 H 5 V 7 H -5 Z"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </g>
        );
      })}
      <g
        transform={`translate(${CENTER.x}, ${CENTER.y})`}
        className="diagram-node culprit-node"
        data-node-id={CULPRIT}
        role={clean ? undefined : 'button'}
        tabIndex={clean ? undefined : 0}
        aria-label={tr('trace.culprit')}
        onClick={() => onCharacter?.(CULPRIT)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onCharacter?.(CULPRIT);
          }
        }}
      >
        <circle r="57" fill="#EDF2FF" stroke="#4169E1" strokeWidth="1.5" strokeDasharray="3 5" />
        <circle r="46" fill="#173EA5" />
        <path
          d="M -10 -7 A 15 15 0 1 1 10 -7 M -27 28 C -27 2 27 2 27 28"
          fill="none"
          stroke="#B9CBFF"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <text
          y="0"
          textAnchor="middle"
          fill="white"
          fontFamily="sans-serif"
          fontSize="28"
          fontWeight="600"
        >
          ?
        </text>
        <text
          y="79"
          textAnchor="middle"
          fill="#173EA5"
          fontFamily="sans-serif"
          fontSize="14"
          fontWeight="700"
        >
          {tr('trace.culprit')}
        </text>
      </g>
      {clean && (
        <g
          transform={`translate(${bounds.x + 38},${bounds.y + bounds.height - bounds.legendHeight - 44})`}
        >
          {legend.map((type, index) => (
            <g
              key={type.id}
              transform={`translate(${(index % 4) * 215}, ${Math.floor(index / 4) * 20})`}
            >
              <circle r="3.5" fill={type.color} />
              <text x="11" y="4" fontFamily="sans-serif" fontSize="11" fill="#586899">
                {truncate(type.name, 24)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
