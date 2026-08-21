function serializeConfidence(confidence) {
  if (confidence === "high") return 1;
  if (confidence === "low") return 0;
  return undefined;
}

/** Build the API answer payload while keeping UI confidence labels out of it. */
export function buildInterviewAnswers(questions, answers, confidences = {}) {
  return questions.map((question) => {
    const confidence = serializeConfidence(confidences[question.id]);
    return {
      question_id: question.id,
      answer: answers[question.id] || "",
      ...(confidence === undefined ? {} : { confidence }),
    };
  });
}
