# App Review notes — SetRemote

Working document for App Store Connect › App Review Information (and, adapted, for Google Play ›
App access instructions).

- **Section 1** is the paste-ready text for the *Notes* field (limit 4,000 characters; the length is
  checked below).
- **Sections 2–5** give more detail if App Review asks follow-up questions.
- **Section 6** is the demo video script.

Items in `[BRACKETS]` must be filled or confirmed before submission. Do not submit until every
behavior described here exists in the build. See the internal migration checklist (kept outside the repository), especially:

- the strobe warning;
- end-to-end encryption;
- the web playback screen URL;
- the in-app privacy link.

---

## 1. Paste-ready Notes field

Measured length: 3,296 characters, under the 4,000 limit. Re-measure after filling the brackets.

<!-- id=review.notes max=4000 -->
```text
SetRemote is a professional tool for film and video crews (props, lighting, art department). It turns a phone or tablet into a remotely controlled light source or prop screen on set. No account or sign-in is required. No in-app purchases.

TWO-DEVICE WORKFLOW
The app runs on two devices:
1. REMOTE: the operator sets color (CCT 1,700–20,000 K, green/magenta tint, dimmer, color wheel), effects, media and prop screens.
2. PLAYBACK SCREEN: shows what the remote sends, full screen.
Pairing: on the remote, tap "Remote" and open the QR tab. On the other device, tap "Playback screen" and scan the QR code or type the short code. All messages between the two devices are end-to-end encrypted (AES-256-GCM, keys derived on the devices). Our relay server only forwards encrypted messages and stores nothing.

HOW TO TEST WITH ONE DEVICE
A) Install the app on your device and choose "Remote". On a Mac or any other computer, open [WEB PLAYBACK SCREEN URL] in Safari (no install, no login) and enter the code shown on the remote. Everything you change on the device appears live in Safari.
B) Or use two devices or two simulators, with the app installed on both: one as Remote, one as Playback screen.
C) A 90-second demo video of every feature is here: [DEMO VIDEO URL]

WHAT TO TRY
- Color tab: drag the CCT, tint and dimmer sliders; the playback screen follows instantly.
- Effects tab: tap "Fire", "TV" or "Chaser".
- Media tab: add a photo (system picker) and tap it to show it on the playback screen.
- Call tab: see "Prop screens" below.

PROP SCREENS (FICTIONAL CALL / MESSAGE)
For scenes where a character receives a call or message, the remote can display a fictional incoming-call or notification screen on the paired playback screen, inside SetRemote only.
- No phone call, SMS/MMS or system notification is ever placed or sent. The app uses no telephony, CallKit, messaging or contacts APIs.
- It only works on a playback screen the user has paired themselves (QR or code in person). It cannot reach any other phone, so it cannot be used for anonymous or prank calls or messages (guideline 1.1.6).
- Three neutral styles ("Glass", "Tonal", "Minimal") with generic icons. No Apple or third-party app names, logos or trademarks. The fictional app name is typed by the user, and the UI asks them not to use real brands (guideline 5.2.5).
- The feature is described in the App Store description.

STROBE SAFETY
A photosensitivity warning is shown before the strobe is activated [CONFIRM: must be acknowledged each time / once per session]. The strobe is capped at 30 Hz, shows a persistent "Strobe on" badge, and can be stopped instantly from the toggle or the Screen ON/OFF button. The App Store description includes the same warning.

PERMISSIONS (asked only when the feature is used)
- Camera: take a photo or video to show on the playback screen; control the playback device's torch.
- Photos: choose media (system picker).
- Microphone: only when filming a video to show.
[KEEP ONLY IF SHIPPED: Local network: direct link between the two devices on the same Wi-Fi. Bluetooth: link without Wi-Fi.]

PRIVACY
No account, no analytics, no ads, no tracking. Encryption uses only the cryptography built into the operating system (Web Crypto API in WKWebView).

Contact: [NAME], [PHONE], [EMAIL]
```

---

## 2. Two-device workflow in detail

| Step | Remote (device 1) | Playback screen (device 2) |
|---|---|---|
| 1 | Launch SetRemote → **Remote** | Launch SetRemote → **Playback screen**, or open [WEB PLAYBACK SCREEN URL] in Safari |
| 2 | Open the **QR** tab: a QR code and a short code are shown | Scan the QR code with the device camera, or type the code → **OK** |
| 3 | The status line shows "Connected" | The screen goes full screen and briefly shows "Listening…" |
| 4 | Change color, effects or media | Updates live |
| 5 | **Screen ON/OFF** button = instant blackout | Goes black |
| 6 | **Back** ends the session | Long-press or double-tap the top-left corner → menu → **Disconnect** |

### Testing on simulators

Install the simulator build on two simulators running side by side. In Xcode: *Open Developer Tool › Simulator*, then *File › Open Simulator* to start a second device, for example an iPhone and an iPad.

Pairing works by typing the code (the simulator camera cannot scan QR codes). The camera and torch features are not available on simulators.

### Features that depend on the hardware

- **Torch** (Torch tab, "Synced torch" option of the strobe): needs a playback device whose system lets the app drive the LED torch. When the device does not allow it, the tab shows an "unavailable" notice. This is expected behavior, not a bug.
- **Vibration**: same logic. Unavailable on devices that do not expose vibration control.
- **DMX / sACN mode** (splash button "DMX mode"): optional professional feature. It needs an sACN lighting network and a gateway on the local network. [EITHER hide it in the review build, OR add: "Not testable without DMX hardware; see the demo video at 1:20."]

---

## 3. The fictional call / message prop screen

**Why it exists.** Props departments routinely need an on-screen phone that "rings" on cue in a scene (an actor's phone receives a call or a text). Real calls cannot be timed or framed reliably and would show real personal data. SetRemote shows a **fictional, neutral** screen that the operator triggers on cue.

**What it does.**

- On the remote (Call tab), the operator chooses: type (call / SMS / chat), style (Glass / Tonal / Minimal), caller name, subtitle, optional photo, message text, a fictional app name and color, ringtone (synthesized tones), optional audio clip played when the call is answered, and auto-answer delay.
- On the paired playback screen, SetRemote draws a full-screen or top-banner incoming call, an in-call screen with a timer, a notification card, or a mock lock screen with the notification.

**What it does not do.**

- No call, SMS, MMS, push or local notification is ever created. SetRemote has no telephony, CallKit, messaging, contacts or call-log entitlement or API.
- It works only on a device that the user paired themselves, in person (QR code or code). It cannot reach a third party.
- It does not display outside the app: no system UI, no lock-screen widget, no notification.
- It ships no Apple or third-party trademarks, logos or app names. The icons are generic SVGs drawn by us. The "app name" shown on a notification is free text typed by the operator, with an in-app hint asking for a made-up name.

**Guidelines considered.**

- **1.1.6**: no anonymous or prank calls or messages, because nothing leaves the pair of devices and no real communication happens.
- **5.2.5**: neutral styles, not a copy of Phone or Messages. [Internal: see the checklist. The "Glass" style's lowercase in-call labels are to be reviewed before submission.]
- **2.3.1**: the feature is disclosed in the description and in these notes.

---

## 4. Strobe photosensitivity safeguard

- The strobe frequency is limited to **30 Hz** (slider 0.5–30 Hz; in random mode the maximum is also 30 Hz).
- **Before activation**, a photosensitivity warning explains that flashing lights may trigger seizures in people with photosensitive epilepsy. The operator must confirm before the strobe starts. [CONFIRM the exact wording and whether it appears on every activation or once per session.]
- While active: a "Strobe on" badge, a local preview, one-tap stop (toggle), and a global **Screen ON/OFF** blackout.
- Effects with fast flashes (Lightning, Flash bursts, Police) [CONFIRM: also show the warning / or not].
- The App Store and Play descriptions contain the same warning.

---

## 5. Privacy and encryption (for reviewer questions)

- App Privacy label: **Data Not Collected**. See `app-store-privacy.md`.
- Content is end-to-end encrypted on the devices (AES-256-GCM). Keys are derived on the devices at pairing and never sent to a server.
- The relay server forwards ciphertext only and keeps nothing.
- Encryption uses the operating system's built-in cryptography (Web Crypto API in WKWebView). There is no bundled crypto library. `ITSAppUsesNonExemptEncryption = NO` [CONFIRM after legal check; see `app-store-privacy.md` §D].
- Privacy policy: [SITE WEB]/privacy. It is also linked in the app from the home screen [TO ADD in the build].

---

## 6. Demo video script (60–90 s)

**Setup.**

- Two devices on a table, filmed from above, plus a screen recording of each device, edited side by side.
- Neutral desk. No brand visible. Clean status bar (no carrier name).
- English captions, no voice-over needed.
- Use only royalty-free media and a fictional caller ("Alex").

| Time | Shot | On screen / caption |
|---|---|---|
| 0:00–0:05 | Title card | "SetRemote — App Review demo. Remote (left) + Playback screen (right)." |
| 0:05–0:15 | Left: launch → **Remote** → QR tab. Right: launch → **Playback screen** → scan QR / type code | "Pair two devices with a QR code or short code. End-to-end encrypted." |
| 0:15–0:25 | Color tab: drag CCT 3200 → 5600 K, tint, dimmer; right screen follows | "Color temperature, tint, dimmer — live." |
| 0:25–0:35 | Effects tab: Fire, then Chaser with speed change; Stop | "Effects lab for set lighting." |
| 0:35–0:43 | Turn strobe on → **photosensitivity warning** → confirm → 2 Hz for 2 s → off | Caption first: "Caution: flashing lights." Then "Warning shown before activation; capped at 30 Hz." |
| 0:43–0:53 | Media tab: add a photo (system picker) → tap → shown on right; add a video → loop | "Images and videos sent device-to-device." |
| 0:53–1:08 | Call tab: name "Alex", style Tonal → **Ring** → right shows the fictional incoming-call screen → Answer → timer → End | "Fictional prop screen for scenes. No real call is placed. No telephony or contacts access." |
| 1:08–1:15 | Message type → lock-screen toggle → **Send notification** → right shows the mock lock screen card | "Fictional message prop. No system notification." |
| 1:15–1:22 | Remote → export a project → choose **with / without media** → system share sheet | "Export a project, with or without media. Stays on your device." |
| 1:22–1:27 | Screen ON/OFF → right goes black; Back → disconnect | "Instant blackout. End the session anytime." |
| 1:27–1:30 | End card | "No account · No ads · No tracking · Data Not Collected" |

[If DMX mode is kept in the build: add a 5 s shot of the playback screen following a console fader, with the caption "Optional DMX/sACN input via a local gateway". Trim the strobe or media shots to stay under 90 s.]
