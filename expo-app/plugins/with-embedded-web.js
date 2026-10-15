// ════════════════════════════════════════════════════════════════════════════
// Config plugin : embarque l'interface web dans le binaire natif.
//
// À chaque « expo prebuild » (local ou EAS) :
//   1. lance scripts/embed-web.mjs, qui (re)génère web-embed/ depuis la racine
//      du dépôt et vérifie qu'il est complet (échec du prebuild sinon) ;
//   2. iOS : copie web-embed/ dans ios/<Projet>/web/ et l'ajoute au projet
//      Xcode comme RÉFÉRENCE DE DOSSIER (« dossier bleu ») dans Copy Bundle
//      Resources : l'arborescence (vendor/fonts/…) est conservée dans
//      SetRemote.app/web/, donc les chemins relatifs de index.html restent
//      valides ;
//   3. Android : copie web-embed/ dans android/app/src/main/assets/web/,
//      servi par la WebView en file:///android_asset/web/.
//
// La coque (app/index.tsx) charge ensuite web/index.html en file://.
// ════════════════════════════════════════════════════════════════════════════
const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EMBED_DIR = 'web-embed'; // produit par scripts/embed-web.mjs
const TARGET = 'web'; // nom du dossier dans le bundle iOS et les assets Android

function embed(projectRoot) {
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'embed-web.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  return path.join(projectRoot, EMBED_DIR);
}

function replaceDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const withEmbeddedWebIos = (config) => {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const src = embed(projectRoot);
      replaceDir(src, path.join(IOSConfig.Paths.getSourceRoot(projectRoot), TARGET));
      return config;
    },
  ]);
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const filepath = `${projectName}/${TARGET}`;
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath,
        groupName: projectName,
        project,
        isBuildFile: true,
        verbose: true,
      });
    }
    // Sans extension, le type serait « unknown » : « folder » fait de « web »
    // une référence de dossier, copiée récursivement telle quelle.
    const refs = project.pbxFileReferenceSection();
    for (const key of Object.keys(refs)) {
      const ref = refs[key];
      if (ref && typeof ref === 'object' && String(ref.path).replace(/"/g, '') === filepath) {
        ref.lastKnownFileType = 'folder';
      }
    }
    return config;
  });
};

const withEmbeddedWebAndroid = (config) =>
  withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const src = embed(projectRoot);
      replaceDir(src, path.join(platformProjectRoot, 'app', 'src', 'main', 'assets', TARGET));
      return config;
    },
  ]);

module.exports = (config) => withEmbeddedWebAndroid(withEmbeddedWebIos(config));
