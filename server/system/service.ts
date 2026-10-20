import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServiceActionResultDTO, ServicePlanDTO, ServicePlatform, ServiceScope, ServiceStatusDTO } from '../../shared/system.ts';
import type { AppContext } from '../context.ts';
import { badRequest } from '../http/errors.ts';
import { appRoot, runningAsExecutable } from '../runtime.ts';
import { childCommand } from './supervisor.ts';

const run = promisify(execFile);
const SERVICE_NAME = 'FastBoard';
const UNIT_NAME = 'fastboard.service';
const LAUNCHD_LABEL = 'com.fastboard.server';

interface Command {
  file: string;
  args: string[];
}

interface Plan {
  scope: ServiceScope;
  files: Array<{ path: string; content: string; utf16?: boolean }>;
  install: Command[];
  uninstall: Command[];
  start: Command[];
  stop: Command[];
  /** Fichiers à supprimer à la désinstallation. */
  remove: string[];
}

export function currentPlatform(): ServicePlatform {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return 'macos';
  return 'other';
}

function quote(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function display(command: Command): string {
  return [command.file, ...command.args].map(quote).join(' ');
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Environnement repris dans le service : la même base, le même port et les mêmes réglages que le serveur courant. */
function serviceEnv(ctx: AppContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if ((key.startsWith('FASTBOARD_') && key !== 'FASTBOARD_SUPERVISED' && key !== 'FASTBOARD_NO_OPEN') || ['PORT', 'HOST', 'ALLOWED_ORIGINS'].includes(key)) {
      env[key] = value;
    }
  }
  env.FASTBOARD_DB = path.resolve(ctx.config.dbPath);
  env.PORT = String(ctx.config.port);
  if (!runningAsExecutable) env.NODE_ENV = 'production';
  env.FASTBOARD_NO_OPEN = '1';
  return Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
}

function dataDir(ctx: AppContext): string {
  return path.dirname(path.resolve(ctx.config.dbPath));
}

export function serviceLogFile(ctx: AppContext): string {
  return path.join(dataDir(ctx), 'service.log');
}

function pidFile(ctx: AppContext): string {
  return path.join(dataDir(ctx), 'service.pid');
}

function windowsPlan(ctx: AppContext, scope: ServiceScope): Plan {
  const dir = dataDir(ctx);
  const { file, args } = childCommand();
  const env = serviceEnv(ctx);
  const launcher = path.join(dir, 'fastboard-service.cmd');
  const hidden = path.join(dir, 'fastboard-service.vbs');
  const xmlFile = path.join(dir, 'fastboard-task.xml');
  const cmd = [
    '@echo off',
    'rem Lanceur du service FastBoard, généré par la page Administration > Installation.',
    `cd /d "${appRoot()}"`,
    ...Object.entries(env).map(([key, value]) => `set "${key}=${value}"`),
    `${[file, ...args].map((part) => `"${part}"`).join(' ')} --supervise`,
    '',
  ].join('\r\n');
  const vbs = `' Lance le service FastBoard sans fenêtre.\r\nCreateObject("WScript.Shell").Run """${launcher}""", 0, False\r\n`;
  const user = os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  const account = domain ? `${domain}\\${user}` : user;
  const action =
    scope === 'system'
      ? `<Exec><Command>${xmlEscape(launcher)}</Command><WorkingDirectory>${xmlEscape(appRoot())}</WorkingDirectory></Exec>`
      : `<Exec><Command>wscript.exe</Command><Arguments>${xmlEscape(`"${hidden}"`)}</Arguments><WorkingDirectory>${xmlEscape(appRoot())}</WorkingDirectory></Exec>`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>FastBoard : suivi de projet collaboratif (démarrage automatique et relance en arrière-plan).</Description>
  </RegistrationInfo>
  <Triggers>
    ${scope === 'system' ? '<BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger>' : `<LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(account)}</UserId></LogonTrigger>`}
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${scope === 'system' ? '<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>' : `<UserId>${xmlEscape(account)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>`}
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    ${action}
  </Actions>
</Task>
`;
  const files = [
    { path: launcher, content: cmd },
    ...(scope === 'user' ? [{ path: hidden, content: vbs }] : []),
    { path: xmlFile, content: xml, utf16: true },
  ];
  const pid = pidFile(ctx);
  // Le PID du superviseur permet d'arrêter le service et son serveur (arbre de processus).
  const stop: Command = { file: 'cmd.exe', args: ['/d', '/c', `if exist "${pid}" (for /f %p in ('type "${pid}"') do taskkill /PID %p /T /F)`] };
  return {
    scope,
    files,
    install: [{ file: 'schtasks.exe', args: ['/Create', '/TN', SERVICE_NAME, '/XML', xmlFile, '/F'] }],
    uninstall: [stop, { file: 'schtasks.exe', args: ['/Delete', '/TN', SERVICE_NAME, '/F'] }],
    start: [{ file: 'schtasks.exe', args: ['/Run', '/TN', SERVICE_NAME] }],
    stop: [stop],
    remove: [...files.map((entry) => entry.path), pid],
  };
}

function linuxPlan(ctx: AppContext, scope: ServiceScope): Plan {
  const { file, args } = childCommand();
  const env = serviceEnv(ctx);
  const unitPath = scope === 'system' ? `/etc/systemd/system/${UNIT_NAME}` : path.join(os.homedir(), '.config', 'systemd', 'user', UNIT_NAME);
  const unit = `[Unit]
Description=FastBoard (suivi de projet collaboratif)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${appRoot()}
ExecStart=${[file, ...args].map(quote).join(' ')}
${Object.entries(env).map(([key, value]) => `Environment="${key}=${value.replace(/"/g, '\\"')}"`).join('\n')}
Restart=always
RestartSec=5
${scope === 'system' ? `User=${os.userInfo().username}\n` : ''}
[Install]
WantedBy=${scope === 'system' ? 'multi-user.target' : 'default.target'}
`;
  const systemctl = (...rest: string[]): Command => ({ file: 'systemctl', args: scope === 'user' ? ['--user', ...rest] : rest });
  return {
    scope,
    files: [{ path: unitPath, content: unit }],
    install: [
      systemctl('daemon-reload'),
      systemctl('enable', UNIT_NAME),
      ...(scope === 'user' ? [{ file: 'loginctl', args: ['enable-linger', os.userInfo().username] }] : []),
    ],
    uninstall: [systemctl('disable', '--now', UNIT_NAME)],
    start: [systemctl('start', UNIT_NAME)],
    stop: [systemctl('stop', UNIT_NAME)],
    remove: [unitPath],
  };
}

function macPlan(ctx: AppContext, scope: ServiceScope): Plan {
  const { file, args } = childCommand();
  const env = serviceEnv(ctx);
  const plistPath = scope === 'system' ? `/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist` : path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const log = serviceLogFile(ctx);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[file, ...args].map((part) => `    <string>${xmlEscape(part)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(appRoot())}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${xmlEscape(key)}</key><string>${xmlEscape(value)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(log)}</string>
</dict>
</plist>
`;
  return {
    scope,
    files: [{ path: plistPath, content: plist }],
    install: [{ file: 'launchctl', args: ['load', '-w', plistPath] }],
    uninstall: [{ file: 'launchctl', args: ['unload', '-w', plistPath] }],
    start: [{ file: 'launchctl', args: ['start', LAUNCHD_LABEL] }],
    stop: [{ file: 'launchctl', args: ['stop', LAUNCHD_LABEL] }],
    remove: [plistPath],
  };
}

function planFor(ctx: AppContext, scope: ServiceScope): Plan | null {
  switch (currentPlatform()) {
    case 'windows':
      return windowsPlan(ctx, scope);
    case 'linux':
      return linuxPlan(ctx, scope);
    case 'macos':
      return macPlan(ctx, scope);
    default:
      return null;
  }
}

function toPlanDTO(plan: Plan): ServicePlanDTO {
  return {
    scope: plan.scope,
    files: plan.files.map((entry) => ({ path: entry.path, content: entry.content })),
    install: plan.install.map(display),
    uninstall: [...plan.uninstall.map(display), ...plan.remove.map((file) => (currentPlatform() === 'windows' ? `del ${quote(file)}` : `rm -f ${quote(file)}`))],
    start: plan.start.map(display),
    stop: plan.stop.map(display),
  };
}

async function tryRun(command: Command): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await run(command.file, command.args, { timeout: 30_000, windowsHide: true, windowsVerbatimArguments: command.file === 'cmd.exe' });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() || failure.message };
  }
}

let elevatedCache: boolean | null = null;

async function isElevated(): Promise<boolean> {
  if (elevatedCache !== null) return elevatedCache;
  if (process.platform === 'win32') {
    elevatedCache = (await tryRun({ file: 'net.exe', args: ['session'] })).ok;
  } else {
    elevatedCache = process.getuid?.() === 0;
  }
  return elevatedCache;
}

async function detect(): Promise<{ installed: boolean; scope: ServiceScope | null; state: string | null }> {
  switch (currentPlatform()) {
    case 'windows': {
      const query = await tryRun({ file: 'schtasks.exe', args: ['/Query', '/TN', SERVICE_NAME, '/XML'] });
      if (!query.ok) return { installed: false, scope: null, state: null };
      const csv = await tryRun({ file: 'schtasks.exe', args: ['/Query', '/TN', SERVICE_NAME, '/FO', 'CSV', '/NH'] });
      const state = csv.ok ? (csv.output.split('\n')[0]?.split('","')[2]?.replace(/"/g, '').trim() ?? null) : null;
      return { installed: true, scope: query.output.includes('BootTrigger') ? 'system' : 'user', state };
    }
    case 'linux': {
      for (const scope of ['system', 'user'] as const) {
        const prefix = scope === 'user' ? ['--user'] : [];
        const enabled = await tryRun({ file: 'systemctl', args: [...prefix, 'is-enabled', UNIT_NAME] });
        if (enabled.ok) {
          const active = await tryRun({ file: 'systemctl', args: [...prefix, 'is-active', UNIT_NAME] });
          return { installed: true, scope, state: active.output || null };
        }
      }
      return { installed: false, scope: null, state: null };
    }
    case 'macos': {
      const system = fs.existsSync(`/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist`);
      const user = fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`));
      if (!system && !user) return { installed: false, scope: null, state: null };
      const listed = await tryRun({ file: 'launchctl', args: ['list', LAUNCHD_LABEL] });
      return { installed: true, scope: system ? 'system' : 'user', state: listed.ok ? 'loaded' : 'not loaded' };
    }
    default:
      return { installed: false, scope: null, state: null };
  }
}

export async function serviceStatus(ctx: AppContext): Promise<ServiceStatusDTO> {
  const platform = currentPlatform();
  const { file, args } = childCommand();
  const detected = await detect();
  const warnings: string[] = [];
  if (!runningAsExecutable) {
    warnings.push("Le service lancera Node avec les sources du projet : l'exécutable autonome (npm run build:exe) est recommandé.");
    if (!fs.existsSync(path.join(ctx.config.distDir, 'index.html'))) {
      warnings.push("L'interface n'est pas construite (dossier dist/ absent) : lancez « npm run build » avant de démarrer le service.");
    }
  }
  if (process.env.FASTBOARD_SUPERVISED !== '1') {
    warnings.push(`Le service utilisera le port ${ctx.config.port}, déjà utilisé par ce serveur : arrêtez cette instance avant de démarrer le service.`);
  }
  const plans = (['user', 'system'] as const).map((scope) => planFor(ctx, scope)).filter((plan): plan is Plan => plan !== null);
  return {
    platform,
    supported: plans.length > 0,
    name: platform === 'linux' ? UNIT_NAME : platform === 'macos' ? LAUNCHD_LABEL : SERVICE_NAME,
    installed: detected.installed,
    installedScope: detected.scope,
    state: detected.state,
    elevated: await isElevated(),
    supervised: process.env.FASTBOARD_SUPERVISED === '1',
    runningAsExecutable,
    command: [file, ...args].map(quote).join(' '),
    env: serviceEnv(ctx),
    logFile: serviceLogFile(ctx),
    warnings,
    plans: plans.map(toPlanDTO),
  };
}

export type ServiceAction = 'install' | 'uninstall' | 'start' | 'stop';

/** Exécute une action sur le service ; `dryRun` retourne seulement ce qui serait fait. */
export async function serviceAction(ctx: AppContext, action: ServiceAction, scope: ServiceScope, dryRun: boolean): Promise<ServiceActionResultDTO> {
  const plan = planFor(ctx, scope);
  if (!plan) {
    throw badRequest("L'installation en tant que service n'est pas prise en charge sur ce système.");
  }
  const commands = plan[action];
  const lines: string[] = [];
  let ok = true;
  if (!dryRun) {
    if (action === 'install') {
      for (const entry of plan.files) {
        try {
          fs.mkdirSync(path.dirname(entry.path), { recursive: true });
          fs.writeFileSync(entry.path, entry.utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(entry.content, 'utf16le')]) : entry.content);
          lines.push(`✓ ${entry.path}`);
        } catch (error) {
          ok = false;
          lines.push(`✗ ${entry.path} : ${(error as Error).message}`);
        }
      }
    }
    for (const command of ok ? commands : []) {
      const result = await tryRun(command);
      lines.push(`${result.ok ? '✓' : '✗'} ${display(command)}${result.output ? `\n${result.output}` : ''}`);
      // Arrêter un service déjà arrêté n'est pas une erreur.
      if (!result.ok && !(action === 'uninstall' && command === commands[0])) {
        ok = false;
        break;
      }
    }
    if (action === 'uninstall' && ok) {
      for (const file of plan.remove) fs.rmSync(file, { force: true });
    }
    ctx.logger.info('service', `Service : ${action} (${scope}) ${ok ? 'réussi' : 'en échec'}`, { output: lines.join('\n').slice(0, 2000) });
  }
  return { ok, dryRun, commands: commands.map(display), output: lines.join('\n'), status: await serviceStatus(ctx) };
}

/** Écrit le PID du superviseur (mode service) pour pouvoir l'arrêter depuis l'administration. */
export function writeSupervisorPid(dbPath: string): void {
  try {
    fs.writeFileSync(path.join(path.dirname(path.resolve(dbPath)), 'service.pid'), String(process.pid));
  } catch {
    // Sans fichier PID, l'arrêt se fait depuis le gestionnaire de services du système.
  }
}
