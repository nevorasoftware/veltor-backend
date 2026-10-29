import * as path from 'path';

export const DOCUMENTS_UPLOAD_DIR = path.resolve(process.cwd(), process.env.STORAGE_LOCAL_ROOT || 'uploads/documents');
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
