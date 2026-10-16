/**
 * @setremote/protocol — appairage, chiffrement de bout en bout et schéma
 * des messages SetRemote. Zéro dépendance ; nécessite WebCrypto
 * (globalThis.crypto ou setCrypto()).
 */
export * from './pairing.js';
export * from './crypto.js';
export * from './schema.js';
export * from './channel.js';
export * from './pairwise.js';
export { setCrypto, getCrypto } from './lib/env.js';
export { ProtocolError } from './lib/errors.js';
export { bytesToB64u, b64uToBytes, utf8Encode, utf8Decode } from './lib/encoding.js';
