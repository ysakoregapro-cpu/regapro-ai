/**
 * Future training-dataset port. Not mixed into Knowledge retrieval.
 * Fine-tuning is out of scope; this only preserves a conversion interface.
 */
export type TrainingCandidateDraft = {
  question: string;
  evidenceRefs: Array<{ sourceType: string; id: string }>;
  modelAnswer: string;
  correctedAnswer: string | null;
  evaluation: "up" | "down" | "corrected" | "unrated";
  confidentialityLevel: "company" | "people" | "executive";
  visibility: string;
};

export type TrainingDatasetPort = {
  fromEvaluation(input: TrainingCandidateDraft): TrainingCandidateDraft;
};

export class PassthroughTrainingDatasetPort implements TrainingDatasetPort {
  fromEvaluation(input: TrainingCandidateDraft): TrainingCandidateDraft {
    return { ...input };
  }
}
