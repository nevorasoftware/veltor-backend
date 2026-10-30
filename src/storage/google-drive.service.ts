import { Injectable, Logger } from '@nestjs/common';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Carpetas de primer nivel dentro de la carpeta raíz del sistema (VELTOR) */
export const DRIVE_FOLDERS = {
  vehicles: 'Vehiculos',
  loans: 'Creditos',
  customers: 'Clientes',
} as const;

/** Prefijo de `fileKey` para documentos guardados en Drive (los locales usan solo el nombre de archivo) */
export const DRIVE_KEY_PREFIX = 'gdrive:';

export interface DriveFile {
  id: string;
  name: string;
  webViewLink?: string;
}

/** Nombre válido para Drive: sin barras ni caracteres de control */
export const driveName = (s: string) =>
  s
    .replace(/[\\/\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

const quoteQuery = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Almacenamiento en Google Drive con la API REST (OAuth2 con refresh token, alcance drive.file).
 * Estructura: VELTOR/Vehiculos/<vehículo>, VELTOR/Creditos/<número de crédito>, VELTOR/Clientes/<cliente>.
 * Con drive.file la aplicación solo ve los archivos y carpetas que ella misma creó.
 */
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private accessToken: { value: string; expiresAt: number } | null = null;
  /** ruta "VELTOR/Creditos/CRE-2026-0001" → id; se guarda la promesa para no duplicar carpetas en llamadas simultáneas */
  private readonly folders = new Map<string, Promise<string>>();

  private get clientId() {
    return process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  }
  private get clientSecret() {
    return process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
  }
  private get refreshToken() {
    return process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN;
  }
  private get rootName() {
    return process.env.GOOGLE_DRIVE_ROOT_FOLDER || 'VELTOR';
  }

  isEnabled(): boolean {
    return process.env.STORAGE_DRIVER === 'gdrive' && !!this.clientId && !!this.clientSecret && !!this.refreshToken;
  }

  /** Verifica el acceso creando (o encontrando) la carpeta raíz. */
  async status() {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        driver: process.env.STORAGE_DRIVER || 'local',
        message: 'Google Drive no está activo: los archivos se guardan en el servidor.',
      };
    }
    try {
      const rootId = await this.ensureFolder([]);
      return { enabled: true, driver: 'gdrive', rootFolder: this.rootName, rootFolderUrl: this.folderUrl(rootId) };
    } catch (err: any) {
      return { enabled: true, driver: 'gdrive', rootFolder: this.rootName, error: String(err?.message || err) };
    }
  }

  async upload(folderPath: string[], name: string, mimeType: string, content: Buffer): Promise<DriveFile> {
    const parentId = await this.ensureFolder(folderPath);
    const boundary = `veltor-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name: driveName(name), parents: [parentId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const file = await this.request<DriveFile>(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
    this.logger.log(`Archivo subido a Drive: ${[this.rootName, ...folderPath, file.name].join('/')}`);
    return file;
  }

  async download(fileId: string): Promise<{ content: Buffer; mimeType: string }> {
    const res = await this.fetchWithAuth(`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`);
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return {
      content: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
    };
  }

  /** Envía el archivo a la papelera de Drive (recuperable 30 días). No lanza excepciones. */
  async trash(fileId: string): Promise<void> {
    try {
      await this.request(`${FILES_URL}/${encodeURIComponent(fileId)}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar a la papelera el archivo ${fileId} de Drive: ${err?.message || err}`);
    }
  }

  /** Devuelve el id de la carpeta VELTOR/<...folderPath>, creándola si no existe. */
  ensureFolder(folderPath: string[]): Promise<string> {
    const names = folderPath.map(driveName);
    const key = [this.rootName, ...names].join('/');
    let pending = this.folders.get(key);
    if (!pending) {
      pending = (async () => {
        if (!names.length) return this.findOrCreateFolder(this.rootName, 'root');
        const parentId = await this.ensureFolder(folderPath.slice(0, -1));
        return this.findOrCreateFolder(names[names.length - 1], parentId);
      })();
      this.folders.set(key, pending);
      pending.catch(() => this.folders.delete(key));
    }
    return pending;
  }

  folderUrl(id: string) {
    return `https://drive.google.com/drive/folders/${id}`;
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const q = `name = ${quoteQuery(name)} and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
    const found = await this.request<{ files: DriveFile[] }>(
      `${FILES_URL}?${new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1' })}`,
    );
    if (found.files[0]) return found.files[0].id;
    const created = await this.request<DriveFile>(`${FILES_URL}?fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    this.logger.log(`Carpeta creada en Drive: ${name}`);
    return created.id;
  }

  private async request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchWithAuth(url, init);
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return (await res.json()) as T;
  }

  private async fetchWithAuth(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      this.accessToken = null;
      return this.fetchWithAuth(url, init, false);
    }
    return res;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token',
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(
        `No se pudo obtener el token de Google Drive (${res.status}): ${body.error_description || body.error || 'sin detalle'}`,
      );
    }
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
    return this.accessToken.value;
  }
}
