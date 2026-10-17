// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesToB64u, b64uToBytes, utf8Encode, utf8Decode, utf8EncodeJs, utf8DecodeJs, timingSafeEqual,
} from '../lib/encoding.js';

test('base64url : identique à Buffer pour toutes les longueurs', () => {
  for (let n = 0; n < 70; n++) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    const s = bytesToB64u(b);
    assert.equal(s, Buffer.from(b).toString('base64url'));
    assert.deepEqual(b64uToBytes(s), b);
  }
  const big = crypto.getRandomValues(new Uint8Array(65536));
  assert.equal(bytesToB64u(big), Buffer.from(big).toString('base64url'));
});

test('base64url strict : alphabet, longueur, forme canonique', () => {
  for (const bad of ['A', 'AB=', 'AB+C', 'AB/C', 'ÀBCD', 'AB C', 'AB']) {
    if (bad === 'AB') continue; // 'AB' : 'B' a des bits de bourrage non nuls → testé ci-dessous
    assert.throws(() => b64uToBytes(bad), /malformed/);
  }
  assert.throws(() => b64uToBytes('AB'), /canonique/);
  assert.deepEqual(b64uToBytes('AA'), Uint8Array.of(0));
  assert.throws(() => b64uToBytes('AAB'), /canonique/);
  assert.throws(() => b64uToBytes(/** @type {any} */ (null)), /malformed/);
});

const CORPUS = [
  '', 'abc', 'Été — « guillemets »', '日本語', '🎬🎥👍🏽', 'a\u0000b', '﻿bom',
  'surrogate isolé \uD800 fin', 'bas isolé \uDC00', 'x'.repeat(20000) + '🎬',
];

test('UTF-8 : repli JS identique aux implémentations natives', () => {
  const te = new TextEncoder();
  for (const s of CORPUS) {
    assert.deepEqual(utf8EncodeJs(s), te.encode(s), JSON.stringify(s.slice(0, 20)));
    assert.deepEqual(utf8Encode(s), te.encode(s));
    const valid = te.encode(s);
    assert.equal(utf8DecodeJs(valid), new TextDecoder('utf-8', { ignoreBOM: true }).decode(valid));
    assert.equal(utf8Decode(valid), utf8DecodeJs(valid));
  }
});

test('UTF-8 strict : séquences invalides rejetées par les deux décodeurs', () => {
  const invalid = [
    [0x80], [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x8e], [0xff], [0x61, 0xc3],
  ];
  for (const seq of invalid) {
    const b = Uint8Array.from(seq);
    assert.throws(() => utf8DecodeJs(b), /malformed/, seq.join(','));
    assert.throws(() => utf8Decode(b), /malformed/, seq.join(','));
  }
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2)), true);
  assert.equal(timingSafeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3)), false);
  assert.equal(timingSafeEqual(Uint8Array.of(1), Uint8Array.of(1, 2)), false);
});
