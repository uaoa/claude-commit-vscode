import * as path from "path";

export function isInsideFolder(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
