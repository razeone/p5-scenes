/**
 * DropFiles.ts — Files out of a drag-and-drop, folders included.
 *
 * `dataTransfer.files` is empty for a dropped *directory*, so a director
 * dragging a footage folder onto the canvas would otherwise get nothing.
 * The entry API walks it instead.
 *
 * Timing matters: `dataTransfer.items` is emptied as soon as the drop
 * handler returns, so the entries are collected synchronously here — up
 * front, before the first await — and only the file reads are deferred.
 */

/** A stray drop of a home directory shouldn't hang the shoot. */
const MAX_FILES = 500

export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  // No entry API (or a plain file list): the flat list is all there is.
  if (entries.length === 0) return Array.from(dt.files ?? [])

  const files: File[] = []
  for (const entry of entries) await walk(entry, files)
  return files
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES) return

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      ;(entry as FileSystemFileEntry).file(resolve, () => resolve(null))
    })
    if (file) out.push(file)
    return
  }

  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries hands back a batch at a time (~100); keep asking until
  // it comes back empty, or a large folder arrives half-read.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]))
    })
    if (batch.length === 0) break
    for (const child of batch) await walk(child, out)
  }
}
