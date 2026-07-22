import type { FileValidation } from '../types';

export function validateFileMeta(file: File, v: FileValidation | undefined): string | null {
  if (!v) return null;
  const name = file.name.toLowerCase();
  if (v.extensions) {
    const exts = v.extensions.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (exts.length && !exts.some((e) => name.endsWith(e.startsWith('.') ? e : '.' + e)))
      return v.errorMsg || `Допустимые расширения: ${v.extensions}`;
  }
  if (v.mimeTypes) {
    const mimes = v.mimeTypes.split(',').map((m) => m.trim()).filter(Boolean);
    if (mimes.length && !mimes.some((m) => file.type === m || (m.endsWith('/*') && file.type.startsWith(m.slice(0, -1)))))
      return v.errorMsg || `Недопустимый тип файла`;
  }
  if (v.maxSize && file.size > v.maxSize * 1024 * 1024) return v.errorMsg || `Макс. размер ${v.maxSize} МБ`;
  if (v.minSize && file.size < v.minSize * 1024) return v.errorMsg || `Мин. размер ${v.minSize} КБ`;
  return null;
}

export function validateImageDims(file: File, v: FileValidation | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    if (!v || (!v.minWidth && !v.maxWidth && !v.minHeight && !v.maxHeight)) return resolve(null);
    if (!file.type.startsWith('image/')) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      URL.revokeObjectURL(img.src);
      if (v.minWidth && width < v.minWidth) return resolve(v.errorMsg || `Мин. ширина ${v.minWidth}px`);
      if (v.maxWidth && width > v.maxWidth) return resolve(v.errorMsg || `Макс. ширина ${v.maxWidth}px`);
      if (v.minHeight && height < v.minHeight) return resolve(v.errorMsg || `Мин. высота ${v.minHeight}px`);
      if (v.maxHeight && height > v.maxHeight) return resolve(v.errorMsg || `Макс. высота ${v.maxHeight}px`);
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}
