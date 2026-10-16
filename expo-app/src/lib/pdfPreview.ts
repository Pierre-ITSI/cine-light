// ════════════════════════════════════════════════════════════════════════════
// Aperçu PDF demandé par la page (table des canaux DMX, maquette 17) :
// logique pure, sans React Native, testée sous Node (test/pdf-preview.test.mjs).
//
//   page → coque  { type: 'pdf:preview', html: string, title: string }
//                 (web/js/87-dmx-gateway-ui.js, gwChannelsPdf)
//   coque → page  { type: 'pdf:error', reason }  par window.SRNative.receive
//
// La coque affiche le document avec expo-print (Print.printAsync({ html })) :
// feuille système d'impression / d'aperçu, avec partage et « Enregistrer en
// PDF » sur iOS comme sur Android. Annuler cette feuille n'est pas une erreur.
//
// Validation : html chaîne non vide d'au plus 1 Mo (UTF-8), titre court sans
// caractère de contrôle. Une seule demande à la fois (les suivantes sont
// ignorées tant que la feuille est ouverte).
// ════════════════════════════════════════════════════════════════════════════

export const PDF_HTML_MAX_BYTES = 1024 * 1024;
export const PDF_TITLE_MAX = 120;
/** A4 en points (72 PPI) : expo-print prend US Letter (612 × 792) par défaut. */
export const A4_POINTS = { width: 595, height: 842 } as const;
/**
 * Marges iOS (≈ 14 mm × 12 mm, comme le @page du document) : le moteur
 * d'impression d'iOS les prend dans les options. Android applique le @page
 * du document lui-même (option `margins` ignorée).
 */
export const IOS_MARGINS = { top: 40, right: 34, bottom: 40, left: 34 } as const;

export const PDF_ERROR_REASONS = [
  'invalid-html', // html absent, vide ou pas une chaîne
  'too-large', // html de plus de 1 Mo
  'invalid-title', // titre absent, trop long ou avec des caractères de contrôle
  'unavailable', // binaire sans expo-print (ancien build de développement)
  'print-failed', // échec du rendu ou de la feuille d'impression
] as const;
export type PdfErrorReason = (typeof PDF_ERROR_REASONS)[number];

export interface PdfRequest {
  html: string;
  title: string;
}
export type PdfParseResult = { ok: true; request: PdfRequest } | { ok: false; reason: PdfErrorReason };

export interface PdfPrintOptions {
  html: string;
  width: number;
  height: number;
  margins?: { top: number; right: number; bottom: number; left: number };
}
export type PdfPrintFn = (options: PdfPrintOptions) => Promise<void>;

/** Longueur UTF-8 d'une chaîne JS (paires de substitution comptées 4 octets). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** null : message étranger à l'aperçu PDF ; sinon demande validée ou raison du refus. */
export function parsePdfPreview(msg: unknown): PdfParseResult | null {
  if (!msg || typeof msg !== 'object' || (msg as { type?: unknown }).type !== 'pdf:preview') return null;
  const { html, title } = msg as { html?: unknown; title?: unknown };
  if (typeof html !== 'string' || html.trim() === '') return { ok: false, reason: 'invalid-html' };
  // Au moins un octet par unité UTF-16 : rejet immédiat des chaînes énormes
  if (html.length > PDF_HTML_MAX_BYTES || utf8Length(html) > PDF_HTML_MAX_BYTES) return { ok: false, reason: 'too-large' };
  if (typeof title !== 'string' || title.trim() === '' || title.length > PDF_TITLE_MAX || CONTROL_CHARS.test(title)) {
    return { ok: false, reason: 'invalid-title' };
  }
  return { ok: true, request: { html, title } };
}

/** Script injecté dans la vue web : { type: 'pdf:error', reason } → window.SRNative.receive. */
export function pdfErrorScript(reason: PdfErrorReason): string {
  return 'window.SRNative&&window.SRNative.receive(' + JSON.stringify({ type: 'pdf:error', reason }) + ');true;';
}

/** iOS rejette printAsync quand la feuille est fermée sans imprimer : ce n'est pas une erreur. */
export function isPrintCancelled(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'ERR_PRINT_INCOMPLETE';
}

export interface PdfPreviewerOptions {
  platform: string;
  /** expo-print chargé à la demande ; null si le binaire ne l'a pas. */
  loadPrint: () => PdfPrintFn | null;
  /** Injection dans la vue web (webView.injectJavaScript). */
  inject: (script: string) => void;
}
export interface PdfPreviewer {
  /** true si le message était une demande d'aperçu PDF (traitée ou refusée). */
  handle(msg: unknown): boolean;
  readonly busy: boolean;
}

export function createPdfPreviewer(opts: PdfPreviewerOptions): PdfPreviewer {
  let busy = false;
  const fail = (reason: PdfErrorReason) => {
    try { opts.inject(pdfErrorScript(reason)); } catch { /* vue web absente : sans effet */ }
  };
  async function preview(req: PdfRequest) {
    let print: PdfPrintFn | null = null;
    try { print = opts.loadPrint(); } catch { print = null; }
    if (!print) { fail('unavailable'); return; }
    busy = true;
    try {
      await print({
        html: req.html,
        width: A4_POINTS.width,
        height: A4_POINTS.height,
        ...(opts.platform === 'ios' ? { margins: { ...IOS_MARGINS } } : {}),
      });
    } catch (e) {
      if (!isPrintCancelled(e)) fail('print-failed');
    } finally {
      busy = false;
    }
  }
  return {
    get busy() { return busy; },
    handle(msg: unknown): boolean {
      const r = parsePdfPreview(msg);
      if (!r) return false;
      if (!r.ok) { fail(r.reason); return true; }
      if (!busy) void preview(r.request);
      return true;
    },
  };
}
