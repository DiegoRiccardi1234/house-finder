/**
 * Costruisce il bundle Windows scaricabile: dist/HouseFinder-windows.zip
 *
 * Contenuto dello zip: una cartella `HouseFinder/` con TRE sole voci in vista —
 *   HouseFinder.exe   il doppio click: avvia node nascosto, icona nell'area di notifica
 *   LEGGIMI.txt       cosa fare, dove sono i dati, come si aggiorna
 *   app/              tutto il resto, che a chi usa l'app non interessa:
 *                       node.exe, node_modules/, server+CLI compilati (tsc), ui/dist,
 *                       data/ di esempio, scripts/tray.ps1, avvio-con-console.bat,
 *                       .env.example, README.md, LICENSE
 *
 * È la forma di Job Finder e Trip Finder, dove PyInstaller nasconde tutto in `_internal/`. Prima
 * le voci in cima erano undici, `package-lock.json` compreso, e la cosa da cliccare era un `.vbs`
 * in mezzo a un `node.exe` che sembrava altrettanto cliccabile: chi apriva la cartella non poteva
 * sapere da dove si comincia.
 *
 * Perché `tsc` e non un bundler: `imapflow` e `mailparser` risolvono moduli a runtime
 * (encoding di iconv-lite, ecc.). Un bundle single-file li romperebbe in modi che si vedono
 * solo in esecuzione. Compilare e spedire node_modules di produzione è più grosso ma sicuro.
 *
 * Uso: node scripts/build-bundle.mjs
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
/**
 * La cartella si chiama come l'app perché **finisce dentro lo zip con questo nome**.
 *
 * Prima si comprimeva il CONTENUTO (`-Path '<stage>\*'`) e l'archivio si apriva su undici voci
 * sparse: estratto dentro Download, le mescolava a tutto il resto. Job e Trip Finder mettono una
 * cartella sola e si estraggono dove capita senza fare danni.
 */
const STAGE = join(DIST, 'HouseFinder');
const APP = join(STAGE, 'app');
/**
 * Lo stesso percorso, relativo alla radice: è quello che si passa a `tsc`.
 *
 * Non l'assoluto: `run()` usa `shell: true` su Windows e non mette le virgolette, quindi un path
 * che contiene uno spazio — e questo progetto vive in "Script programmati" — arriva spezzato in
 * due, e `tsc` risponde «Option 'project' cannot be mixed with source files».
 */
const APP_REL = 'dist/HouseFinder/app';

/** Versione di Node spedita nello zip. Aggiornala insieme alla matrice della CI. */
const NODE_VERSION = process.env.BUNDLE_NODE_VERSION ?? '22.11.0';
const NODE_EXE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

/**
 * Su Windows serve la shell (`npx` e `npm` sono `.cmd`), ma con `shell: true` Node incolla gli
 * argomenti senza virgolette — e questo progetto vive in "Script programmati". Un percorso con
 * uno spazio arriva spezzato in due, e l'errore che ne esce parla d'altro: `tsc` si lamenta di
 * "source files mixed with -p", PowerShell di un file "senza estensione .ps1". Ci sono inciampato
 * tre volte in un pomeriggio prima di rattoppare il punto giusto, cioè questo.
 */
const quote = (a) => (/[\s&|<>^]/.test(a) ? `"${a}"` : a);
const run = (cmd, args, cwd = ROOT) =>
  process.platform === 'win32'
    ? execFileSync(quote(cmd), args.map(quote), { cwd, stdio: 'inherit', shell: true })
    : execFileSync(cmd, args, { cwd, stdio: 'inherit' });

const step = (msg) => console.log(`\n▶ ${msg}`);

const LEGGIMI = [
  'House Finder',
  '=============',
  '',
  'Fai doppio click su HouseFinder.exe.',
  '',
  "Non si apre nessuna finestra: l'app vive in un'icona nell'area di notifica, in basso a",
  "destra vicino all'orologio (se non la vedi, clicca la freccetta che apre le icone nascoste).",
  'Da lì: click per aprirla nel browser, tasto destro per copiare l indirizzo o per uscire.',
  '',
  'Tutto si configura dentro l app, in Config:',
  '  - Email        la casella da cui arrivano gli avvisi dei portali',
  '  - Provider AI  la chiave del servizio che valuta gli annunci, e quale modello usare',
  '  - Gruppi FB    accesso a Facebook e gruppi da seguire',
  '  - App          aggiornamenti e installazione dei browser',
  '',
  'Aggiornamenti: Config > App > Aggiorna ora. Fa tutto da solo e si riavvia.',
  '',
  'I tuoi dati restano su questo computer:',
  '  state\\           annunci trovati, foto, log',
  '  app\\data\\local\\  la tua configurazione e le chiavi',
  'Un aggiornamento non li tocca mai.',
  '',
  'Se qualcosa non parte:',
  '  - il log e in state\\logs\\house-finder.log',
  '  - app\\avvio-con-console.bat avvia con la finestra visibile, per vedere gli errori subito',
  '',
  'Codice sorgente e licenza MIT: https://github.com/DiegoRiccardi1234/house-finder',
  '',
];

/** Il sorgente del lanciatore. Venti righe: avvia node nascosto e si toglie di mezzo. */
const LAUNCHER_CS = `using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

// Quello su cui l'utente fa doppio click. Non e' l'app: e' il bottone di accensione.
// Serve perche' un .vbs sembra uno script e sta in mezzo agli altri file, mentre un .exe con
// la sua icona e' l'unica cosa cliccabile della cartella - come TripFinder.exe e JobFinder.exe.
static class Launcher {
    [STAThread]
    static void Main() {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string node = Path.Combine(dir, "app", "node.exe");
        string serve = Path.Combine(dir, "app", "scripts", "serve.js");
        if (!File.Exists(node) || !File.Exists(serve)) {
            MessageBox.Show(
                "Installazione incompleta: manca la cartella app.\\n\\n" +
                "Estrai di nuovo l'archivio, tenendo insieme HouseFinder.exe e la cartella app.",
                "House Finder", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var psi = new ProcessStartInfo(node, "\\"" + serve + "\\" --tray --open");
        psi.WorkingDirectory = dir;   // state\\ e .env nascono qui, accanto all'eseguibile
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try {
            Process.Start(psi);
        } catch (Exception e) {
            MessageBox.Show("Non riesco ad avviare House Finder:\\n" + e.Message,
                "House Finder", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
`;

/** Disegna l'icona della casetta e la salva come .ico: nessun binario da versionare. */
const ICON_PS1 = `param([string]$Out)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$verde = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,74,107,82))
$bianco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillEllipse($verde, 0, 0, 63, 63)
$tetto = New-Object System.Drawing.Drawing2D.GraphicsPath
$tetto.AddPolygon(@((New-Object System.Drawing.Point 32,14),(New-Object System.Drawing.Point 52,32),(New-Object System.Drawing.Point 12,32)))
$g.FillPath($bianco, $tetto)
$g.FillRectangle($bianco, 20, 32, 24, 18)
$g.FillRectangle($verde, 28, 38, 8, 12)
$icona = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = [System.IO.File]::Create($Out)
$icona.Save($fs)
$fs.Close()
$g.Dispose(); $bmp.Dispose()
`;

/**
 * Costruisce `HouseFinder.exe` con il compilatore C# che sta dentro Windows.
 *
 * `csc.exe` fa parte del .NET Framework: c'e' su ogni Windows dal 4.0 in poi e sui runner di
 * GitHub. Non serve installare niente, e il risultato e' un eseguibile vero con la sua icona
 * invece di uno script che sembra un file di sistema.
 *
 * Se manca, si ripiega sul `.vbs`: un pacchetto meno bello e' meglio di nessun pacchetto.
 */
async function buildLauncher() {
  const csc = join(
    process.env.WINDIR ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const lavoro = join(DIST, 'launcher-src');
  await mkdir(lavoro, { recursive: true });
  const cs = join(lavoro, 'Launcher.cs');
  const ico = join(lavoro, 'app.ico');
  const ps1 = join(lavoro, 'icona.ps1');
  await writeFile(cs, LAUNCHER_CS, 'utf8');
  await writeFile(ps1, ICON_PS1, 'utf8');

  try {
    await stat(csc);
    run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Out', ico]);
    run(csc, [
      '/nologo',
      '/target:winexe',
      `/win32icon:${ico}`,
      '/reference:System.Windows.Forms.dll',
      `/out:${join(STAGE, 'HouseFinder.exe')}`,
      cs,
    ]);
    console.log('   HouseFinder.exe costruito');
  } catch (e) {
    console.warn(`   ⚠ compilatore C# non disponibile (${e.message}): ripiego sul .vbs`);
    await writeFile(
      join(STAGE, 'HouseFinder.vbs'),
      [
        'Set sh = CreateObject("WScript.Shell")',
        'Set fso = CreateObject("Scripting.FileSystemObject")',
        'sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)',
        'sh.Run "app\\node.exe app\\scripts\\serve.js --tray --open", 0, False',
        '',
      ].join('\r\n'),
    );
  } finally {
    await rm(lavoro, { recursive: true, force: true });
  }
}

async function main() {
  step('Pulizia dist/');
  await rm(DIST, { recursive: true, force: true });
  await mkdir(APP, { recursive: true });

  step('Compilazione TypeScript → app/');
  // `--outDir` esplicito: il `tsconfig.build.json` ne dichiara uno, e quando la cartella di stage
  // è stata rinominata i due sono andati a divergere in silenzio — `tsc` compilava nella vecchia e
  // lo zip usciva con node_modules ma senza una riga di codice nostro. Qui il percorso è uno solo.
  run('npx', ['tsc', '-p', 'tsconfig.build.json', '--outDir', APP_REL]);

  step('Build della UI');
  run('npm', ['run', 'ui:build']);
  await cp(join(ROOT, 'ui', 'dist'), join(APP, 'ui', 'dist'), { recursive: true });

  step('Copia della config di esempio');
  // Solo i file versionati: data/local/ è la config personale e non va nel bundle.
  await mkdir(join(APP, 'data'), { recursive: true });
  for (const f of ['criteria.md', 'searches.json', 'facebook.json']) {
    await cp(join(ROOT, 'data', f), join(APP, 'data', f));
  }
  // I quartieri già pronti: senza, la configurazione ricomincerebbe da un campo vuoto proprio
  // nel punto che quel campo vuoto doveva togliere.
  await cp(join(ROOT, 'data', 'zones'), join(APP, 'data', 'zones'), { recursive: true });

  // I .js emessi sono ESM: senza questo package.json Node li leggerebbe come CommonJS.
  await writeFile(join(APP, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

  step('Dipendenze di produzione (senza browser Playwright)');
  // `npm ci` pretende che package.json e lock combacino, devDependencies incluse: si copia il
  // manifest intero togliendo solo gli `scripts` (nessun hook deve girare qui) e si omette dev
  // in fase di install. Si installa in una cartella d'appoggio perché il manifest e il lock
  // servono a npm e basta: nel pacchetto finito non ci devono essere, sono roba da sviluppatore.
  const NPM = join(DIST, 'npm-work');
  await mkdir(NPM, { recursive: true });
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  delete pkg.scripts;
  await writeFile(join(NPM, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await cp(join(ROOT, 'package-lock.json'), join(NPM, 'package-lock.json'));
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], NPM);
  // `node_modules` dentro `app/`: Node lo risolve risalendo da `app/src/…`, quindi funziona
  // esattamente come prima, ma sparisce dalla vista di chi apre la cartella.
  await cp(join(NPM, 'node_modules'), join(APP, 'node_modules'), { recursive: true });
  await rm(NPM, { recursive: true, force: true });

  step(`Download di node.exe (v${NODE_VERSION})`);
  const res = await fetch(NODE_EXE_URL);
  if (!res.ok) throw new Error(`node.exe non scaricato: HTTP ${res.status} da ${NODE_EXE_URL}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(join(APP, 'node.exe')));

  step('Script non-TypeScript che tsc non copia');
  // `tsc` emette solo i .ts: il .ps1 della tray va portato a mano, con lo stesso percorso
  // relativo che ha nel repo (`src/server/tray.ts` lo cerca in `../../scripts/`).
  await mkdir(join(APP, 'scripts'), { recursive: true });
  await cp(join(ROOT, 'scripts', 'tray.ps1'), join(APP, 'scripts', 'tray.ps1'));

  step('Documenti (dentro app/: non sono roba da mostrare a chi apre la cartella)');
  for (const f of ['.env.example', 'README.md', 'LICENSE']) {
    await cp(join(ROOT, f), join(APP, f));
  }
  // Avvio con console: serve quando qualcosa non parte e si vuole vedere l'errore subito, invece
  // di andarlo a leggere in state\logs\house-finder.log. Sta dentro perché è diagnostica, non la
  // via normale — il LEGGIMI dice dov'è.
  await writeFile(
    join(APP, 'avvio-con-console.bat'),
    [
      '@echo off',
      'cd /d "%~dp0.."',
      'app\\node.exe app\\scripts\\serve.js --open',
      'pause',
      '',
    ].join('\r\n'),
  );

  step('Lanciatore');
  await buildLauncher();

  await writeFile(join(STAGE, 'LEGGIMI.txt'), LEGGIMI.join('\r\n'));

  step('Controllo che il pacchetto sia completo');
  // Uno zip che pesa giusto ma non contiene il codice si scopre solo quando qualcuno prova ad
  // aprirlo — cioè dopo la pubblicazione. È già successo: `tsc` compilava in una cartella e il
  // pacchetto si costruiva da un'altra. Meglio una build che fallisce di una release muta.
  for (const atteso of [
    ['app', 'node.exe'],
    ['app', 'scripts', 'serve.js'],
    ['app', 'scripts', 'updater.js'],
    ['app', 'scripts', 'tray.ps1'],
    ['app', 'src', 'version.js'],
    ['app', 'ui', 'dist', 'index.html'],
    ['app', 'data', 'zones', 'torino.json'],
    ['app', 'node_modules', 'express', 'package.json'],
    ['LEGGIMI.txt'],
  ]) {
    const p = join(STAGE, ...atteso);
    await stat(p).catch(() => {
      throw new Error(`Pacchetto incompleto: manca ${atteso.join('/')} — build interrotta.`);
    });
  }
  // Il lanciatore può essere l'exe o, se il compilatore C# manca, il .vbs di ripiego: uno dei due
  // però ci deve essere, altrimenti si spedisce una cartella che non si sa come accendere.
  const lanciatori = await Promise.all(
    ['HouseFinder.exe', 'HouseFinder.vbs'].map((f) =>
      stat(join(STAGE, f)).then(() => true).catch(() => false),
    ),
  );
  if (!lanciatori.some(Boolean)) throw new Error('Pacchetto senza lanciatore — build interrotta.');

  step('Creazione dello zip');
  const zip = join(DIST, 'HouseFinder-windows.zip');
  // La CARTELLA, non il suo contenuto: chi estrae si ritrova un `HouseFinder\` e non undici voci
  // sparse nella cartella dei download. L'aggiornatore scarta il livello in più da sé (`radice()`
  // in `scripts/updater.ts`), quindi il cambio non rompe gli aggiornamenti già installati.
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${STAGE}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
  ]);

  const { size } = await stat(zip);
  console.log(`\n✅ ${zip} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
