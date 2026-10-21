// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Réglages de la coque native (logique pure, testée sous Node : test/config.test.mjs)
//
// PUBLIC_WEB_URL : adresse publique de la PWA, à destination des AUTRES
// appareils (QR code et lien d'appairage ouverts dans un navigateur) : l'app ne
// la charge jamais. L'interface embarquée ayant une URL file://, elle ne peut
// pas la déduire de location ; elle la lit dans window.SETREMOTE_NATIVE.publicUrl.
//
// Changer d'hébergement (docs/HOSTING.md) : remplacer cette valeur, par
// exemple par 'https://set-remote.itsi-app.com/', ET PUBLIC_URL dans
// web/js/01-config.js (même valeur), puis publier une nouvelle version native.
// https:// obligatoire, « / » final, ni « ? » ni « # ».
// ════════════════════════════════════════════════════════════════════════════

export const PUBLIC_WEB_URL = 'https://pierre-itsi.github.io/cine-light/';

/** Même règle que PUBLIC_URL côté web (caractères sûrs seulement), « / » final en plus. */
export function isValidPublicUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~%-]*)*\/$/i.test(u);
}

/** Fonctions natives optionnelles annoncées à la page (window.SETREMOTE_NATIVE.caps). */
export interface NativeCaps {
  /** Module setremote-audio présent : voix jouée par le natif, écouteur / haut-parleur, écran noir contre l'oreille. */
  audioRoute?: boolean;
}

/**
 * Script injecté avant le chargement de la page : la PWA sait qu'elle tourne
 * dans l'app (masque l'installation PWA, délègue la luminosité au natif) et
 * connaît son adresse publique. Valeurs sérialisées en JSON : aucune
 * injection possible par une adresse mal formée.
 */
export function nativeBootstrapScript(platform: string, publicUrl: string = PUBLIC_WEB_URL, caps?: NativeCaps): string {
  if (!isValidPublicUrl(publicUrl)) throw new Error('PUBLIC_WEB_URL invalide : ' + publicUrl);
  // bridge 2 + caps : la coque embarque des modules que la page peut utiliser (audioRoute : module setremote-audio,
  // audio de l'appel décroché). Sans caps : bridge 1, comme les coques d'avant.
  const on = caps && caps.audioRoute === true ? { audioRoute: true } : null;
  const native = on ? { platform, bridge: 2, publicUrl, caps: on } : { platform, bridge: 1, publicUrl };
  return `\n  window.SETREMOTE_NATIVE = ${JSON.stringify(native)};\n  true;\n`;
}
