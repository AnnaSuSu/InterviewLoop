import { restoreSystemArchive } from '@techspar/platform'

type Arguments = { archivePath?: string; dataDir?: string; confirm: boolean }

function parseArguments(values: string[]): Arguments {
  const output: Arguments = { confirm: false }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!
    if (value === '--') continue
    if (value === '--confirm') { output.confirm = true; continue }
    if (value.startsWith('--archive=')) { output.archivePath = value.slice('--archive='.length); continue }
    if (value === '--archive' && values[index + 1]) { output.archivePath = values[index += 1]; continue }
    if (value.startsWith('--data-dir=')) { output.dataDir = value.slice('--data-dir='.length); continue }
    if (value === '--data-dir' && values[index + 1]) { output.dataDir = values[index += 1]; continue }
    throw new Error(`未知参数: ${value}`)
  }
  return output
}

async function main(): Promise<void> {
  const args = parseArguments(Bun.argv.slice(2))
  if (!args.archivePath || !args.dataDir) throw new Error('用法: bun run restore:system -- --archive=<backup.tar.gz> --data-dir=<data> [--confirm]')
  const result = await restoreSystemArchive({ archivePath: args.archivePath, dataDir: args.dataDir, confirm: args.confirm })
  if (result.mode === 'preflight') {
    console.log('系统归档预检通过；未修改任何数据。停止 TechSpar 服务后，加 --confirm 才会执行恢复。')
  } else {
    console.log('系统归档恢复完成。')
    if (result.backupDir) console.log(`原数据目录已保留在: ${result.backupDir}`)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
