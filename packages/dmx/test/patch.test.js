import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Patch, checkPatch, autoAddress, validateEntry, lastChannel } from '../patch.js';

const A = 'screenAAAA01', B = 'screenBBBB02', C = 'screenCCCC03', D = 'screenDDDD04';

test('patch : validation des entrées (identifiant, protocole, univers, adresse, personnalité)', () => {
  const ok = { protocol: 'sacn', universe: 1, address: 1, personality: 'standard8' };
  assert.deepEqual(validateEntry(A, ok), []);
  assert.equal(validateEntry('court', ok).length, 1, 'screenId de 8 à 32 caractères (schéma du protocole)');
  assert.equal(validateEntry(A, { ...ok, protocol: 'dmx' }).length, 1);
  assert.equal(validateEntry(A, { ...ok, universe: 0 }).length, 1, 'sACN : 1–63999');
  assert.deepEqual(validateEntry(A, { ...ok, protocol: 'artnet', universe: 0 }), [], 'Art-Net : Port-Address 0 valide');
  assert.equal(validateEntry(A, { ...ok, protocol: 'artnet', universe: 32768 }).length, 1);
  assert.equal(validateEntry(A, { ...ok, address: 0 }).length, 1);
  assert.equal(validateEntry(A, { ...ok, address: 513 }).length, 1);
  assert.equal(validateEntry(A, { ...ok, address: 1.5 }).length, 1);
  assert.equal(validateEntry(A, { ...ok, personality: 'rgb6' }).length, 1, 'anciennes personnalités refusées');
  const p = new Patch();
  assert.throws(() => p.set(A, { ...ok, universe: 70000 }), /univers hors plage/);
  p.set(A, { ...ok, name: 'Téléphone héroïne', loss: { mode: 'black' } });
  assert.deepEqual(p.get(A), { ...ok, name: 'Téléphone héroïne' }, 'champs inconnus non conservés');
});

test('patch : dépassement de 512, chevauchement, miroir', () => {
  const p = new Patch({
    [A]: { protocol: 'sacn', universe: 1, address: 1, personality: 'extended16' },  // 1–16
    [B]: { protocol: 'sacn', universe: 1, address: 17, personality: 'standard8' },  // 17–24 adjacent : OK
    [C]: { protocol: 'sacn', universe: 1, address: 20, personality: 'simple3' },    // 20–22 dans B
    [D]: { protocol: 'sacn', universe: 1, address: 500, personality: 'extended16', name: 'Écran 4' }, // 500–515
  });
  const r = p.check();
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'out-of-range');
  assert.deepEqual(r.errors[0].screens, [D]);
  assert.match(r.errors[0].message, /Écran 4.*500–515/);
  assert.equal(lastChannel(p.get(D)), 515);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.screens]), [['overlap', [B, C]]]);
  assert.equal(r.infos.length, 0);
});

test('patch : miroir voulu (même adresse, même personnalité) vs personnalités différentes', () => {
  const r = checkPatch({
    [A]: { protocol: 'sacn', universe: 2, address: 9, personality: 'color5' },
    [B]: { protocol: 'sacn', universe: 2, address: 9, personality: 'color5' },
    [C]: { protocol: 'sacn', universe: 2, address: 9, personality: 'simple3' },
    [D]: { protocol: 'artnet', universe: 2, address: 9, personality: 'simple3' }, // autre protocole : aucun conflit
  });
  assert.deepEqual(r.infos.map((i) => [i.code, i.screens.sort()]), [['mirror', [A, B]]]);
  assert.deepEqual(r.warnings.map((w) => w.code).sort(), ['mirror-mismatch', 'mirror-mismatch']);
  assert.equal(r.errors.length, 0);
});

test('patch : adressage automatique consécutif, écart, univers suivant', () => {
  const ids = Array.from({ length: 40 }, (_, i) => 'screen' + String(i).padStart(6, '0'));
  const r = autoAddress(ids.slice(0, 3), { startAddress: 101, personality: 'standard8', gap: 2 });
  assert.deepEqual(Object.values(r.entries).map((e) => e.address), [101, 111, 121]);
  const mixed = autoAddress([A, B, C], { personality: 'simple3', personalities: { [B]: 'extended16' } });
  assert.deepEqual(Object.values(mixed.entries).map((e) => [e.address, e.personality]), [[1, 'simple3'], [4, 'extended16'], [20, 'simple3']]);
  const wrap = autoAddress(ids, { personality: 'extended16' }); // 32 × 16 = 512 par univers
  assert.equal(wrap.entries[ids[31]].universe, 1);
  assert.equal(wrap.entries[ids[31]].address, 497);
  assert.deepEqual([wrap.entries[ids[32]].universe, wrap.entries[ids[32]].address], [2, 1]);
  assert.deepEqual(wrap.overflow, []);
  const stop = autoAddress(ids, { personality: 'extended16', nextUniverse: false });
  assert.equal(stop.overflow.length, 8);
  assert.equal(autoAddress([A], { protocol: 'artnet' }).entries[A].universe, 0, 'Art-Net : Port-Address 0 par défaut');
  assert.throws(() => autoAddress([A], { personality: 'nope' }), RangeError);
  const p = new Patch();
  p.set(A, { protocol: 'sacn', universe: 1, address: 1, personality: 'simple3', name: 'Héros' });
  p.autoAddress([A, B], { startAddress: 10, personality: 'color5' });
  assert.deepEqual(p.get(A), { protocol: 'sacn', universe: 1, address: 10, personality: 'color5', name: 'Héros' });
  assert.equal(p.check().errors.length + p.check().warnings.length, 0);
});

test('patch : sérialisation JSON et univers utilisés', () => {
  const p = new Patch([{ screenId: A, protocol: 'artnet', universe: 0x123, address: 1, personality: 'simple3' }]);
  p.set(B, { protocol: 'sacn', universe: 5, address: 1, personality: 'simple3' });
  const back = Patch.fromJSON(JSON.stringify(p));
  assert.deepEqual(back.toJSON(), p.toJSON());
  assert.equal(p.toJSON().version, 1);
  assert.deepEqual(p.universes('artnet'), [0x123]);
  assert.deepEqual(p.universes('sacn'), [5]);
  assert.equal(p.size, 2);
  p.delete(A);
  assert.deepEqual(p.ids(), [B]);
});
