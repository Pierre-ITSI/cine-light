// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Clés de licence SetRemote : 12 caractères en 3 groupes de 4, « XXXX-XXXX-XXXX ».
 *
 *   Alphabet   Base32 de Crockford : 0-9 et A-Z sans I, L, O, U (32 symboles,
 *              5 bits chacun). Saisie tolérante : casse, espaces, tirets,
 *              O → 0, I et L → 1 (normalizeLicenseKey).
 *   Données    11 caractères tirés par un générateur cryptographique
 *              (crypto.getRandomValues) : 11 × 5 = 55 bits d'entropie.
 *   Contrôle   12e caractère : somme pondérée dans le corps fini GF(32)
 *              (polynôme primitif x⁵ + x² + 1, poids αⁱ distincts). Détecte
 *              hors ligne 100 % des substitutions d'un caractère et 100 % des
 *              permutations de deux caractères (adjacents ou non) ; une erreur
 *              quelconque passe avec une probabilité de 1/32.
 *
 * Preuve courte : la clé est valide si Σ wᵢ·dᵢ = 0 (addition = XOR), avec
 * w = 1 pour le caractère de contrôle et wᵢ = α^(i+1) pour les données, tous
 * distincts et non nuls (α est d'ordre 31 > 12). Une substitution e ≠ 0 en i
 * change la somme de wᵢ·e ≠ 0 ; une permutation de a ≠ b entre i et j la
 * change de (wᵢ + wⱼ)(a + b) ≠ 0, produit de deux non-nuls dans un corps.
 *
 * Aucune dépendance ; WebCrypto (globalThis.crypto) pour le tirage seulement.
 */

export const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_LENGTH = 12;
export const KEY_DATA_LENGTH = 11;
export const KEY_GROUP_LENGTH = 4;
export const KEY_ENTROPY_BITS = KEY_DATA_LENGTH * 5; // 55
const MAX_INPUT = 64; // au-delà, on ne regarde même pas (saisie, collage)

const VALUE = new Map([...KEY_ALPHABET].map((c, i) => [c, i]));
// Confusions courantes (Crockford) ; U n'a pas d'équivalent : refusé
const ALIASES = { O: '0', I: '1', L: '1' };

// Multiplication dans GF(2⁵) modulo x⁵ + x² + 1 (0b100101)
function gfMul(a, b) {
  let p = 0;
  for (let i = 0; i < 5; i++) {
    if (b & 1) p ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 0b100000) a ^= 0b100101;
  }
  return p;
}

// Poids des 11 caractères de données : α^1 … α^11 (α = x = 2)
const WEIGHTS = (() => {
  const w = [];
  let a = 1;
  for (let i = 0; i < KEY_DATA_LENGTH; i++) { a = gfMul(a, 2); w.push(a); }
  return Object.freeze(w);
})();

/**
 * Caractère de contrôle des 11 caractères de données (alphabet canonique).
 * @param {string} data 11 caractères de KEY_ALPHABET
 * @returns {string}
 */
export function checkCharacter(data) {
  if (typeof data !== 'string' || data.length !== KEY_DATA_LENGTH) throw new TypeError('checkCharacter : 11 caractères attendus');
  let sum = 0;
  for (let i = 0; i < KEY_DATA_LENGTH; i++) {
    const v = VALUE.get(data[i]);
    if (v === undefined) throw new TypeError('checkCharacter : caractère hors alphabet');
    sum ^= gfMul(WEIGHTS[i], v);
  }
  return KEY_ALPHABET[sum];
}

/**
 * Forme canonique (12 caractères, majuscules, sans séparateur) ou null si la
 * saisie ne peut pas être une clé (longueur, caractère interdit). Ne vérifie
 * PAS le caractère de contrôle : voir parseLicenseKey.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeLicenseKey(input) {
  const r = clean(input);
  return r.ok ? r.key : null;
}

function clean(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'type' };
  if (input.length > MAX_INPUT) return { ok: false, reason: 'length' };
  // NFKC : chiffres pleine largeur, ligatures… ; puis séparateurs usuels
  let s = input.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—_.·]/g, '');
  s = s.replace(/[OIL]/g, (c) => ALIASES[c]);
  if (s.length !== KEY_LENGTH) return { ok: false, reason: 'length' };
  for (const c of s) if (!VALUE.has(c)) return { ok: false, reason: 'char' };
  return { ok: true, key: s };
}

/**
 * Analyse complète d'une saisie.
 * @param {unknown} input
 * @returns {{ ok: true, key: string, formatted: string } | { ok: false, reason: 'type' | 'length' | 'char' | 'checksum' }}
 */
export function parseLicenseKey(input) {
  const r = clean(input);
  if (!r.ok) return r;
  if (checkCharacter(r.key.slice(0, KEY_DATA_LENGTH)) !== r.key[KEY_DATA_LENGTH]) return { ok: false, reason: 'checksum' };
  return { ok: true, key: r.key, formatted: group(r.key) };
}

/** @param {unknown} input @returns {boolean} */
export function isValidLicenseKey(input) {
  return parseLicenseKey(input).ok;
}

/**
 * « XXXX-XXXX-XXXX » d'une clé valide (saisie tolérante), sinon null.
 * @param {unknown} input
 * @returns {string | null}
 */
export function formatLicenseKey(input) {
  const r = parseLicenseKey(input);
  return r.ok ? r.formatted : null;
}

/**
 * Mise en forme PENDANT la saisie : caractères reconnus seulement (alias
 * appliqués), 12 au plus, tiret tous les 4. Ne valide rien.
 * @param {unknown} input
 * @returns {string}
 */
export function formatKeyInput(input) {
  if (typeof input !== 'string') return '';
  const chars = [];
  for (const c of input.slice(0, MAX_INPUT * 2).normalize('NFKC').toUpperCase()) {
    const k = ALIASES[c] || c;
    if (VALUE.has(k)) chars.push(k);
    if (chars.length === KEY_LENGTH) break;
  }
  return group(chars.join(''));
}

function group(s) {
  const parts = [];
  for (let i = 0; i < s.length; i += KEY_GROUP_LENGTH) parts.push(s.slice(i, i + KEY_GROUP_LENGTH));
  return parts.join('-');
}

/**
 * Nouvelle clé aléatoire (service de licence ; tests). 256 étant un multiple
 * de 32, « octet & 31 » est uniforme : aucun biais.
 * @param {{ getRandomValues?: (a: Uint8Array) => Uint8Array }} [opts]
 * @returns {string} « XXXX-XXXX-XXXX »
 */
export function generateLicenseKey(opts = {}) {
  const rng = opts.getRandomValues || ((a) => globalThis.crypto.getRandomValues(a));
  const bytes = rng(new Uint8Array(KEY_DATA_LENGTH));
  let data = '';
  for (let i = 0; i < KEY_DATA_LENGTH; i++) data += KEY_ALPHABET[bytes[i] & 31];
  return group(data + checkCharacter(data));
}
