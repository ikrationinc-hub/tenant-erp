/** RHF's value is `unknown` for a runtime-driven form - these narrow it without `any`/`as`. */

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export interface UploadedFileValue {
  uid: string;
  name: string;
}

export function asUploadedFile(value: unknown): UploadedFileValue | null {
  if (typeof value !== "object" || value === null || !("uid" in value) || !("name" in value)) {
    return null;
  }
  const { uid, name } = value;
  return typeof uid === "string" && typeof name === "string" ? { uid, name } : null;
}

export function asUploadedFileArray(value: unknown): UploadedFileValue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: UploadedFileValue[] = [];
  for (const item of value) {
    const file = asUploadedFile(item);
    if (file) {
      files.push(file);
    }
  }
  return files;
}
