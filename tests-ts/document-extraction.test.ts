import { describe, expect, test } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { PortableDocumentTextExtractor, PortablePersonalDocumentExtractor } from '@techspar/platform'

const OFFICE_LIMIT = 40 * 1024 * 1024

function corruptFirstCompressedPayload(bytes: Uint8Array): Uint8Array {
  const corrupted = bytes.slice()
  const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength)
  for (let offset = 0; offset <= corrupted.length - 30; offset += 1) {
    if (view.getUint32(offset, true) !== 0x04034b50) continue
    const payload = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    corrupted[payload] = 0xff
    return corrupted
  }
  throw new Error('test ZIP has no local entry')
}

function mutateHeaders(bytes: Uint8Array, mutate: (view: DataView, offset: number, central: boolean) => void): Uint8Array {
  const changed = bytes.slice()
  const view = new DataView(changed.buffer, changed.byteOffset, changed.byteLength)
  for (let offset = 0; offset <= changed.length - 4; offset += 1) {
    const signature = view.getUint32(offset, true)
    if (signature === 0x04034b50) mutate(view, offset, false)
    if (signature === 0x02014b50) mutate(view, offset, true)
  }
  return changed
}

describe('safe Office document extraction', () => {
  test('extracts only the required DOCX, PPTX, and XLSX XML', async () => {
    const basic = new PortableDocumentTextExtractor()
    const personal = new PortablePersonalDocumentExtractor()
    const docx = zipSync({
      'word/document.xml': strToU8('<w:document><w:p><w:t>文档正文</w:t></w:p></w:document>'),
      'word/media/ignored.bin': new Uint8Array([1, 2, 3]),
    })
    const pptx = zipSync({
      'ppt/slides/slide10.xml': strToU8('<p:sld><a:t>第十页</a:t></p:sld>'),
      'ppt/slides/slide2.xml': strToU8('<p:sld><a:t>第二页</a:t></p:sld>'),
      'ppt/notesSlides/notesSlide1.xml': strToU8('<a:t>不应提取的备注</a:t>'),
    })
    const xlsx = zipSync({
      'xl/sharedStrings.xml': strToU8('<sst><si><t>共享字符串</t></si></sst>'),
      'xl/worksheets/sheet2.xml': strToU8('<worksheet><v>第二表</v></worksheet>'),
      'xl/worksheets/sheet10.xml': strToU8('<worksheet><v>第十表</v></worksheet>'),
      'xl/styles.xml': strToU8('<style>不应提取的样式</style>'),
    })

    expect(await basic.extract('example.docx', docx)).toContain('文档正文')
    expect(await personal.extract('example.docx', docx)).not.toContain('ignored')
    const slides = await personal.extract('example.pptx', pptx)
    expect(slides).toContain('第二页')
    expect(slides).toContain('第十页')
    expect(slides.indexOf('第二页')).toBeLessThan(slides.indexOf('第十页'))
    expect(slides).not.toContain('不应提取的备注')
    const sheets = await personal.extract('example.xlsx', xlsx)
    expect(sheets).toContain('共享字符串')
    expect(sheets.indexOf('第二表')).toBeLessThan(sheets.indexOf('第十表'))
    expect(sheets).not.toContain('不应提取的样式')
  })

  test('rejects a high-compression single entry before inflating it', async () => {
    const expanded = new Uint8Array(OFFICE_LIMIT + 1).fill(65)
    const compressed = zipSync({ 'word/document.xml': expanded }, { level: 9 })
    expect(compressed.length).toBeLessThan(100_000)
    const corruptBomb = corruptFirstCompressedPayload(compressed)

    await expect(new PortableDocumentTextExtractor().extract('bomb.docx', corruptBomb)).rejects.toThrow('Office 文档内部内容过大')
  })

  test('checks the total expanded size before inflating any selected entry', async () => {
    const expanded = new Uint8Array(21 * 1024 * 1024).fill(65)
    const compressed = zipSync({
      'ppt/slides/slide1.xml': expanded,
      'ppt/slides/slide2.xml': expanded,
    }, { level: 9 })
    expect(compressed.length).toBeLessThan(100_000)
    const corruptBomb = corruptFirstCompressedPayload(compressed)

    await expect(new PortablePersonalDocumentExtractor().extract('bomb.pptx', corruptBomb)).rejects.toThrow('Office 文档解压后内容过大')
  })

  test('rejects dangerous paths, encrypted entries, and unsupported compression', async () => {
    const xml = strToU8('<w:document><w:t>正文</w:t></w:document>')
    const dangerous = zipSync({ 'word/document.xml': xml, '../outside.xml': xml })
    const valid = zipSync({ 'word/document.xml': xml })
    const encrypted = mutateHeaders(valid, (view, offset, central) => {
      const flagOffset = offset + (central ? 8 : 6)
      view.setUint16(flagOffset, view.getUint16(flagOffset, true) | 1, true)
    })
    const unsupported = mutateHeaders(valid, (view, offset, central) => {
      view.setUint16(offset + (central ? 10 : 8), 99, true)
    })
    const extractor = new PortableDocumentTextExtractor()

    await expect(extractor.extract('dangerous.docx', dangerous)).rejects.toThrow('Office 文档包含危险路径')
    await expect(extractor.extract('encrypted.docx', encrypted)).rejects.toThrow('Office 文档不支持加密 ZIP')
    await expect(extractor.extract('unsupported.docx', unsupported)).rejects.toThrow('Office 文档压缩格式不受支持')
  })
})
