// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ DÉMOS DE L'APERÇU (Tel, Séquence) ══════════════════════════
// Contenu fixe des onglets Tel et Séquence sans licence (version officielle,
// 77-licence-ui.js) : prêt à jouer sur les écrans, sans limite, jamais
// modifiable ni enregistré. Il est servi à la place des clés de l'utilisateur
// par le masque du stockage (12-session.js) : les données de l'utilisateur ne
// sont ni lues ni touchées, et reviennent telles quelles avec la licence.
//   Tel       un appel, un SMS et une notification (liste enregistrée et
//             formulaire), une discussion avec Maman (fil en cours, et la
//             même enregistrée), Maman parmi les appelants enregistrés.
//   Séquence  « Batterie à plat » : SMS de Maman au GO → déverrouillage quand
//             le comédien touche l'écran → discussion avec Maman (lecture tout
//             automatique : elle se joue sans personne)
//             une fois déverrouillé → batterie faible → extinction.
// Textes affichés, regroupés pour la traduction
const _DEMO_TXT = {
  contact: 'Maman', label: 'mobile', actor: 'Julie',
  smsMsg: 'Tu es où ?',
  notifApp: 'Chatly', notifTitle: 'Maman', notifMsg: 'Tu as vu mes messages ? Rappelle-moi.',
  chat: ['Tu es où ?', 'Ton père t\'attend depuis une heure', 'je suis chez Léa, j\'arrive', 'Je t\'ai vue avec lui. On en parlera ce soir.', 'pardon maman'],
  chatName: 'Maman — démo',
  seqName: 'Démo — « Batterie à plat »',
};
// Identifiants réservés aux démos (préfixe « demo- » : jamais tiré par l'app)
const DEMO_IDS = Object.freeze({ call: 'demo-call', sms: 'demo-sms', notif: 'demo-notif', chat: 'demo-chat', caller: 'demo-maman' });

const _demoCall = () => ({
  id: DEMO_IDS.call, kind: 'call', style: 'glass', name: _DEMO_TXT.contact, label: _DEMO_TXT.label,
  ring: 'classic', ringVolume: 1, vib: true, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false,
});
const _demoSms = () => ({
  id: DEMO_IDS.sms, kind: 'sms', style: 'glass', name: _DEMO_TXT.contact, label: _DEMO_TXT.label, msg: _DEMO_TXT.smsMsg,
  appName: 'SMS', appColor: '#2f8cf0', ring: _ringDefault('sms').sound, ringVolume: 1, vib: true, lock: null, autoAnswer: 0, hasPhoto: false, hasAudio: false,
});
const _demoNotif = () => ({
  id: DEMO_IDS.notif, kind: 'notif', style: 'glass', name: _DEMO_TXT.notifTitle, label: '', msg: _DEMO_TXT.notifMsg,
  appName: _DEMO_TXT.notifApp, ring: _ringDefault('notif').sound, ringVolume: 1, vib: true, present: 'banner', phone: {}, received: { mode: 'now' },
  autoAnswer: 0, hasPhoto: false, hasAudio: false,
});
// Messages de la discussion : le contact écrit, le comédien répond (timings par défaut)
const _demoMsgs = () => _DEMO_TXT.chat.map((text, i) => Object.assign(
  { id: 'd' + (i + 1), from: i === 2 || i === 4 ? 'actor' : 'contact', text },
  chatTimingDefaults(i === 2 || i === 4 ? 'actor' : 'contact'),
));
const _demoSavedChat = () => ({
  id: DEMO_IDS.chat, name: _DEMO_TXT.chatName, contact: _DEMO_TXT.contact, actor: _DEMO_TXT.actor,
  style: 'minimal', msgs: _demoMsgs(), hasPhoto: false, photoSig: null,
});
const _demoStep = (id, kind, trig, opt, ref) => ({ id, kind, ref: ref || null, target: null, trig, opt: opt || {} });
const _demoSeq = () => ({
  v: 1, name: _DEMO_TXT.seqName, savedId: null, target: { k: 'all' }, // étapes sans cible : elles suivent celle de la séquence
  steps: [
    _demoStep('demo1', 'sms', { k: 'go' }, {}, DEMO_IDS.sms),
    _demoStep('demo2', 'unlock', { k: 'gesture', g: 'touch', t: 0 }, { code: 4, then: 'home', img: null, imgName: '' }),
    _demoStep('demo3', 'chat', { k: 'gesture', g: 'unlock', t: 0 }, { auto: true, full: true }, DEMO_IDS.chat),
    _demoStep('demo4', 'battery', { k: 'after', s: 25 }, { level: 4 }),
    _demoStep('demo5', 'off', { k: 'after', s: 8 }),
  ],
  phone: { clock: { mode: 'real', date: '', time: '' }, net: { bars: 3, type: PB_NET_TYPES[1], plane: false, wifi: false }, bat: { level: 12, charging: false, pct: true } },
});

// Contenu des clés masquées d'une fonctionnalité (null : clé absente → valeurs par défaut)
function licDemoStore(f) {
  const j = (o) => JSON.stringify(o);
  if (f === 'tel') {
    return new Map([
      [CALLERS_KEY, j({ v: 1, list: [{ id: DEMO_IDS.caller, name: _DEMO_TXT.contact, label: _DEMO_TXT.label, hasPhoto: false }] })],
      [RING_SETTINGS_KEY, null],
      [CALL_LIST_KEY, j({ v: 1, call: [_demoCall()], sms: [_demoSms()], notif: [_demoNotif()] })],
      [CHAT_LS_KEY, j({ v: 2, name: _DEMO_TXT.contact, actor: _DEMO_TXT.actor, style: 'minimal', typing: false, msgs: _demoMsgs(), sent: [], open: false, screens: null, resumeAt: null, savedId: DEMO_IDS.chat, pend: [] })],
      [CHAT_AVATAR_KEY, null],
      [CHAT_SAVED_KEY, j({ v: 2, list: [_demoSavedChat()] })],
    ]);
  }
  return new Map([[SEQ_LS_KEY, j(_demoSeq())], [SEQ_SAVED_KEY, null]]);
}
// Entrées du formulaire Tel, dans l'ordre de chargement (l'appel en dernier : type affiché)
function licDemoEntries() { return [_demoSms(), _demoNotif(), _demoCall()]; }
// Élément d'une étape de la démo Séquence (91-sequence.js) quand l'onglet Tel,
// sous licence, montre les éléments de l'utilisateur
function licDemoRef(kind, ref) {
  if (!licLocked('seq') || typeof ref !== 'string' || !ref.startsWith('demo-')) return null;
  if ((kind === 'call' || kind === 'missed') && ref === DEMO_IDS.call) return _demoCall();
  if (kind === 'sms' && ref === DEMO_IDS.sms) return _demoSms();
  if (kind === 'notif' && ref === DEMO_IDS.notif) return _demoNotif();
  if (kind === 'chat' && ref === DEMO_IDS.chat) return _chsvSanitize(_demoSavedChat());
  return null;
}
