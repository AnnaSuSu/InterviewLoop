import assert from "node:assert/strict";
import test from "node:test";

import { buildInterviewAnswers } from "./interviewAnswers.js";

test("serializes high and low confidence as numbers", () => {
  const payload = buildInterviewAnswers(
    [{ id: 1 }, { id: "question-2" }],
    { 1: "first answer", "question-2": "second answer" },
    { 1: "high", "question-2": "low" },
  );

  assert.deepEqual(payload, [
    { question_id: 1, answer: "first answer", confidence: 1 },
    { question_id: "question-2", answer: "second answer", confidence: 0 },
  ]);
});

test("omits confidence when the user has not selected one", () => {
  const payload = buildInterviewAnswers(
    [{ id: 1 }, { id: 2 }],
    { 1: "answered" },
    { 2: "unexpected-value" },
  );

  assert.deepEqual(payload, [
    { question_id: 1, answer: "answered" },
    { question_id: 2, answer: "" },
  ]);
});
