# 旧版 Python 后端（`legacy/python-backend`）

`legacy/python-backend` 是后端迁移到 TypeScript 之前，最后一个 Python + FastAPI 版本，固定在提交 `73d1a7c`。它只作为历史归档和紧急回看使用，不再接收新功能和修复。

当前版本请使用 `main`：后端已完全迁移为 TypeScript + Bun + Hono，通过 Bun workspace 统一管理前后端依赖。

## 如何查看

查看旧版时**必须**使用独立 checkout 和迁移前的数据副本。推荐从当前 `main` checkout 创建只读 worktree：

```bash
git fetch origin legacy/python-backend
git worktree add --detach ../TechSpar-python-legacy origin/legacy/python-backend
cp -R /path/to/pre-migration-data-backup/. ../TechSpar-python-legacy/data/
```

也可以把 `legacy/python-backend` 单独 clone 到另一个目录。

## 注意事项

- 不要在当前工作目录直接切换分支。
- 不要软链接或复用 `data/`。
- 不要让新旧服务同时连接同一份 SQLite、用户文件或模型缓存。
- 没有迁移前备份时，只用空数据启动旧版做代码回看。

迁移过程本身的记录见 [Hono/TypeScript 迁移](hono-typescript-migration.md)。
