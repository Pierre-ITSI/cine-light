// ══════════════════════════ RESYNCHRONISATION (télécommande) ══════════════════════════
// Un écran annonce ses capacités (« caps ») à chaque (re)connexion et en
// réponse au « hello » de la télécommande (envoyé à chaque (re)connexion de
// celle-ci). La télécommande renvoie alors un instantané complet de l'état :
// un écran rechargé ou revenu d'une coupure retrouve exactement ce que la
// télécommande affiche. Les médias lourds (fond d'écran verrouillé, bande son,
// photo d'appel, média actif) ne sont renvoyés que si l'écran ne les a pas.
// Plusieurs « caps » rapprochés (plusieurs écrans) → un seul envoi groupé.
let _resyncTimer = null, _resyncNeed = null;
const RESYNC_DELAY_MS = 250;
const _RESYNC_ASSETS = ['__lockwall', '__callaudio', '__callphoto'];

function remoteScheduleResync(caps) {
  if (mode !== 'remote') return;
  const need = _resyncNeed || (_resyncNeed = { lacks: new Set(), mediaMissing: false });
  if (Array.isArray(caps.cached)) {
    // Écran récent : liste exacte de son cache. Ce qu'il a perdu (rechargement)
    // n'est plus considéré « en cache écran » → préchargement / renvoi.
    const has = new Set(caps.cached);
    for (const id of [..._screenCached]) if (!has.has(id)) _screenCached.delete(id);
    for (const id of _RESYNC_ASSETS) if (!has.has(id)) need.lacks.add(id);
  } else {
    // Ancien écran / écran natif : on s'en tient à ce qu'il a déjà accusé
    for (const id of _RESYNC_ASSETS) if (!_screenCached.has(id)) need.lacks.add(id);
  }
  // « active » n'est envoyé que par les écrans récents (absent = inconnu)
  if (typeof caps.blackout === 'boolean') remoteAdoptScreenBlackout(caps.blackout);
  if (Object.prototype.hasOwnProperty.call(caps, 'active') && caps.active !== _activeMediaId) need.mediaMissing = true;
  if (_resyncTimer) clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(remoteResync, RESYNC_DELAY_MS);
}

function remoteResync() {
  _resyncTimer = null;
  const need = _resyncNeed || { lacks: new Set(), mediaMissing: false };
  _resyncNeed = null;
  if (mode !== 'remote' || !mqttClient || !mqttClient.connected) return;
  // Lumière
  sendMsg({ type: 'color', color: currentColor });
  if (_blackoutTouched) sendMsg({ type: 'blackout', on: remoteBlackout });
  sendMsg({ type: 'screen:brightness', value: screenBrightnessPct / 100 });
  if (activeScreenEffect) sendMsg({ type: 'effect', name: activeScreenEffect, active: true, params: buildEffectParams() });
  if (strobeActive) sendMsg(buildStrobePayload()); // après l'effet : le strobe prime
  // Médias
  sendMsg({ type: 'media:autoadvance', on: _autoAdvance });
  sendMsg({ type: 'media:endmode', mode: _videoEndMode });
  sendPoolOrder();
  if (_lockWallData && need.lacks.has('__lockwall')) sendImageChunks(_lockWallData, { mediaId: '__lockwall', show: false });
  if (_callAudioData && need.lacks.has('__callaudio')) sendImageChunks(_callAudioData, { mediaId: '__callaudio', show: false });
  if (_callPhoto && need.lacks.has('__callphoto')) sendImageChunks(_callPhoto, { mediaId: '__callphoto', show: false });
  // Média diffusé absent de l'écran : media:show s'il est en cache écran,
  // sinon re-diffusion complète (même chemin qu'une sélection dans le pool)
  if (_activeMediaId && need.mediaMissing && _mediaPool.some((m) => m.id === _activeMediaId)) selectMedia(_activeMediaId);
  schedulePreload();
}
