<!--
INTERNAL — this comment is not displayed once the Markdown is rendered; remove it before
publishing as raw HTML.
This policy describes the TARGET architecture (end-to-end encryption, relay that stores
nothing, self-hosted fonts, on-device QR code, self-hosted STUN).
DO NOT publish it before the migration is complete: see
the internal migration checklist (kept outside the repository), section 2.
Replace every [BRACKET] before publishing. The French version is the reference text.
The policy PUBLISHED today is privacy.html (repository root, served by GitHub Pages and
embedded in the app, opened from Settings): it describes the ACTUAL production state (public
HiveMQ MQTT broker, Google STUN, GitHub Pages). When switching to the self-hosted relay, only
change its paragraph marked « RELAY: START / END ».
-->

# SetRemote Privacy Policy

Last updated: [PUBLICATION DATE]

## In short

- **No account**, no advertising, no analytics, no trackers, no sale of data.
- Everything you send from one device to the other (photos, videos, sounds, texts, colors, effects) is **end-to-end encrypted** on your device (AES-256-GCM). The keys are created on your devices when you pair them and are never sent to our servers. **We have no technical access to your content.**
- Our relay server only **passes encrypted messages** between your two paired devices. It stores nothing.
- Your settings and cues stay **on your device**.

## 1. Who is responsible for your data?

The data controller is:

**[COMPANY NAME]**, [LEGAL FORM] with a share capital of €[CAPITAL], registered with the [CITY] Trade and Companies Register under number [SIREN]
Registered office: [ADDRESS]
Email: [CONTACT EMAIL]
Website: [WEBSITE]

[If a Data Protection Officer is appointed: “Data Protection Officer: [DPO NAME / CONTACT]”. Otherwise: “We have not appointed a Data Protection Officer; for any question, write to [CONTACT EMAIL].”]

## 2. How SetRemote works

SetRemote uses two devices:

- the **remote**, where you set color, effects, media and prop screens;
- the **playback screen**, which displays what the remote sends it.

You pair the two devices by scanning a **QR code** or entering a **short code** shown on the other device. Each device uses this code to create its own encryption keys for the session. Messages then travel:

- through our **relay server**, which only sees encrypted data; or
- **directly** from one device to the other (WebRTC connection), when the network allows it.

## 3. What data is processed?

### 3.1 The content you send to the playback screen

This means the photos, videos and audio clips you add, the name and photo of a fictional caller, the text of fictional messages, the name and icon of a fictional app (notification), the name, photo and messages of a fictional contact (conversation), the fictional lock-screen wallpaper, and the color, effect, torch and vibration commands.

- It is **encrypted on the sending device** and **decrypted only on the paired receiving device**.
- It is cached **only on the playback screen that receives it**, for the duration of the session. It is erased when you remove it from the media pool, end the session or close the app.
- **Neither we nor our hosting provider can read it.**

If you show the image or voice of a person (an actor, for example) or a copyrighted work, you are responsible for obtaining the necessary permissions.

### 3.2 Technical connection data

To pass the encrypted messages along, the relay server processes **in memory only**: each device's IP address, the connection time, a random session identifier and the size of the messages. It does this **only while the connection is open** and **records nothing**.

[Keep only if the hosting provider keeps network logs: “Our hosting provider may keep technical logs (IP address, timestamp) for [DURATION] to secure its infrastructure.”]

For a direct connection, each device learns the other device's IP address. The addresses are exchanged over the encrypted channel. A STUN server ([STUN SERVER — e.g. “self-hosted on the relay infrastructure”]) tells your device its public IP address. It records nothing and receives no content.

### 3.3 Encryption keys

The pairing secret (QR code or short code) and the encryption keys are **generated and kept on your devices**. They are never sent to our servers. The QR code is drawn on the device itself, without any third-party service.

### 3.4 Your settings, cues and projects

Your color and effect cues and your preferences are stored **locally** (app or browser storage). They do not leave the device unless you export them yourself. They are deleted when you delete them or uninstall the app.

**Project export.** You can export a project (settings and cues) **with or without its media**. The file is created on your device and saved or shared **wherever you choose** (file storage, the system share menu, a messaging app…). We do not receive it. If it contains media, treat it like any file that contains your photos and videos.

### 3.5 If you contact us

If you email us, we use your email address and the content of your message to reply.

### 3.6 Data processed by Apple and Google

When you download SetRemote from the App Store or Google Play, Apple or Google process data (account, download, device) **as independent controllers**, under their own policies:

- Apple: https://www.apple.com/legal/privacy/
- Google: https://policies.google.com/privacy

These platforms give us **aggregated statistics** (number of downloads, installed versions…). If you agreed in your device settings to share analytics with developers, they also give us **anonymized crash reports**. These reports do not contain your content.

### 3.7 If you use the web version

The web version of SetRemote is hosted by [WEBSITE HOSTING PROVIDER], which receives the technical data of any website visit (IP address, browser, page requested) and keeps it for [HOST LOG RETENTION]. The web version sets **no cookies**. It uses the browser's local storage only for your cues and for offline use, at your request. Under French law (art. 82 of the Loi Informatique et Libertés), this storage does not require consent.

### 3.8 What we do not do

We do not create accounts and do no analytics or advertising. We do not track you across apps, sell any data or build profiles. SetRemote does **not** access your contacts, location, call log or text messages. SetRemote's call and message screens are **entirely fictional**: no real call, text message or system notification is ever sent.

## 4. Why, and on what legal basis?

| Purpose | Data | Legal basis (GDPR) |
|---|---|---|
| Deliver your encrypted content between your paired devices | Technical connection data (3.2); encrypted content we cannot read (3.1) | Performance of the contract, i.e. providing the service you ask for (Art. 6(1)(b)) |
| Protect the relay against abuse (rate limiting, blocking an abnormal connection) | IP address, in memory only | Legitimate interest in keeping the service secure (Art. 6(1)(f)) |
| Keep your settings and cues on your device | Local settings (3.4) | Storage strictly needed for a service you explicitly requested (French Loi Informatique et Libertés, art. 82); nothing is transmitted |
| Reply to you | Email and message (3.5) | Legitimate interest in answering requests (Art. 6(1)(f)) |
| Improve app stability | Aggregated statistics and crash reports from Apple or Google (3.6) | Legitimate interest (Art. 6(1)(f)) |
| Meet our legal obligations | Depending on the request | Legal obligation (Art. 6(1)(c)) |

No automated decision with legal effects is made about you.

## 5. How long is data kept?

| Data | Retention |
|---|---|
| Content you send (3.1) | Encrypted in transit, never stored by us. On the playback screen: for the session. |
| Technical data at the relay (3.2) | Only while connected, in memory. Never recorded. |
| Settings, cues and exported projects (3.4) | On your device, or wherever you chose to save them, until you delete them |
| Email exchanges (3.5) | 3 years after the last exchange |
| Platform statistics (3.6) | Per Apple's and Google's retention periods |

## 6. Who receives data?

We do not sell or rent any data. Only the following recipients are involved:

| Recipient | Role | What it receives | Location |
|---|---|---|---|
| [RELAY HOSTING PROVIDER — legal name] | Processor: hosts the relay server [and the STUN server] | **Encrypted** (unreadable) messages and connection data in transit | [COUNTRY — preferably EU/EEA] |
| [WEBSITE HOSTING PROVIDER] | Processor: hosts the website and web version | Technical visit data (3.7) | [COUNTRY] |
| [EMAIL PROVIDER] | Processor: support mailbox | Your emails (3.5) | [COUNTRY] |
| Apple Distribution International Ltd.; Google Ireland Limited | Independent controllers: app distribution | Data tied to your store account (3.6) | Ireland, with possible transfers outside the EU under their own policies |
| Competent authorities | Only on a legal request | What we hold, which is almost nothing, since we have no access to content | France |

Our processors are bound by contracts that comply with Article 28 GDPR. They provide at least the level of protection described here.

## 7. Transfers outside the European Union

We host the relay and the website **in the European Union** [TO CONFIRM depending on the chosen provider]. We do not transfer your data outside the EU. Apple and Google may transfer data outside the EU, including to the United States, under their own policies (EU-US Data Privacy Framework or European Commission standard contractual clauses).

[If a provider is outside the EU: “[PROVIDER] is located in [COUNTRY]; the transfer is covered by [adequacy decision / Data Privacy Framework / standard contractual clauses], a copy of which you can request at [CONTACT EMAIL].”]

## 8. Your rights

You have the right to access, rectify and erase your data, to restrict or object to its processing, and to data portability. Under French law you can also leave instructions about what happens to your data after your death.

To exercise these rights, write to **[CONTACT EMAIL]** or [ADDRESS]. We reply within one month.

We hold neither your content nor any account in your name, so we usually cannot identify you (Art. 11 GDPR). You stay in control directly on your device:

- delete your cues and projects in the app;
- uninstall the app, which erases its local storage;
- withdraw permissions (camera, photos, microphone, local network, Bluetooth) at any time in your device settings.

If you believe your rights are not respected, you can lodge a complaint with the French data protection authority, the **CNIL** (3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07, France, https://www.cnil.fr), or with the authority of your EU country of residence.

## 9. Permissions requested on your device

SetRemote asks for a permission only when you use the feature that needs it. You can refuse or withdraw it at any time. Only that feature will then be unavailable.

| Permission | Why | What SetRemote does not do |
|---|---|---|
| **Camera** | Take a photo or film a video to show on the playback screen; control the playback device's **LED torch**, which the system operates through the camera | No background capture. Nothing is sent anywhere except to your paired device. |
| **Photos and videos** | Choose the images and videos to show, a fictional caller's or contact's photo, a fictional app icon or a fictional wallpaper. Where the system allows it, only the items you select are accessible. | No browsing or uploading of your library |
| **Microphone** | **Only when you film a video** to show: it records that video's sound | No background listening. No recording outside filming the video. |
| **Local network** | Connect your two devices directly on the same Wi-Fi network; receive DMX (sACN, Art-Net) with the DMX gateway | No collection of information about other devices on the network |
| **Bluetooth** | Connect your two devices without Wi-Fi | No location tracking. No scanning for devices other than SetRemote. |

Some Android versions (11 and earlier) require the **location** permission to use Bluetooth. SetRemote **does not use or collect** your location.

Adjusting screen brightness, keeping the screen awake and vibration require no personal data.

## 10. Children

SetRemote is a professional tool for film and video crews. It is not directed at children under 15 (the age of digital consent in France). We do not knowingly collect data about them, and the app collects no personal data for us anyway.

## 11. Security

- **End-to-end encryption** of every message between the remote and the playback screen (AES-256-GCM). Keys are derived on the devices at pairing and never sent to our servers.
- **Encryption in transit** (TLS to the relay, DTLS for the direct connection).
- The **relay stores nothing** and cannot decrypt messages.
- **No account**, so there is no password for us to protect.

To stay in control:

- show the QR code or pairing code only to people you trust;
- end the session to break the pairing;
- protect your devices with a passcode.

## 12. Photosensitivity warning

This is not about personal data, but it concerns your safety. The strobe (up to 30 Hz) and some effects produce flashing lights that may trigger seizures in people with photosensitive epilepsy. A warning is shown before the strobe and fast-flashing effects are activated. Warn everyone on set.

## 13. Changes

We may update this policy, for example when a feature changes. The date at the top shows the latest version. If there is a significant change, we will tell you in the app or on [WEBSITE] before it takes effect.

## 14. Contact

[COMPANY NAME] — [ADDRESS] — [CONTACT EMAIL] — [WEBSITE]
