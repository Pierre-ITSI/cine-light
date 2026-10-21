// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { AudioNativeModule, AudioRoute, SetRemoteAudioEvents } from './bridge';

// Module natif local (ios/SetRemoteAudioModule.swift, android/…/SetRemoteAudioModule.kt),
// lié par l'autolinking d'Expo depuis expo-app/modules/. Un seul appel à la fois.
declare class SetRemoteAudioModule extends NativeModule<SetRemoteAudioEvents> implements AudioNativeModule {
  /** Session d'appel (iOS : playAndRecord / voiceChat ; Android : MODE_IN_COMMUNICATION), sortie, capteur de proximité. */
  startCall(route: AudioRoute, proximity: boolean): Promise<void>;
  /** Joue le fichier local après `delay` secondes (AVAudioPlayer ; MediaPlayer en USAGE_VOICE_COMMUNICATION). */
  play(uri: string, delay: number): Promise<void>;
  setRoute(route: AudioRoute): Promise<void>;
  endCall(): Promise<void>;
}

// null dans Expo Go, sur le web, ou avec un binaire antérieur au module.
export default requireOptionalNativeModule<SetRemoteAudioModule>('SetRemoteAudio');
