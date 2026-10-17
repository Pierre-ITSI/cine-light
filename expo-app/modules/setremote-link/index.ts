// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Liaisons hors ligne télécommande ↔ écrans (Wi-Fi local, Bluetooth LE) pour
// la vue web. Contrat du pont et choix techniques : docs/OFFLINE-NATIVE.md.
// src/wire.ts (référence du format sur le fil, pour les tests) n'est
// volontairement pas exporté : il n'entre pas dans le bundle.
export { default } from './src/SetRemoteLinkModule';
export * from './src/bridge';
