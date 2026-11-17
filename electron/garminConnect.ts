import { app, BrowserWindow, session, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const GARMIN_PARTITION = 'persist:garmin';
const GARMIN_BASE_URL = 'https://connect.garmin.com/';
const GARMIN_SIGNIN_URL = 'https://connect.garmin.com/signin';
const GARMIN_HOME_URL = 'https://connect.garmin.com/app/home';
const UPLOAD_TIMEOUT_MS = 25_000;
const CSRF_WAIT_MAX_MS = 4_000;

let cachedCsrfToken: string | null = null;
let csrfListenerInstalled = false;

export interface GarminStatus {
  connected: boolean;
  displayName?: string;
  lastVerifiedAt?: string;
}

export interface GarminLoginResult {
  ok: boolean;
  connected: boolean;
  displayName?: string;
  error?: string;
}

export interface GarminUploadOptions {
  fileName: string;
  fitBase64?: string;
  tcxContent: string;
  workoutName?: string;
}

export interface GarminUploadResult {
  ok: boolean;
  activityId?: string | number;
  activityUrl?: string;
  duplicate?: boolean;
  needsRelogin?: boolean;
  error?: string;
}

function ensureCsrfListener(): void {
  if (csrfListenerInstalled) return;
  csrfListenerInstalled = true;

  const garminSession = session.fromPartition(GARMIN_PARTITION);
  garminSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://connect.garmin.com/gc-api/*'] },
    (details, callback) => {
      for (const [key, value] of Object.entries(details.requestHeaders)) {
        if (
          key.toLowerCase() === 'connect-csrf-token' &&
          typeof value === 'string' &&
          value.trim().length > 0
        ) {
          cachedCsrfToken = value.trim();
          break;
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function getAuthMetadataPath(): string {
  return path.join(app.getPath('userData'), 'garmin-auth.json');
}

function readAuthMetadata(): GarminStatus {
  const filePath = getAuthMetadataPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw) as Partial<GarminStatus>;
        return {
          connected: Boolean(parsed.connected),
          displayName:
            typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
          lastVerifiedAt:
            typeof parsed.lastVerifiedAt === 'string' ? parsed.lastVerifiedAt : undefined,
        };
      }
    }
  } catch (err) {
    console.warn('[GarminConnect] Error reading garmin-auth.json:', err);
  }
  return { connected: false };
}

function writeAuthMetadata(meta: GarminStatus): void {
  const filePath = getAuthMetadataPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf8');
  } catch (err) {
    console.error('[GarminConnect] Error writing garmin-auth.json:', err);
  }
}

function isAuthenticatedGarminUrl(url: string): boolean {
  if (!url.startsWith(GARMIN_BASE_URL)) return false;
  if (url.includes('/signin')) return false;
  if (url.includes('sso.garmin.com')) return false;
  return true;
}

function isSignInOrSsoUrl(url: string): boolean {
  return url.includes('/signin') || url.includes('sso.garmin.com');
}

async function hasSessionCookies(requireJwtOrSession = false): Promise<boolean> {
  try {
    const garminSession = session.fromPartition(GARMIN_PARTITION);
    const cookies = await garminSession.cookies.get({ domain: 'garmin.com' });
    return cookies.some((c) => {
      if (c.name === 'JWT_WEB' || c.name === 'session') return true;
      if (!requireJwtOrSession && c.name.startsWith('GARMIN-SSO')) return true;
      return false;
    });
  } catch (err) {
    console.warn('[GarminConnect] Error checking session cookies:', err);
    return false;
  }
}

export async function garminGetStatus(): Promise<GarminStatus> {
  const meta = readAuthMetadata();
  const hasCookies = await hasSessionCookies(false);

  if (hasCookies) {
    return {
      connected: true,
      displayName: meta.displayName,
      lastVerifiedAt: meta.lastVerifiedAt,
    };
  }

  return { connected: false };
}

export async function garminLogin(
  parentWindow: BrowserWindow | null
): Promise<GarminLoginResult> {
  ensureCsrfListener();

  return new Promise((resolve) => {
    let settled = false;
    let verifying = false;
    let attemptsWithCookie = 0;
    let pollTimer: NodeJS.Timeout | null = null;

    const loginWin = new BrowserWindow({
      width: 520,
      height: 740,
      parent: parentWindow ?? undefined,
      autoHideMenuBar: true,
      title: 'Iniciar sesión en Garmin Connect',
      webPreferences: {
        partition: GARMIN_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const finish = (result: GarminLoginResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!loginWin.isDestroyed()) {
        loginWin.close();
      }
      resolve(result);
    };

    const tryVerifySession = async (currentUrl?: string) => {
      if (settled || verifying || loginWin.isDestroyed()) return;

      const url = currentUrl || loginWin.webContents.getURL();
      if (!isAuthenticatedGarminUrl(url)) return;

      verifying = true;
      try {
        const hasCookie = await hasSessionCookies(true);
        if (!hasCookie) {
          return;
        }

        attemptsWithCookie += 1;
        const csrfJson = JSON.stringify(cachedCsrfToken ?? '');

        const profile = (await loginWin.webContents.executeJavaScript(`
          (async () => {
            try {
              const metaCsrf =
                document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
              const csrfToken = ${csrfJson} || metaCsrf;

              const headers = {
                'NK': 'NT',
                'X-Requested-With': 'XMLHttpRequest',
                ...(csrfToken ? { 'Connect-Csrf-Token': csrfToken } : {}),
              };

              let res = await fetch('/gc-api/userprofile-service/socialProfile', {
                method: 'GET',
                headers,
                credentials: 'include',
              });

              if (res.status === 404) {
                res = await fetch('/modern/proxy/userprofile-service/socialProfile', {
                  method: 'GET',
                  headers,
                  credentials: 'include',
                });
              }

              if (!res.ok) {
                return { ok: false, status: res.status };
              }

              const data = await res.json();
              const displayName =
                data?.displayName || data?.fullName || data?.userName || undefined;
              return { ok: true, displayName };
            } catch (e) {
              return { ok: false, error: String(e) };
            }
          })();
        `)) as { ok: boolean; displayName?: string };

        if (settled) return;

        if (profile?.ok) {
          const meta: GarminStatus = {
            connected: true,
            displayName: profile.displayName,
            lastVerifiedAt: new Date().toISOString(),
          };
          writeAuthMetadata(meta);
          finish({
            ok: true,
            connected: true,
            displayName: profile.displayName,
          });
          return;
        }

        // If JWT_WEB/session cookie exists and we are on connect.garmin.com/app,
        // wait at least one tick for Connect-Csrf-Token; after 2 attempts finalize anyway.
        if (attemptsWithCookie >= 2 && url.includes('connect.garmin.com/app')) {
          const meta: GarminStatus = {
            connected: true,
            lastVerifiedAt: new Date().toISOString(),
          };
          writeAuthMetadata(meta);
          finish({
            ok: true,
            connected: true,
          });
        }
      } catch (err) {
        console.debug('[GarminConnect] Session verify attempt failed:', err);
      } finally {
        verifying = false;
      }
    };

    loginWin.webContents.on('did-navigate', (_event, url) => {
      void tryVerifySession(url);
    });

    loginWin.webContents.on('did-navigate-in-page', (_event, url) => {
      void tryVerifySession(url);
    });

    pollTimer = setInterval(() => {
      void tryVerifySession();
    }, 1200);

    loginWin.on('closed', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          ok: false,
          connected: false,
          error: 'Inicio de sesión cancelado.',
        });
      }
    });

    void loginWin.loadURL(GARMIN_SIGNIN_URL);
  });
}

export async function garminLogout(): Promise<void> {
  cachedCsrfToken = null;
  try {
    const garminSession = session.fromPartition(GARMIN_PARTITION);
    await garminSession.clearStorageData();
  } catch (err) {
    console.warn('[GarminConnect] Error clearing partition storage:', err);
  }
  writeAuthMetadata({ connected: false });
}

async function waitForCsrfToken(win: BrowserWindow): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < CSRF_WAIT_MAX_MS) {
    if (cachedCsrfToken) {
      return cachedCsrfToken;
    }
    if (!win.isDestroyed()) {
      try {
        const metaToken = (await win.webContents.executeJavaScript(
          `document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''`
        )) as string;
        if (metaToken) {
          cachedCsrfToken = metaToken;
          return metaToken;
        }
      } catch {
        // Ignore transient execution errors while page scripts settle
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return cachedCsrfToken ?? '';
}

export async function garminUploadActivity(
  options: GarminUploadOptions
): Promise<GarminUploadResult> {
  ensureCsrfListener();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: GARMIN_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const runUpload = async (): Promise<GarminUploadResult> => {
    await win.loadURL(GARMIN_HOME_URL);

    const currentUrl = win.webContents.getURL();
    if (isSignInOrSsoUrl(currentUrl)) {
      writeAuthMetadata({ connected: false });
      return {
        ok: false,
        needsRelogin: true,
        error: 'Tu sesión de Garmin Connect ha caducado. Vuelve a iniciar sesión.',
      };
    }

    const csrfToken = await waitForCsrfToken(win);

    const payload = JSON.stringify({
      fileName: options.fileName,
      fitBase64: options.fitBase64 ?? '',
      tcxContent: options.tcxContent ?? '',
      workoutName: options.workoutName ?? '',
      csrfToken,
    });

    const result = (await win.webContents.executeJavaScript(`
      (async () => {
        const opts = ${payload};
        const metaCsrf =
          document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        const effectiveCsrf = opts.csrfToken || metaCsrf;

        const baseHeaders = {
          'NK': 'NT',
          'X-Requested-With': 'XMLHttpRequest',
          ...(effectiveCsrf ? { 'Connect-Csrf-Token': effectiveCsrf } : {}),
        };

        const ensureExt = (name, ext) => {
          const clean = (name || 'activity').replace(/\\.(fit|tcx)$/i, '');
          return clean + '.' + ext;
        };

        const buildFormData = (ext) => {
          const fd = new FormData();
          if (ext === 'fit') {
            const bin = atob(opts.fitBase64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
              bytes[i] = bin.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/octet-stream' });
            fd.append('file', blob, ensureExt(opts.fileName, 'fit'));
          } else {
            const blob = new Blob([opts.tcxContent], {
              type: 'application/vnd.garmin.tcx+xml',
            });
            fd.append('file', blob, ensureExt(opts.fileName, 'tcx'));
          }
          return fd;
        };

        const postUpload = async (ext) => {
          const primaryUrl = '/gc-api/upload-service/upload/.' + ext;
          const fallbackUrl = '/modern/proxy/upload-service/upload/.' + ext;

          let res = await fetch(primaryUrl, {
            method: 'POST',
            headers: baseHeaders,
            body: buildFormData(ext),
            credentials: 'include',
          });

          if (res.status === 404) {
            res = await fetch(fallbackUrl, {
              method: 'POST',
              headers: baseHeaders,
              body: buildFormData(ext),
              credentials: 'include',
            });
          }

          let data = null;
          try {
            data = await res.json();
          } catch {
            data = null;
          }
          return { status: res.status, ok: res.ok, data };
        };

        let uploadRes = null;
        if (opts.fitBase64) {
          uploadRes = await postUpload('fit');
          if (
            (uploadRes.status === 400 ||
              uploadRes.status === 422 ||
              uploadRes.status === 500) &&
            opts.tcxContent
          ) {
            uploadRes = await postUpload('tcx');
          }
        } else if (opts.tcxContent) {
          uploadRes = await postUpload('tcx');
        } else {
          return { ok: false, error: 'No hay contenido de actividad (.fit o .tcx) para subir.' };
        }

        if (uploadRes.status === 401 || uploadRes.status === 403) {
          return {
            ok: false,
            needsRelogin: true,
            error: 'Sesión expirada en Garmin Connect.',
          };
        }

        const importResult = uploadRes.data?.detailedImportResult;
        const firstSuccess = importResult?.successes?.[0];
        const firstFailure = importResult?.failures?.[0];
        const failureMsg =
          firstFailure?.messages?.[0]?.content ||
          firstFailure?.messages?.[0]?.message ||
          '';
        const failureCode = firstFailure?.messages?.[0]?.code;

        const isDuplicate =
          uploadRes.status === 409 ||
          failureCode === 202 ||
          /duplicate/i.test(String(failureMsg));

        const activityId =
          firstSuccess?.internalId ?? firstFailure?.internalId ?? undefined;
        const activityUrl = activityId
          ? 'https://connect.garmin.com/modern/activity/' + activityId
          : 'https://connect.garmin.com/modern/activities';

        if (isDuplicate) {
          return {
            ok: true,
            duplicate: true,
            activityId,
            activityUrl,
          };
        }

        if (!uploadRes.ok) {
          return {
            ok: false,
            error:
              failureMsg ||
              uploadRes.data?.message ||
              'Error al subir la actividad (HTTP ' + uploadRes.status + ').',
          };
        }

        if (opts.workoutName && activityId) {
          try {
            const renameBody = JSON.stringify({
              activityId,
              activityName: opts.workoutName,
            });
            const renameHeaders = {
              ...baseHeaders,
              'Content-Type': 'application/json',
            };
            let renameRes = await fetch(
              '/gc-api/activity-service/activity/' + activityId,
              {
                method: 'PUT',
                headers: renameHeaders,
                body: renameBody,
                credentials: 'include',
              }
            );
            if (renameRes.status === 404) {
              await fetch('/modern/proxy/activity-service/activity/' + activityId, {
                method: 'PUT',
                headers: renameHeaders,
                body: renameBody,
                credentials: 'include',
              });
            }
          } catch {
            // Best-effort rename
          }
        }

        return {
          ok: true,
          activityId,
          activityUrl,
        };
      })();
    `)) as GarminUploadResult;

    if (result?.needsRelogin) {
      writeAuthMetadata({ connected: false });
    }

    return result;
  };

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<GarminUploadResult>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        error: 'Tiempo de espera agotado al conectar con Garmin Connect.',
      });
    }, UPLOAD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([runUpload(), timeoutPromise]);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Error inesperado al subir la actividad a Garmin Connect.',
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
}

export async function openExternalGarminUrl(url: string): Promise<void> {
  if (typeof url === 'string' && url.startsWith(GARMIN_BASE_URL)) {
    await shell.openExternal(url);
  }
}
