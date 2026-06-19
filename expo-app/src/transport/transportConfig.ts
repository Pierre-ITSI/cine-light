/**
 * Constantes partagées par les transports hors-ligne (Wi-Fi local et BLE).
 * Centralisées pour que la télécommande (émetteur) et l'écran (récepteur)
 * restent strictement alignés.
 */

/** Port TCP par défaut du serveur Wi-Fi local hébergé par la télécommande. */
export const WIFI_PORT = 8777;

/** Séparateur de trames sur le flux TCP (un message JSON par ligne). */
export const WIFI_FRAME_DELIMITER = '\n';

/**
 * UUIDs du service BLE de Ciné Light. L'écran (périphérique) annonce ce
 * service ; la télécommande (central) écrit les commandes sur la
 * caractéristique. Générés une fois pour le projet — ne pas changer sans
 * casser la compatibilité entre versions.
 */
export const BLE_SERVICE_UUID = 'c1e10000-7a11-4b0d-9c3e-6c1e1ed70000';
export const BLE_CMD_CHARACTERISTIC_UUID = 'c1e10001-7a11-4b0d-9c3e-6c1e1ed70000';

/** Préfixe d'annonce BLE, sert au filtrage lors du scan côté central. */
export const BLE_ADVERTISED_NAME = 'CineLight';

/**
 * Taille de découpage des trames BLE. Le MTU négocié varie (20 à ~250 o) ;
 * on borne conservativement et on réassemble côté récepteur. Les messages
 * courants (couleur, strobe, vibrate, torch) tiennent en une trame ; seuls
 * les rares longs payloads sont découpés.
 */
export const BLE_CHUNK_SIZE = 180;

/** Encadre un payload JSON en trames BLE numérotées « i/n|data ». */
export function frameBleChunks(json: string): string[] {
  const total = Math.max(1, Math.ceil(json.length / BLE_CHUNK_SIZE));
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const part = json.slice(i * BLE_CHUNK_SIZE, (i + 1) * BLE_CHUNK_SIZE);
    out.push(`${i}/${total}|${part}`);
  }
  return out;
}
