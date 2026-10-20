# SetRemote string catalog (FR source + EN)

This folder holds every user-visible string of the web UI as a flat key → string catalog. It is
groundwork for the i18n integration, which is a separate step. **Nothing in the app reads these
files yet.**

| File | Content |
|---|---|
| `fr.json` | French source strings (reference language) |
| `en.json` | English translations, written for film crews |
| `sources.json` | For each key: the exact original string as it appears in the code, the primary source **`file`**, the `location` (every `file:line` where it appears, plus the element id or function), its type, and notes |

The strings were extracted on 2026-10-14/15 from the **web sources on `main` @ `5e0323d`**:

- `web/index.template.html` (markup);
- `web/js/*.js` (scripts).

`web/styles/*.css` contain no visible text. The root `index.html` is a build artifact
(`npm run build`) and is not referenced. Line numbers refer to `5e0323d`. When they drift, search
for the `original` text.

## Counts

| Scope | Keys |
|---|---|
| `web/` sources, live UI | **379** |
| `web/` sources, dead code (`legacy.*`, target element missing from `web/index.template.html`) | 12 |
| Outside `web/` (extra): native shell error screen (3), iOS permission prompts from `app.json` (5), PWA manifest (2) | 10 |
| **Total keys** | **401** (381 distinct French strings) |

Keys by primary source file:

| File | Keys | File | Keys |
|---|---|---|---|
| `web/index.template.html` | 213 | `web/js/70-media-remote.js` | 24 |
| `web/js/80-call-simulator.js` | 60 | `web/js/60-sacn.js` | 11 |
| `web/js/50-effects-remote.js` | 51 | `web/js/66-torch-flash.js` | 8 |
| `web/js/95-splash.js` | 4 | `web/js/75-media-screen.js` | 4 |
| `web/js/30-navigation.js` | 3 | `web/js/68-blackout.js` | 3 |
| `web/js/32-status.js`, `40-color.js`, `45-strobe.js`, `62-memories.js` | 2 each | `web/js/20-mqtt.js`, `85-media-screen-playback.js` | 1 each |
| `expo-app/app.json` | 5 | `expo-app/app/index.tsx` | 3 |
| `manifest.webmanifest` | 2 | | |

By type (`sources.json` → `type`):

| Type | Count |
|---|---|
| `markup` (static HTML text) | 201 |
| `js` (set by `textContent`, `innerHTML`, `setMediaStatus`, `setScreenStatus`, `setConnStatus`, `flashScreenNotice`, `_setCallStatusUI` and similar) | 177 |
| `placeholder` | 8 |
| `value` (default field values) | 4 |
| `attr` (`title`) | 1 |
| `permission` / `native` / `manifest` (outside `web/`) | 10 |

The French source contains no `aria-label`, no `alt` text other than empty strings, and only one `title`.

## Conventions

- **Flat keys** with semantic namespaces: `splash.*`, `screen.*` (playback screen), `remote.*`,
  `color.*`, `strobe.*`, `vibrate.*`, `memory.*`, `flash.*` (torch tab), `effects.*`, `fx.<effect>.*`
  (effect names and labels from `EFFECT_CONFIG`), `media.*`, `call.*` (call/message prop tab on the
  remote), `callScreen.*` (fictional call/notification overlay drawn on the playback screen), `qr.*`,
  `dmx.*`, `common.*`, `legacy.*`, `native.*`, `pwa.*`.
- **Placeholders** use `{name}`: `"Connexion à {channel}…"`. FR and EN always have the same set of
  placeholders, and the generator checks this.
- **Icons are stripped** from the translatable text. A leading or trailing emoji or glyph used as an
  icon (🎨, ⚠, 📤, ✓, ←, ▶…) is recorded in `sources.json` as `icon` + `iconPosition`. The refactor
  should render `icon + " " + t(key)`. A value like `🎬|🖼` means the icon depends on the media kind.
- **Rich text**: two strings contain inline `<strong>` markup (`splash.install.iosHint`,
  `qr.howTo.step1`). They are split into a sentence with placeholders and separate keys for the
  emphasized parts.
- **Reused keys**: a string is stored once when it has the same meaning in several places, for
  example `common.back`, `color.crossfade.label` (4 places) and `memory.record` (2 places).
  `location` lists every place it appears.

### What was deliberately left out

- Units and numbers that need no translation: `Hz`, `ms`, ` K`, `GM`, `%`, `°`, Kelvin chips
  (`1700K`…), tint chips with no words (`−50`, `+25`…), `0:00`, `#FFFFFF`, `—`.
- Glyph-only buttons: `✕`, `×`, `−`, `+`. They should get `aria-label`s, but there is no source
  string for them yet.
- Purely technical status strings with no words: `sACN ✓ U{universe} · @{address}`, the CCT meta
  line `{kelvin}K · {tint}GM · {dimmer}%`, and the legacy DMX tile `CH {n}`.
- `SACN_MODES[].label` (`web/js/60-sacn.js:125–142`). These labels are never displayed.
- Developer-only text: `console.warn`, comments, and `Error('image illisible')`, which is never
  shown.
- `screen.html` (the separate DMX page linked from the splash) is **not** included. It has roughly
  60 more French strings (about 43 in markup and 19 set from JS) and should be extracted separately if it ships in the app.

## Glossary used for EN

| FR (UI) | EN | Note |
|---|---|---|
| Télécommande | Remote | |
| Écran projecteur / écran de jeu / récepteur | Playback screen / playback device | The UI says “Écran projecteur”, while the product spec says “écran de jeu”. Both map to *playback screen*. |
| Intensité (Dimmer), Luminosité maître | Intensity (dimmer), Master dimmer | |
| Température (de couleur) | CCT / Color temperature (CCT) | |
| Tint · Magenta ↔ Vert | Tint · Magenta ↔ Green | Green/magenta shift (±GM) |
| Stroboscope / Strobe | Strobe | |
| Chaser, Wing, Loop/Bounce/Invert | Chaser, Wing, Loop/Bounce/Invert | Console vocabulary, kept |
| Mémoire(s) | Cue(s) | “Color cues”, “Effect cues”, default name “Cue {n}” |
| Enregistrer / Mettre à jour (mémoire) | Record / Update | Console verbs |
| Torche | Torch | |
| Pool média | Media pool | |
| Diffuser | Put on screen / play | “diffusion” → playback |
| Bande son au décroché | Audio on pick-up | Clip played when the fake call is answered |
| Décroché automatique | Auto-answer | |
| Fragments | Chunks | |

## Translations I was unsure about

| Key | FR | EN chosen | Why |
|---|---|---|---|
| `splash.role.electrics` | les électros | sparks | Set slang that works in both the UK and US. “electricians” is safer but longer. |
| `splash.role.boardOps` | les pupitreurs | board ops | Alternatives: “desk ops”, “console operators”. |
| `splash.role.dop` | les DOP | DPs | US usage; UK crews say “DoPs”. |
| `fx.fire.speed` | Intensité rapide | Flicker speed | The literal “fast intensity” makes no sense. The slider controls the flicker rate. |
| `effects.smoothing` | Lissage des sautes | Cut smoothing | Smooths the hard cuts between TV-flicker colors. |
| `effects.leadFade` / `fx.chaser.trailingFade` / `effects.trail` | Traîne avant / arrière / Traîne / fondu | Leading fade / Trailing fade / Trail / fade | Chaser edge softness. Confirm with a board op. |
| `effects.radial.title` | Sens | Flow | Radial in/out direction. “Direction” is already used. |
| `effects.travel.title` | Course | Travel | Chaser run mode. |
| `fx.aurora.*` | Nappe | Layer | “Veil” is also possible. |
| `fx.neon.name` | Néon HS | Faulty neon | “HS” means “hors service”. |
| `media.endMode.pause` | 1× puis pause | Play once, then hold | “hold” = freeze on the last frame |
| `call.kind.chat`, `call.app.defaultChat` | Messagerie | Chat | Must never become a real app name such as “Messages” or “Messenger”. |
| `callScreen.inCall.hangUp` | Raccrocher | Hang up | |
| `call.caller.nameDefault` | Maman | Mom | UK: “Mum”. Needs an `en-GB` variant if UK is targeted. |
| `remote.tabs.flash` | Flash | Torch | The tab drives the LED torch. “Flash” could be confused with the strobe. |

## Problems found in the source (to fix during the refactor)

1. **Platform names inside the app (App Store guideline 2.3.10).** `flash.unavailable.title`,
   `flash.unavailable.body` and `legacy.torch.unavailable` name iPhone, iOS and Android. Neutral
   wording proposal:
   - FR: « Torche non disponible sur cet écran de jeu » / « Cet appareil ne permet pas de piloter la torche LED ni le vibreur. Utilisez le strobe à l’écran (onglet Effets) ou un autre appareil comme écran de jeu. »
   - EN: “Torch not available on this playback device” / “This device doesn’t allow control of the LED torch or vibration. Use the on-screen strobe (Effects tab) or another device as the playback screen.”
2. **Inconsistent terminology.** The UI says “Écran projecteur” (splash, connect screen, QR help,
   `NSLocalNetworkUsageDescription`), while other strings and the spec say “écran de jeu”. Pick one
   French term. The EN side already uses *playback screen* everywhere.
3. **Locale hard-coded in the code.**
   - `toLocaleString('fr')` formats the Kelvin values in `web/js/40-color.js:127`,
     `web/js/50-effects-remote.js:504` and `web/js/62-memories.js:131`.
   - The lock-screen date is built from hand-written French arrays (`web/js/80-call-simulator.js:369–372`,
     keys `callScreen.lock.*`). It should use `Intl.DateTimeFormat`.
   - `<html lang="fr">` (`web/index.template.html`) and the manifest `"lang": "fr"` are static.
4. **Units inside sentences.** `Ko` and `Mo` must become `KB` and `MB` in EN. They are already part
   of the strings (`media.status.imageSent`, `screen.status.videoReceived`, `call.audio.tooLarge`).
5. **Strings built by concatenation** (`'Connexion à ' + ch + '…'`, `cfg.icon + ' ' + cfg.name + ' actif'`).
   Replace them with `t(key, {params})` so the word order can change between languages.
6. **Dead code.** `toggleScreenTorch`, `toggleScreenVibrate` (`web/js/66-torch-flash.js`) and
   `setSacnStatus` / `updateDmxGrid` (`web/js/60-sacn.js`) target elements that are absent from
   `web/index.template.html` (`#torchBtn`, `#vibrateBtn`, `#sacnLabel`, `#sacnConnectBtn`,
   `#dmxChannelGrid`). Their strings are under `legacy.*`. Delete them or wire them back up.
7. **Accessibility.** Icon-only buttons (`✕`, `×`, `−`, `+`, `TAP`) have
   no `aria-label`.
8. **Features not on `main` yet, which will need new keys.** None of these exists in
   `main@5e0323d`; add keys when they land:
   - the photosensitivity warning shown before the strobe is activated (product decision: strobe
     capped at 30 Hz);
   - project export with or without media;
   - the in-app privacy-policy link.

   The warning and the privacy link are required before store submission (see `docs/compliance/`).
9. **iOS permission prompts are French only** (`native.permission.*`). Ship them localized, for
   example through Expo `locales` (`ios.infoPlist` keys per language), so English-language devices
   do not show French system prompts.

## Checking the catalog

The FR and EN files must keep exactly the same keys and placeholders:

```bash
python3 -c "import json,re;f=json.load(open('i18n/fr.json'));e=json.load(open('i18n/en.json'));assert f.keys()==e.keys();P=lambda s:set(re.findall(r'\{\w+\}',s));bad=[k for k in f if P(f[k])!=P(e[k])];print('OK' if not bad else bad)"
```

When the catalog was generated, two checks were run:

- Every `fr.json` value (its literal parts, outside placeholders) appears within ±2 lines of every
  `file:line` listed in `sources.json`.
- A reverse scan of the built page (`npm run build` output, i.e. `web/index.template.html` plus
  `web/js/*.js`) for visible text missing from the catalog found only the exclusions listed above.

Part 3 and the resync commit (`b748570`, `5e0323d`) added no new visible strings. They only reuse
`Connexion…` / `Connexion à {channel}…` on reconnect (`web/js/20-mqtt.js:43–44`).
