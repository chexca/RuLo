import { app, BrowserWindow, session, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const STRAVA_PARTITION = 'persist:strava';
const STRAVA_BASE_URL = 'https://www.strava.com/';
const STRAVA_LOGIN_URL = 'https://www.strava.com/login';
const STRAVA_UPLOAD_SELECT_URL = 'https://www.strava.com/upload/select';
const STRAVA_UPLOAD_FILES_URL = 'https://www.strava.com/upload/files';
const STRAVA_UPLOAD_PROGRESS_URL = 'https://www.strava.com/upload/progress.json';
const UPLOAD_TIMEOUT_MS = 30_000;
const PROGRESS_MAX_ATTEMPTS = 8;
const PROGRESS_POLL_INTERVAL_MS = 1_000;

export interface StravaStatus {
  connected: boolean;
  displayName?: string;
  lastVerifiedAt?: string;
}

export interface StravaLoginResult {
  ok: boolean;
  connected: boolean;
  displayName?: string;
  error?: string;
}

export interface StravaUploadOptions {
  fileName: string;
  fitBase64?: string;
  tcxContent: string;
  workoutName?: string;
}

export interface StravaUploadResult {
  ok: boolean;
  activityId?: string | number;
  activityUrl?: string;
  duplicate?: boolean;
  needsRelogin?: boolean;
  error?: string;
}

function getAuthMetadataPath(): string {
  return path.join(app.getPath('userData'), 'strava-auth.json');
}

function readAuthMetadata(): StravaStatus {
  const filePath = getAuthMetadataPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw) as Partial<StravaStatus>;
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
    console.warn('[StravaConnect] Error reading strava-auth.json:', err);
  }
  return { connected: false };
}

function writeAuthMetadata(meta: StravaStatus): void {
  const filePath = getAuthMetadataPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2), 'utf8');
  } catch (err) {
    console.error('[StravaConnect] Error writing strava-auth.json:', err);
  }
}

function isAuthenticatedStravaUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('strava.com')) return false;
    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname.startsWith('/login') ||
      pathname.startsWith('/session') ||
      pathname.startsWith('/register') ||
      pathname.startsWith('/account/recover')
    ) {
      return false;
    }
    return (
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/athletes/') ||
      pathname.startsWith('/onboarding') ||
      pathname.startsWith('/upload/select') ||
      pathname.startsWith('/athlete/')
    );
  } catch {
    return false;
  }
}

function isLoginUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.startsWith('/login') || pathname.startsWith('/session');
  } catch {
    return url.includes('/login') || url.includes('/session');
  }
}

async function hasSessionCookies(): Promise<boolean> {
  try {
    const stravaSession = session.fromPartition(STRAVA_PARTITION);
    const cookies = await stravaSession.cookies.get({ domain: 'strava.com' });
    return cookies.some(
      (c) =>
        c.name === '_strava4_session' ||
        c.name === 'strava_remember_token' ||
        c.name === 'strava_remember_id'
    );
  } catch (err) {
    console.warn('[StravaConnect] Error checking session cookies:', err);
    return false;
  }
}

export async function stravaGetStatus(): Promise<StravaStatus> {
  const meta = readAuthMetadata();
  const hasCookies = await hasSessionCookies();

  if (meta.connected && hasCookies) {
    return {
      connected: true,
      displayName: meta.displayName,
      lastVerifiedAt: meta.lastVerifiedAt,
    };
  }

  if (hasCookies) {
    return {
      connected: true,
      displayName: meta.displayName,
      lastVerifiedAt: meta.lastVerifiedAt,
    };
  }

  return { connected: false };
}

export async function stravaLogin(
  parentWindow: BrowserWindow | null
): Promise<StravaLoginResult> {
  return new Promise((resolve) => {
    let settled = false;
    let verifying = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const loginWin = new BrowserWindow({
      width: 520,
      height: 740,
      parent: parentWindow ?? undefined,
      autoHideMenuBar: true,
      title: 'Iniciar sesión en Strava',
      webPreferences: {
        partition: STRAVA_PARTITION,
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

    const finish = (result: StravaLoginResult) => {
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
      if (!isAuthenticatedStravaUrl(url)) return;

      verifying = true;
      try {
        const hasCookie = await hasSessionCookies();
        if (!hasCookie) {
          return;
        }

        let displayName: string | undefined;
        try {
          const extracted = (await loginWin.webContents.executeJavaScript(`
            (() => {
              try {
                const selectors = [
                  '[data-testid="athlete-name"]',
                  '.athlete-name',
                  '.user-nav .avatar img[alt]',
                  '.nav-item.drop-down-menu img.avatar[alt]',
                  'img.avatar-img[alt]',
                  'a[href^="/athletes/"] .athlete-name',
                ];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (!el) continue;
                  const text = (el.getAttribute('alt') || el.textContent || '').trim();
                  if (text && text.length > 1 && text.length < 80) {
                    return text;
                  }
                }
                const reactNode = document.querySelector('[data-react-class][data-react-props]');
                const reactProps = reactNode ? reactNode.getAttribute('data-react-props') : null;
                if (reactProps) {
                  const parsed = JSON.parse(reactProps);
                  const name =
                    parsed?.currentAthlete?.display_name ||
                    parsed?.currentAthlete?.name ||
                    parsed?.athlete?.display_name ||
                    parsed?.athlete?.name;
                  if (typeof name === 'string' && name.trim()) {
                    return name.trim();
                  }
                }
                return undefined;
              } catch {
                return undefined;
              }
            })();
          `)) as string | undefined;

          if (typeof extracted === 'string' && extracted.trim().length > 0) {
            displayName = extracted.trim();
          }
        } catch {
          // Ignore DOM extraction errors
        }

        if (settled) return;

        const meta: StravaStatus = {
          connected: true,
          displayName,
          lastVerifiedAt: new Date().toISOString(),
        };
        writeAuthMetadata(meta);
        finish({
          ok: true,
          connected: true,
          displayName,
        });
      } catch (err) {
        console.debug('[StravaConnect] Session verify attempt failed:', err);
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

    loginWin.webContents.on('did-finish-load', () => {
      void tryVerifySession();
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

    void loginWin.loadURL(STRAVA_LOGIN_URL);
  });
}

export async function stravaLogout(): Promise<void> {
  try {
    const stravaSession = session.fromPartition(STRAVA_PARTITION);
    await stravaSession.clearStorageData();
  } catch (err) {
    console.warn('[StravaConnect] Error clearing partition storage:', err);
  }
  writeAuthMetadata({ connected: false });
}

function extractTokensFromHtml(html: string): {
  csrfToken: string;
  authenticityToken: string;
} {
  const metaMatch =
    html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);

  const inputMatch =
    html.match(/<input[^>]+name=["']authenticity_token["'][^>]+value=["']([^"']+)["']/i) ||
    html.match(/<input[^>]+value=["']([^"']+)["'][^>]+name=["']authenticity_token["']/i);

  const csrfToken = (metaMatch?.[1] || inputMatch?.[1] || '').trim();
  const authenticityToken = (inputMatch?.[1] || metaMatch?.[1] || '').trim();
  return { csrfToken, authenticityToken };
}

function ensureExtension(fileName: string, ext: 'fit' | 'tcx'): string {
  const clean = (fileName || 'activity').replace(/\.(fit|tcx)$/i, '');
  return `${clean}.${ext}`;
}

function buildMultipartFormData(
  fields: Array<{ name: string; value: string }>,
  file: {
    fieldName: string;
    fileName: string;
    contentType: string;
    data: Buffer;
  }
): { body: BodyInit; contentType: string } {
  const boundary =
    '----StravaBoundary' +
    Date.now().toString(16) +
    Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];

  for (const field of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
        'utf8'
      )
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    )
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(parts) as unknown as BodyInit,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

interface ParsedStravaUploadEntry {
  uploadId?: string | number;
  activityId?: string | number;
  error?: string;
  status?: string;
  duplicate?: boolean;
}

function parseUploadEntry(raw: unknown): ParsedStravaUploadEntry {
  if (!raw) return {};

  let entry: Record<string, unknown> | null = null;
  if (Array.isArray(raw)) {
    entry = (raw[0] as Record<string, unknown>) ?? null;
  } else if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.progress) && obj.progress.length > 0) {
      entry = obj.progress[0] as Record<string, unknown>;
    } else if (Array.isArray(obj.uploads) && obj.uploads.length > 0) {
      entry = obj.uploads[0] as Record<string, unknown>;
    } else {
      entry = obj;
    }
  }

  if (!entry) return {};

  const uploadId =
    (entry.id as string | number | undefined) ??
    (entry.upload_id as string | number | undefined);
  let activityId =
    (entry.activity_id as string | number | undefined) ??
    (entry.activityId as string | number | undefined);

  const errorStr =
    typeof entry.error === 'string'
      ? entry.error
      : typeof entry.message === 'string'
        ? entry.message
        : undefined;
  const statusStr = typeof entry.status === 'string' ? entry.status : undefined;

  const combinedText = `${errorStr ?? ''} ${statusStr ?? ''}`;
  const isDuplicate = /duplicate/i.test(combinedText);

  if (!activityId && isDuplicate) {
    const dupMatch =
      combinedText.match(/\/activities\/(\d+)/i) ||
      combinedText.match(/duplicate of (?:activity )?(\d+)/i);
    if (dupMatch?.[1]) {
      activityId = dupMatch[1];
    }
  }

  return {
    uploadId,
    activityId,
    error: errorStr,
    status: statusStr,
    duplicate: isDuplicate,
  };
}

export async function stravaUploadActivity(
  options: StravaUploadOptions
): Promise<StravaUploadResult> {
  const stravaSession = session.fromPartition(STRAVA_PARTITION);

  const runUpload = async (): Promise<StravaUploadResult> => {
    const selectRes = await stravaSession.fetch(STRAVA_UPLOAD_SELECT_URL, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (
      selectRes.status === 401 ||
      selectRes.status === 403 ||
      isLoginUrl(selectRes.url)
    ) {
      writeAuthMetadata({ connected: false });
      return {
        ok: false,
        needsRelogin: true,
        error: 'Tu sesión de Strava ha caducado. Vuelve a iniciar sesión.',
      };
    }

    const html = await selectRes.text();
    if (
      (/action=["']\/session["']/i.test(html) || /id=["']login_form["']/i.test(html)) &&
      !/\/upload\/files/i.test(html)
    ) {
      writeAuthMetadata({ connected: false });
      return {
        ok: false,
        needsRelogin: true,
        error: 'Tu sesión de Strava ha caducado. Vuelve a iniciar sesión.',
      };
    }

    const { csrfToken, authenticityToken } = extractTokensFromHtml(html);
    if (!csrfToken && !authenticityToken) {
      writeAuthMetadata({ connected: false });
      return {
        ok: false,
        needsRelogin: true,
        error: 'No se pudo obtener el token CSRF de Strava. Vuelve a iniciar sesión.',
      };
    }

    const postSingleFile = async (ext: 'fit' | 'tcx') => {
      const fileData =
        ext === 'fit' && options.fitBase64
          ? Buffer.from(options.fitBase64, 'base64')
          : Buffer.from(options.tcxContent, 'utf8');

      const contentType =
        ext === 'fit' ? 'application/octet-stream' : 'application/vnd.garmin.tcx+xml';

      const fields: Array<{ name: string; value: string }> = [
        { name: '_method', value: 'post' },
        { name: 'authenticity_token', value: authenticityToken || csrfToken },
      ];

      const { body, contentType: multipartContentType } = buildMultipartFormData(
        fields,
        {
          fieldName: 'files[]',
          fileName: ensureExtension(options.fileName, ext),
          contentType,
          data: fileData,
        }
      );

      const res = await stravaSession.fetch(STRAVA_UPLOAD_FILES_URL, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': multipartContentType,
          'X-CSRF-Token': csrfToken || authenticityToken,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: 'https://www.strava.com',
          Referer: STRAVA_UPLOAD_SELECT_URL,
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        body,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      return { status: res.status, ok: res.ok, url: res.url, data };
    };

    let uploadRes;
    if (options.fitBase64) {
      uploadRes = await postSingleFile('fit');
      if (
        (uploadRes.status === 400 ||
          uploadRes.status === 422 ||
          uploadRes.status === 500) &&
        options.tcxContent
      ) {
        uploadRes = await postSingleFile('tcx');
      }
    } else if (options.tcxContent) {
      uploadRes = await postSingleFile('tcx');
    } else {
      return {
        ok: false,
        error: 'No hay contenido de actividad (.fit o .tcx) para subir.',
      };
    }

    if (
      uploadRes.status === 401 ||
      uploadRes.status === 403 ||
      isLoginUrl(uploadRes.url)
    ) {
      writeAuthMetadata({ connected: false });
      return {
        ok: false,
        needsRelogin: true,
        error: 'Sesión expirada en Strava.',
      };
    }

    let parsed = parseUploadEntry(uploadRes.data);

    if (parsed.duplicate) {
      return {
        ok: true,
        duplicate: true,
        activityId: parsed.activityId,
        activityUrl: parsed.activityId
          ? `https://www.strava.com/activities/${parsed.activityId}`
          : 'https://www.strava.com/athlete/training',
      };
    }

    if (!uploadRes.ok) {
      return {
        ok: false,
        error:
          parsed.error ||
          `Error al subir la actividad a Strava (HTTP ${uploadRes.status}).`,
      };
    }

    if (!parsed.activityId && parsed.uploadId) {
      for (let attempt = 0; attempt < PROGRESS_MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, PROGRESS_POLL_INTERVAL_MS));

        const progressUrl = `${STRAVA_UPLOAD_PROGRESS_URL}?ids=${encodeURIComponent(
          String(parsed.uploadId)
        )}`;
        const progressRes = await stravaSession.fetch(progressUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': csrfToken || authenticityToken,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Referer: STRAVA_UPLOAD_SELECT_URL,
          },
        });

        if (!progressRes.ok) {
          continue;
        }

        let progressData: unknown = null;
        try {
          progressData = await progressRes.json();
        } catch {
          progressData = null;
        }

        const progressEntry = parseUploadEntry(progressData);
        if (progressEntry.duplicate) {
          return {
            ok: true,
            duplicate: true,
            activityId: progressEntry.activityId,
            activityUrl: progressEntry.activityId
              ? `https://www.strava.com/activities/${progressEntry.activityId}`
              : 'https://www.strava.com/athlete/training',
          };
        }

        if (progressEntry.error) {
          return {
            ok: false,
            error: progressEntry.error,
          };
        }

        if (progressEntry.activityId) {
          parsed = {
            ...parsed,
            activityId: progressEntry.activityId,
          };
          break;
        }
      }
    }

    if (parsed.error) {
      return {
        ok: false,
        error: parsed.error,
      };
    }

    const activityUrl = parsed.activityId
      ? `https://www.strava.com/activities/${parsed.activityId}`
      : 'https://www.strava.com/athlete/training';

    return {
      ok: true,
      activityId: parsed.activityId,
      activityUrl,
    };
  };

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<StravaUploadResult>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        error: 'Tiempo de espera agotado al conectar con Strava.',
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
          : 'Error inesperado al subir la actividad a Strava.',
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function openExternalStravaUrl(url: string): Promise<void> {
  if (typeof url === 'string' && url.startsWith(STRAVA_BASE_URL)) {
    await shell.openExternal(url);
  }
}
