# 参与贡献

谢谢你愿意花时间让 TechSpar 变得更好。这个项目还在持续打磨,不管是修 bug、补文档还是加功能,都欢迎。

## 开始之前

- **用着别扭、发现 bug、有想法**:直接开 [Issue](https://github.com/AnnaSuSu/TechSpar/issues) 聊,把场景说清楚就行,不用拘谨。
- **小改动**(修 bug、补文档、小优化):直接提 PR。
- **大改动**(新功能、重构、动架构):建议先开 Issue 对一下方向,免得白做。

## 把项目跑起来

完整步骤见 [README 快速开始](README.md#快速开始),速记版:

```bash
# 后端
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# 前端
cd frontend && npm install && npm run dev
```

所有模型密钥都是登录后在「设置」里按用户配置的,`.env` 里只有启动引导项。

## 项目结构速览

```
backend/            FastAPI 后端(routers/ 路由、graphs/ 面试流程、prompts/ 提示词)
frontend/src/       React 19 + Vite + Tailwind 4
  pages/            页面(大页面拆同名小写文件夹)
  api/              fetch 封装 + openapi 生成的接口类型
  resume/           简历编辑器模块(移植自 Magic Resume,见该目录 README)
data/users/<id>/    每用户数据(不入库)
tests/              后端回归测试
```

## 代码约定

**前端**

- JS/TS 长期共存:**新代码一律写 TS**,改到老 `.jsx` 顺手转;纯展示页(Landing 等)不强求。
- 提交前跑一遍,三个都要过:

  ```bash
  cd frontend
  npm run typecheck   # tsc 严格模式,零错误
  npm run lint        # eslint,零错误
  npm run build
  ```

- 改了后端接口后,起着后端跑 `npm run gen:api` 重新生成 `src/api/schema.d.ts`。

**后端**

- 路由按域拆在 `backend/routers/`,`prefix="/api"`;鉴权统一 `Depends(get_current_user)`。
- LLM 调用一律走 `llm_provider.get_llm(user_id)`(消息用同模块的 `SystemMessage/HumanMessage/AIMessage` 构造),让 LLM 只返回 JSON 时用 `parse_json_response` 解析并做一次重试。
- 回归测试:`pytest tests/`。

**通用原则**

- **不绑定任何特定服务商**:LLM/Embedding/语音等全部走用户自配的兼容接口,代码和文案里不要假定某家服务。
- 中文注释写"为什么",不复述代码。

## 提交与 PR

- 提交信息:`类型(范围): 描述`,类型前缀用英文(`feat / fix / chore / refactor / docs`),描述中英文皆可。例:`feat(profile): 画像页新增到期复习提醒`。
- 一个提交只做一件事,保证每个提交后项目都能构建。
- PR 描述里写清楚**动机**和**改了什么**,有界面变化附个截图。

## License 须知

- 项目整体为 [CC BY-NC 4.0](LICENSE),提交贡献即表示你同意你的代码以相同条款发布。
- 例外:`frontend/src/resume/` 移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume),保留其原始协议(Apache 2.0 + 附加商业限制),向该目录贡献代码同样受其条款约束,详见该目录的 `LICENSE` 与 `README.md`。

再次感谢!跑通了新的部署方式、接入了新的服务商,也欢迎回来在 Issue 里分享,让后面的人少踩坑。
