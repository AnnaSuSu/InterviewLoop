import assert from "node:assert/strict";
import test from "node:test";

import { parseRetrospectiveSections, selectRetrospectiveSections } from "./retrospectiveSections.js";

test("selects the fixed narrow-card diagnosis and training-plan sections", () => {
  const sections = parseRetrospectiveSections(`
# TypeScript 训练回顾

## 总体诊断
当前掌握度稳定，但类型收窄仍需加强。

## 逐题复盘
**Q1 · 类型守卫 · 7/10**

## 进步趋势
最近两次训练的表达更完整。

## 下一轮训练计划
- 重做类型守卫题
`);

  const selected = selectRetrospectiveSections(sections);

  assert.equal(selected.diagnosis?.title, "总体诊断");
  assert.match(selected.diagnosis?.markdown || "", /类型收窄/);
  assert.equal(selected.nextSteps?.title, "下一轮训练计划");
  assert.match(selected.nextSteps?.markdown || "", /重做类型守卫题/);
});

test("keeps legacy retrospective heading fallbacks", () => {
  const sections = parseRetrospectiveSections(`
## 掌握情况
基础稳定。

## 下一步建议
- 继续训练。
`);

  const selected = selectRetrospectiveSections(sections);

  assert.equal(selected.diagnosis?.title, "掌握情况");
  assert.equal(selected.nextSteps?.title, "下一步建议");
});
