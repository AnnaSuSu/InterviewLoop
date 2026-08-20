import { unzipSync, type UnzipFileInfo } from 'fflate'

const MAX_OFFICE_EXPANDED_BYTES = 40 * 1024 * 1024
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_ENTRY = 0x04034b50
const ENCRYPTED_FLAGS = 0x0001 | 0x0040

export type OfficeDocumentKind = 'docx' | 'pptx' | 'xlsx'

class OfficeArchiveError extends Error {}

function archiveError(message: string): never {
  throw new OfficeArchiveError(message)
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function range(bytes: Uint8Array, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    archiveError('Office 文档损坏或格式不受支持')
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  if (bytes.length < 22) archiveError('Office 文档损坏或格式不受支持')
  const earliest = Math.max(0, bytes.length - 22 - 65_535)
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.length) return offset
  }
  archiveError('Office 文档损坏或格式不受支持')
}

function assertUnencryptedArchive(bytes: Uint8Array): void {
  const view = viewOf(bytes)
  const end = findEndOfCentralDirectory(bytes, view)
  const disk = view.getUint16(end + 4, true)
  const centralDisk = view.getUint16(end + 6, true)
  const entriesOnDisk = view.getUint16(end + 8, true)
  const entryCount = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) archiveError('Office 文档不支持分卷 ZIP')
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) archiveError('Office 文档不支持 ZIP64')
  range(bytes, centralOffset, centralSize)
  if (centralOffset + centralSize > end) archiveError('Office 文档损坏或格式不受支持')

  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    range(bytes, offset, 46)
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY) archiveError('Office 文档损坏或格式不受支持')
    const flags = view.getUint16(offset + 8, true)
    if (flags & ENCRYPTED_FLAGS) archiveError('Office 文档不支持加密 ZIP')
    const compression = view.getUint16(offset + 10, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (localOffset === 0xffffffff) archiveError('Office 文档不支持 ZIP64')
    range(bytes, localOffset, 30)
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_ENTRY) archiveError('Office 文档损坏或格式不受支持')
    const localFlags = view.getUint16(localOffset + 6, true)
    if (localFlags & ENCRYPTED_FLAGS) archiveError('Office 文档不支持加密 ZIP')
    if (view.getUint16(localOffset + 8, true) !== compression) archiveError('Office 文档损坏或格式不受支持')
    const entryLength = 46 + nameLength + extraLength + commentLength
    range(bytes, offset, entryLength)
    offset += entryLength
  }
  if (offset > centralOffset + centralSize) archiveError('Office 文档损坏或格式不受支持')
}

function assertSafeEntry(file: UnzipFileInfo, expandedBytes: number): number {
  const parts = file.name.split('/')
  if (
    !file.name
    || file.name.startsWith('/')
    || file.name.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(file.name)
    || /^[a-zA-Z]:/.test(file.name)
    || parts.some((part, index) => part === '.' || part === '..' || (!part && index !== parts.length - 1))
  ) archiveError('Office 文档包含危险路径')
  if (file.compression !== 0 && file.compression !== 8) archiveError('Office 文档压缩格式不受支持')
  if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > MAX_OFFICE_EXPANDED_BYTES) {
    archiveError('Office 文档内部内容过大')
  }
  if (expandedBytes > MAX_OFFICE_EXPANDED_BYTES - file.originalSize) archiveError('Office 文档解压后内容过大')
  return expandedBytes + file.originalSize
}

function needed(kind: OfficeDocumentKind, name: string): boolean {
  if (kind === 'docx') return name === 'word/document.xml'
  if (kind === 'pptx') return /^ppt\/slides\/slide\d+\.xml$/.test(name)
  return name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
}

export function extractOfficeXmlEntries(bytes: Uint8Array, kind: OfficeDocumentKind): Record<string, Uint8Array> {
  try {
    assertUnencryptedArchive(bytes)
    let expandedBytes = 0
    unzipSync(bytes, {
      filter(file) {
        expandedBytes = assertSafeEntry(file, expandedBytes)
        return false
      },
    })
    return unzipSync(bytes, { filter: (file) => needed(kind, file.name) })
  } catch (error) {
    if (error instanceof OfficeArchiveError) throw error
    throw new Error('Office 文档损坏或格式不受支持')
  }
}
