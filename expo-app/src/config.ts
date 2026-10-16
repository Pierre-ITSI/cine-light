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

/**
 * Script injecté avant le chargement de la page : la PWA sait qu'elle tourne
 * dans l'app (masque l'installation PWA, délègue la luminosité au natif) et
 * connaît son adresse publique. Valeurs sérialisées en JSON : aucune
 * injection possible par une adresse mal formée.
 */
export function nativeBootstrapScript(platform: string, publicUrl: string = PUBLIC_WEB_URL): string {
  if (!isValidPublicUrl(publicUrl)) throw new Error('PUBLIC_WEB_URL invalide : ' + publicUrl);
  const native = { platform, bridge: 1, publicUrl };
  return `\n  window.SETREMOTE_NATIVE = ${JSON.stringify(native)};\n  true;\n`;
}
