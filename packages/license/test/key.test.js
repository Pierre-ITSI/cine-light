// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_ALPHABET, KEY_ENTROPY_BITS, checkCharacter, normalizeLicenseKey, parseLicenseKey,
  isValidLicenseKey, formatLicenseKey, formatKeyInput, generateLicenseKey,
} from '../key.js';

const FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
// Clé fixe : 11 caractères choisis + contrôle calculé
const DATA = '7K3M9QXR2D4';
const KEY = DATA + checkCharacter(DATA);
const DASHED = KEY.slice(0, 4) + '-' + KEY.slice(4, 8) + '-' + KEY.slice(8);

test('alphabet : Base32 de Crockford sans I, L, O, U ; 55 bits d\'entropie', () => {
  assert.equal(KEY_ALPHABET.length, 32);
  assert.equal(new Set(KEY_ALPHABET).size, 32);
  assert.doesNotMatch(KEY_ALPHABET, /[ILOU]/);
  assert.ok(KEY_ENTROPY_BITS >= 50);
  assert.equal(KEY_ENTROPY_BITS, 55);
});

test('generateLicenseKey : format XXXX-XXXX-XXXX, valide, aléatoire', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const k = generateLicenseKey();
    assert.match(k, FORMAT);
    assert.ok(isValidLicenseKey(k), k);
    seen.add(k);
  }
  assert.equal(seen.size, 2000);
});

test('generateLicenseKey : tirage uniforme (octet & 31) depuis le générateur fourni', () => {
  const k = generateLicenseKey({ getRandomValues: (a) => a.fill(255) });
  assert.equal(k.replace(/-/g, '').slice(0, 11), 'ZZZZZZZZZZZ');
  assert.ok(isValidLicenseKey(k));
  // Distribution : chaque symbole apparaît (2000 × 11 tirages)
  const counts = new Map();
  for (let i = 0; i < 2000; i++) for (const c of generateLicenseKey().replace(/-/g, '').slice(0, 11)) counts.set(c, (counts.get(c) || 0) + 1);
  assert.equal(counts.size, 32);
  for (const n of counts.values()) assert.ok(n > 450 && n < 950, String(n)); // attendu ≈ 687
});

test('normalisation : casse, espaces, tirets, O→0, I/L→1', () => {
  assert.equal(normalizeLicenseKey(DASHED), KEY);
  assert.equal(normalizeLicenseKey(' ' + DASHED.toLowerCase() + ' '), KEY);
  assert.equal(normalizeLicenseKey(KEY.slice(0, 6) + ' ' + KEY.slice(6)), KEY);
  assert.equal(normalizeLicenseKey('ABCD–EFGH—JKMN'), 'ABCDEFGHJKMN');
  assert.equal(normalizeLicenseKey('oooo-iiii-llll'), '000011111111');
  assert.equal(normalizeLicenseKey('ＡＢＣＤ-ＥＦＧＨ-ＪＫＭＮ'), 'ABCDEFGHJKMN'); // pleine largeur (NFKC)
  assert.equal(normalizeLicenseKey('ABCD-EFGH-JKMU'), null); // U : aucun équivalent
  assert.equal(normalizeLicenseKey('ABCD-EFGH-JKM'), null);
  assert.equal(normalizeLicenseKey('ABCD-EFGH-JKMNP'), null);
  assert.equal(normalizeLicenseKey('ABCD-EFGH-JKM!'), null);
  assert.equal(normalizeLicenseKey(42), null);
  assert.equal(normalizeLicenseKey('A'.repeat(65)), null);
});

test('parseLicenseKey : motifs de refus, forme canonique et affichée', () => {
  assert.deepEqual(parseLicenseKey(DASHED.toLowerCase()), { ok: true, key: KEY, formatted: DASHED });
  assert.deepEqual(parseLicenseKey(null), { ok: false, reason: 'type' });
  assert.deepEqual(parseLicenseKey('ABC'), { ok: false, reason: 'length' });
  assert.deepEqual(parseLicenseKey('ABCD-EFGH-JKMU'), { ok: false, reason: 'char' });
  const wrong = KEY.slice(0, 11) + KEY_ALPHABET[(KEY_ALPHABET.indexOf(KEY[11]) + 1) % 32];
  assert.deepEqual(parseLicenseKey(wrong), { ok: false, reason: 'checksum' });
  assert.equal(formatLicenseKey(KEY.toLowerCase()), DASHED);
  assert.equal(formatLicenseKey(wrong), null);
});

test('contrôle : TOUTES les substitutions d\'un caractère sont détectées', () => {
  for (let n = 0; n < 50; n++) {
    const key = generateLicenseKey().replace(/-/g, '');
    for (let i = 0; i < 12; i++) {
      for (const c of KEY_ALPHABET) {
        if (c === key[i]) continue;
        const typo = key.slice(0, i) + c + key.slice(i + 1);
        assert.equal(isValidLicenseKey(typo), false, `${key} → ${typo}`);
      }
    }
  }
});

test('contrôle : TOUTES les permutations de deux caractères différents sont détectées', () => {
  for (let n = 0; n < 200; n++) {
    const key = generateLicenseKey().replace(/-/g, '');
    for (let i = 0; i < 12; i++) {
      for (let j = i + 1; j < 12; j++) {
        if (key[i] === key[j]) continue;
        const a = [...key];
        [a[i], a[j]] = [a[j], a[i]];
        assert.equal(isValidLicenseKey(a.join('')), false, `${key} ⇄ ${i},${j}`);
      }
    }
  }
});

test('contrôle : une erreur aléatoire passe avec une probabilité ≈ 1/32', () => {
  let passed = 0;
  const N = 20000;
  for (let n = 0; n < N; n++) {
    const key = generateLicenseKey().replace(/-/g, '');
    // deux substitutions aléatoires
    const a = [...key];
    const i = n % 12, j = (n * 7 + 3) % 12;
    a[i] = KEY_ALPHABET[(KEY_ALPHABET.indexOf(a[i]) + 1 + (n % 31)) % 32];
    if (j !== i) a[j] = KEY_ALPHABET[(KEY_ALPHABET.indexOf(a[j]) + 1 + ((n >> 3) % 31)) % 32];
    if (isValidLicenseKey(a.join(''))) passed++;
  }
  assert.ok(passed / N < 0.05, String(passed / N));
});

test('formatKeyInput : mise en forme pendant la saisie', () => {
  assert.equal(formatKeyInput(''), '');
  assert.equal(formatKeyInput('ab'), 'AB');
  assert.equal(formatKeyInput('abcde'), 'ABCD-E');
  assert.equal(formatKeyInput('abcd-efgh-jkmn-pqrs'), 'ABCD-EFGH-JKMN');
  assert.equal(formatKeyInput('o i l u !'), '011');
  assert.equal(formatKeyInput(undefined), '');
});

test('checkCharacter : entrées invalides refusées', () => {
  assert.throws(() => checkCharacter('ABC'), TypeError);
  assert.throws(() => checkCharacter('ABCDEFGHJKU'), TypeError);
});
