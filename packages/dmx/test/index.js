// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Point d'entrée du dossier : Node 22 traite `node --test packages/dmx/test/`
// comme un module (et non un dossier) ; ce fichier rassemble donc toute la suite.
// Équivalent : `node --test "packages/dmx/test/*.test.js"` ou `npm run test:dmx`.
import './sacn.test.js';
import './artnet.test.js';
import './merge.test.js';
import './personalities.test.js';
import './patch.test.js';
import './engine.test.js';
