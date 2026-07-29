import { buildMap, type MapInput } from '@/db/mapView';
import type { BinRow, LocationRow, ShelfRow } from '@/db/queries';

import { heldHint, heldLabel, sendHint } from '../mapPresentation';

const loc = (id: string, name: string): LocationRow => ({ id, name, created_at: '', sort_order: 0 });
const shelf = (id: string, locationId: string, name: string): ShelfRow => ({
  id,
  location_id: locationId,
  name,
  created_at: '',
  capacity: 4,
  sort_order: 0,
});
const bin = (id: string, shelfId: string, code: string, name: string): BinRow =>
  ({
    id,
    shelf_id: shelfId,
    short_code: code,
    name,
    cover_photo_uri: null,
    last_scanned_at: null,
    created_at: '',
    sort_order: 0,
  }) as BinRow;

const input = (over: Partial<MapInput> = {}): MapInput => ({
  locations: [],
  shelves: [],
  bins: [],
  itemCounts: new Map(),
  ...over,
});

describe('what the banner says about the bin in your hand', () => {
  const areas = buildMap(
    input({
      locations: [loc('l1', 'R1 · Garage')],
      shelves: [shelf('s1', 'l1', 'Top')],
      bins: [bin('b1', 's1', 'B-014', 'Grout & spacers')],
    }),
  );

  it('names one bin', () => {
    expect(heldLabel(areas, 'b1')).toBe('Moving B-014 · Grout & spacers');
  });

  it('counts a stack rather than naming the first of it', () => {
    // Naming one and silently carrying four is how a group move surprises
    // someone into re-filing three bins they did not mean to touch.
    expect(heldLabel(areas, 'b1', 4)).toBe('Moving 4 bins together');
  });

  it('says nothing when nothing is held', () => {
    expect(heldLabel(areas, null)).toBe('');
  });

  it('offers the side rails only when there is somewhere to send it', () => {
    expect(heldHint(1, true)).toContain('side rail');
    expect(heldHint(1, false)).not.toContain('side rail');
  });

  it('drops the slide-in-front wording once a stack is in hand', () => {
    expect(heldHint(3, true)).toBe('Tap a slot and they all land there, in this order.');
  });
});

describe('what releasing on a side rail would do', () => {
  it('names the rack when only one lies that way', () => {
    expect(sendHint({ code: 'R2', label: 'Main run', pool: 1, full: false })).toBe(
      'Release to send it to R2 · Main run · hold to page there',
    );
  });

  it('warns before the drop when that rack is already packed', () => {
    // A rail that hands you a dead end is worse than no rail.
    expect(sendHint({ code: 'R2', label: 'Main run', pool: 1, full: true })).toContain('is full');
  });

  it('says it will ask when the direction alone cannot pick', () => {
    expect(sendHint({ code: 'R2', label: 'Main run', pool: 3, full: false })).toContain(
      'Release to choose a rack',
    );
  });

  it('says nothing when the wall ends that way', () => {
    expect(sendHint({ code: '', label: '', pool: 0, full: false })).toBe('');
  });
});
