import { tr } from '../shared/i18n';
import type { Database } from '../shared/model';

export function demoDatabase(): Database {
  return {
    version: 4,
    folders: [],
    characters: [
      {
        id: 'nora',
        folderId: null,
        name: tr('demo.nora.name'),
        color: '#80c7b7',
        notes: tr('demo.nora.notes'),
      },
      {
        id: 'elias',
        folderId: null,
        name: tr('demo.elias.name'),
        color: '#f4ad7b',
        notes: tr('demo.elias.notes'),
      },
      {
        id: 'mira',
        folderId: null,
        name: tr('demo.mira.name'),
        color: '#9b9be8',
        notes: tr('demo.mira.notes'),
      },
      {
        id: 'theo',
        folderId: null,
        name: tr('demo.theo.name'),
        color: '#80afdc',
        notes: tr('demo.theo.notes'),
      },
      {
        id: 'ida',
        folderId: null,
        name: tr('demo.ida.name'),
        color: '#e98091',
        notes: tr('demo.ida.notes'),
      },
      {
        id: 'august',
        folderId: null,
        name: tr('demo.august.name'),
        color: '#dbbc72',
        notes: tr('demo.august.notes'),
      },
    ],
    relationTypes: [
      { id: 'trust', name: tr('demo.relationships.trust'), color: '#58a994' },
      { id: 'family', name: tr('demo.relationships.family'), color: '#a296cd' },
      { id: 'love', name: tr('demo.relationships.love'), color: '#d97f90' },
      { id: 'fear', name: tr('demo.relationships.fear'), color: '#d3a063' },
    ],
    clubs: [
      {
        id: 'lake',
        name: tr('demo.club.name'),
        description: tr('demo.club.description'),
        characterIds: ['nora', 'elias', 'mira', 'theo', 'ida', 'august'],
        connections: [
          {
            id: 'e1',
            sourceId: 'nora',
            targetId: 'mira',
            typeId: 'family',
            directed: false,
            notes: tr('demo.connections.sisters'),
          },
          {
            id: 'e2',
            sourceId: 'nora',
            targetId: 'theo',
            typeId: 'trust',
            directed: false,
            notes: tr('demo.connections.confidant'),
          },
          {
            id: 'e3',
            sourceId: 'elias',
            targetId: 'nora',
            typeId: 'love',
            directed: true,
            notes: tr('demo.connections.unspokenLove'),
          },
          {
            id: 'e4',
            sourceId: 'mira',
            targetId: 'august',
            typeId: 'fear',
            directed: true,
            notes: tr('demo.connections.miraFear'),
          },
          {
            id: 'e5',
            sourceId: 'ida',
            targetId: 'elias',
            typeId: 'trust',
            directed: false,
            notes: tr('demo.connections.alliance'),
          },
          {
            id: 'e6',
            sourceId: 'august',
            targetId: 'nora',
            typeId: 'family',
            directed: false,
            notes: '',
          },
          {
            id: 'e7',
            sourceId: 'theo',
            targetId: 'ida',
            typeId: 'fear',
            directed: true,
            notes: tr('demo.connections.theoFear'),
          },
        ],
      },
    ],
    activeClubId: 'lake',
  };
}
