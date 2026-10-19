// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Licence Tel + Séquence (docs/LICENCE-API.md) : faux service de licence côté
// Node, branché sur les requêtes de la page (Playwright route), qui applique le
// contrat (signature de la requête, id dérivé de la clé, horloge, nonce) et
// signe ses jetons ; clés FIXES pour des rendus reproductibles (captures).
import { webcrypto as wc, createHash } from 'node:crypto';

export const API = 'https://lic.test';
export const BUY_URL = 'https://hub.itsi-app.com/licence';
const EC = { name: 'ECDSA', namedCurve: 'P-256' };
// Clé du service (signature des jetons) et clé « d'appareil » imposée aux
// pages des captures (identifiant stable) : générées une fois, figées ici
export const SERVER_JWK = { kty: 'EC', crv: 'P-256', d: 'H0MoAPOsFMs2WGEw7c6Rj4m88H9q8AVX0tYHYx7VGv0', x: '2VC_C_ZLGX63-DI0YxnF_wOrazdEGLFZtW4R5toMmho', y: 'mqQwgsRqnTghmbr1AY1c72htQbCIr-CYfwv-N1MFQqg' };
export const DEVICE_JWK = { kty: 'EC', crv: 'P-256', d: 'WxyjuQEuWm5Z_Th1EGnMSKoJ05E_PSXh0JIINqJVxQs', x: 'FY4-MOht_H5i9gG4GmwIjxKV7eOg8FVYR-VeLUhB4uY', y: 'mHkZkgbVBYeV7g4oZmp6WjcUfdL7S4VzI4VNFNuczS0' };

export const b64u = (b) => Buffer.from(b).toString('base64url');
const pubJwk = (j) => ({ kty: j.kty, crv: j.crv, x: j.x, y: j.y });
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// id = base32 de Crockford des 40 premiers bits de SHA-256(SPKI DER)
export function deriveId(spki) {
  const h = createHash('sha256').update(Buffer.from(spki)).digest();
  let v = 0n;
  for (let i = 0; i < 5; i++) v = (v << 8n) | BigInt(h[i]);
  let s = '';
  for (let i = 7; i >= 0; i--) s += ALPHA[Number((v >> BigInt(i * 5)) & 31n)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
async function spkiOf(jwk) {
  return new Uint8Array(await wc.subtle.exportKey('spki', await wc.subtle.importKey('jwk', pubJwk(jwk), EC, true, ['verify'])));
}
export const SERVER_PUB = b64u(await spkiOf(SERVER_JWK));
export const DEVICE_ID = deriveId(await spkiOf(DEVICE_JWK));
const serverKey = await wc.subtle.importKey('jwk', SERVER_JWK, EC, false, ['sign']);

// Jeton signé : <charge utile b64url>.<signature P1363 b64url>
export async function signToken(payload, key = serverKey) {
  const p = b64u(JSON.stringify(payload));
  const sig = await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(p));
  return p + '.' + b64u(sig);
}
export function payloadFor(id, lic, now = Date.now()) {
  if (!lic) return { v: 1, id, features: [], iat: now, exp: now + 14 * 86400e3 };
  return { v: 1, id, features: lic.features, holder: lic.holder, end: lic.end, devices: lic.devices, iat: now, exp: Math.min(lic.end, now + 14 * 86400e3) };
}

// Configuration de la page (comme window.SETREMOTE_CONFIG d'une coque) ;
// fixedDevice : clé d'appareil imposée (identifiant stable des captures)
export function licenceInit({ buy = BUY_URL, fixedDevice = false, native = false, token = null, api = API } = {}) {
  return {
    fn: (a) => {
      window.SETREMOTE_CONFIG = Object.assign({}, window.SETREMOTE_CONFIG, { LICENSING: 'on', LICENCE_PUBKEY: a.pub, LICENCE_API: a.api }, a.buy ? { LICENCE_BUY_URL: a.buy } : {});
      if (a.native) { window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1 }; window.ReactNativeWebView = { postMessage: () => {} }; }
      if (a.token) { try { localStorage.setItem('setremote-licence-v1', JSON.stringify(a.token)); } catch (_) {} }
      if (a.dev) {
        const gen = crypto.subtle.generateKey.bind(crypto.subtle);
        crypto.subtle.generateKey = async (alg, ext, uses) => {
          if (!alg || alg.name !== 'ECDSA') return gen(alg, ext, uses);
          const pub = { kty: a.dev.kty, crv: a.dev.crv, x: a.dev.x, y: a.dev.y };
          return {
            privateKey: await crypto.subtle.importKey('jwk', a.dev, alg, ext, ['sign']),
            publicKey: await crypto.subtle.importKey('jwk', pub, alg, true, ['verify']),
          };
        };
      }
    },
    arg: { pub: SERVER_PUB, api, buy, native, token, dev: fixedDevice ? DEVICE_JWK : null },
  };
}

// Faux service : licences par id, journal des requêtes, panne simulée
export class FakeLicenceServer {
  constructor() {
    this.licences = new Map(); // id → { features, holder, end, devices }
    this.checks = []; this.stats = []; this.errors = [];
    this.down = false; this.badSig = false;
    this.nonces = new Set();
  }
  async attach(target) {
    await target.route(API + '/**', (route) => this.handle(route));
  }
  async handle(route) {
    const req = route.request();
    if (this.down) return route.abort('internetdisconnected');
    const path = new URL(req.url()).pathname;
    let body = null;
    try { body = JSON.parse(req.postData() || ''); } catch (_) { body = null; }
    const json = (status, o) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (req.method() !== 'POST') return json(405, { error: 'method' });
    if (path === '/api/v1/stats') {
      this.stats.push(body);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (path !== '/api/v1/licence/check') return json(404, { error: 'not_found' });
    this.checks.push(body);
    const err = await this.verify(body);
    if (err) { this.errors.push(err); return json(err === 'bad_request' ? 400 : 401, { error: err }); }
    const payload = payloadFor(body.id, this.licences.get(body.id));
    const token = this.badSig ? await signToken(payload, (await wc.subtle.generateKey(EC, false, ['sign'])).privateKey) : await signToken(payload);
    return json(200, { token });
  }
  async verify(b) {
    if (!b || b.v !== 1 || typeof b.id !== 'string' || typeof b.pub !== 'string' || typeof b.ts !== 'number' || typeof b.nonce !== 'string' || typeof b.sig !== 'string' || !b.app) return 'bad_request';
    const spki = Buffer.from(b.pub, 'base64url');
    if (deriveId(spki) !== b.id) return 'bad_id';
    if (Math.abs(Date.now() - b.ts) > 10 * 60e3) return 'clock';
    if (this.nonces.has(b.nonce)) return 'replay';
    this.nonces.add(b.nonce);
    const key = await wc.subtle.importKey('spki', spki, EC, false, ['verify']);
    const ok = await wc.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(b.sig, 'base64url'),
      new TextEncoder().encode(`srlic1|${b.id}|${b.ts}|${b.nonce}`));
    return ok ? null : 'bad_signature';
  }
}
