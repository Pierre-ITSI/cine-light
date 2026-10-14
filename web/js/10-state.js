// ══════════════════════════ STATE ══════════════════════════
let mode = null, channel = null, mqttClient = null;
let currentColor = '#ffffff';
let showHex = true;
// Modèle couleur unifié : blanc (kelvin+tint) ↔ couleur (roue), mixés par crossfade, × dimmer
let colorDimmer = 100;        // luminosité maître %
let kelvinK = 5600;           // température °K
let colorTint = 0;            // Green/Magenta -100..+100
let colorWheelHex = '#ffffff';// teinte choisie sur la roue (pleine saturation)
let colorCrossfade = 0;       // 0 = blanc CCT/tint · 100 = couleur roue
let strobeActive = false, strobeMode = 'regular';
let strobeFreq = 2, strobeFlashDur = 50, strobeFreqMax = 8, strobeFlashDurMax = 200;
let strobePreviewTimer = null, autoSendTimer = null;

