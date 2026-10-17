// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Paquet packages/protocol (chiffrement de bout en bout, appairage, schéma) :
// sa propre suite node --test, rattachée ici pour que `npm test` (et la CI)
// l'exécute. Aucun navigateur requis. Exécution isolée :
//   cd packages/protocol && npm test
import '../packages/protocol/test/encoding.test.js';
import '../packages/protocol/test/crypto.test.js';
import '../packages/protocol/test/pairing.test.js';
import '../packages/protocol/test/schema.test.js';
import '../packages/protocol/test/channel.test.js';
