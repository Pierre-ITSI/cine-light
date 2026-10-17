// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { LinkFrame, LinkMode, LinkNativeModule, LinkRole, LinkState, SetRemoteLinkEvents } from './bridge';

// Module natif local (ios/SetRemoteLinkModule.swift, android/…/SetRemoteLinkModule.kt),
// lié par l'autolinking d'Expo depuis expo-app/modules/. Toutes les fonctions
// sont synchrones : elles postent le travail sur la file interne du natif,
// dans l'ordre des appels ; résultats et erreurs arrivent par événements.
declare class SetRemoteLinkModule extends NativeModule<SetRemoteLinkEvents> implements LinkNativeModule {
  start(modes: LinkMode[], role: LinkRole, roomTag: string, authKey: string, name: string): void;
  stop(modes: LinkMode[]): void;
  send(frames: string[], to: string[]): void;
  drain(maxFrames: number, maxBytes: number): LinkFrame[];
  getState(): LinkState;
}

// null dans Expo Go, sur le web, ou avec un binaire antérieur au module.
export default requireOptionalNativeModule<SetRemoteLinkModule>('SetRemoteLink');
