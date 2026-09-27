import type { ModelAnswer } from "../extract/schema";
import { SAMPLE_DOCS } from "./documents";

/**
 * The sample project's expected extraction results.
 *
 * These are fixtures, not model output: they are labelled as such in the UI and
 * every cell carries the model name "sample fixture". They still go through the
 * same verifyAnswer() path as live extraction, against the text really parsed out
 * of the generated PDFs — so if a quote here ever stops matching its document,
 * the sample cell fails visibly instead of lying.
 */

export const SAMPLE_MODEL = "sample fixture";

export const SAMPLE_PROJECT = {
  title: "Edge action recognition (sample)",
  question:
    "Which of these methods runs in real time on embedded hardware without giving up accuracy — and are the reported numbers even comparable?",
};

export interface SampleColumn {
  key: string;
  label: string;
  instruction: string;
  answerType: "text" | "number" | "categorical";
  unit?: string;
  options?: string[];
}

export const SAMPLE_COLUMNS: SampleColumn[] = [
  {
    key: "method",
    label: "Method / backbone",
    instruction:
      "Name the backbone architecture and the clip sampling configuration (frames per clip, input resolution) the paper uses.",
    answerType: "text",
  },
  {
    key: "training",
    label: "Training data",
    instruction: "Which dataset and split was the model trained on? Include any extra unlabelled data.",
    answerType: "text",
  },
  {
    key: "supervision",
    label: "Supervision",
    instruction: "Is training fully supervised, self-supervised, distilled, or a mixture?",
    answerType: "categorical",
    options: ["Supervised", "Self-distilled", "Mixed", "Unclear"],
  },
  {
    key: "evaluation",
    label: "Evaluation dataset / split",
    instruction:
      "Which dataset AND which split were the headline numbers measured on? The split matters: validation and test are not interchangeable.",
    answerType: "text",
  },
  {
    key: "accuracy",
    label: "Top-1 accuracy",
    instruction:
      "The headline top-1 accuracy, with the configuration it was measured under. If the paper reports several operating points, say so rather than picking the highest.",
    answerType: "number",
    unit: "% top-1",
  },
  {
    key: "runtime",
    label: "Runtime conditions",
    instruction:
      "Reported inference latency or throughput AND the hardware it was measured on. A datacentre GPU number is not an embedded number.",
    answerType: "text",
  },
];

type Fixtures = Record<string, Record<string, ModelAnswer>>;

const answer = (a: Partial<ModelAnswer> & Pick<ModelAnswer, "outcome">): ModelAnswer => ({
  value: "",
  unit: "",
  conditions: "",
  note: "",
  evidence: [],
  ...a,
});

export const SAMPLE_FIXTURES: Fixtures = {
  framelite: {
    method: answer({
      outcome: "found",
      value: "MobileViT-S, 16 frames per clip at 224x224",
      conditions: "Fine-tuned end to end from DemoImage-1k pretraining",
      evidence: [
        { page: 1, quote: "The backbone is MobileViT-S, pretrained on DemoImage-1k and fine-tuned" },
        { page: 1, quote: "We sample 16 frames per clip at an input resolution of" },
      ],
    }),
    training: answer({
      outcome: "found",
      value: "DemoKinetics-200 training split",
      evidence: [
        { page: 1, quote: "FrameLite is trained on the DemoKinetics-200 training" },
      ],
    }),
    supervision: answer({
      outcome: "found",
      value: "Supervised",
      evidence: [{ page: 1, quote: "uses a MobileViT-S backbone with supervised labels only" }],
    }),
    evaluation: answer({
      outcome: "found",
      value: "ED-Bench, validation split",
      conditions: "The test split was explicitly not evaluated",
      evidence: [
        { page: 2, quote: "On the ED-Bench validation split FrameLite reaches 81.4% top-1 accuracy" },
        { page: 2, quote: "We did not evaluate on the held-out test split" },
      ],
    }),
    accuracy: answer({
      outcome: "found",
      value: "81.4",
      unit: "% top-1",
      conditions: "ED-Bench validation split, 16 frames per clip, INT8 quantisation",
      evidence: [
        { page: 2, quote: "FrameLite reaches 81.4% top-1 accuracy" },
        { page: 2, quote: "INT8 quantisation costs roughly 0.6 points of accuracy compared" },
      ],
    }),
    runtime: answer({
      outcome: "found",
      value: "34 ms per clip",
      conditions: "Single Jetson Orin NX, INT8 quantisation — embedded hardware",
      evidence: [
        { page: 2, quote: "Latency was measured on a single Jetson Orin NX at 34 ms per clip with" },
      ],
    }),
  },
  motiontiny: {
    method: answer({
      outcome: "found",
      value: "ResNet-18 with a temporal shift module, 8 frames per clip at 168x168",
      evidence: [
        { page: 1, quote: "The student uses a ResNet-18 backbone with a temporal shift module" },
      ],
    }),
    training: answer({
      outcome: "found",
      value: "DemoKinetics-200 training split plus unlabelled DemoStream-1M clips",
      evidence: [
        { page: 1, quote: "split together with unlabelled clips from DemoStream-1M, so supervision" },
      ],
    }),
    supervision: answer({
      outcome: "found",
      value: "Self-distilled",
      conditions: "Teacher-student distillation with unlabelled data, not fully supervised",
      evidence: [{ page: 1, quote: "is partly self-distilled rather than fully supervised" }],
    }),
    evaluation: answer({
      outcome: "found",
      value: "ED-Bench, test split",
      conditions: "Test split — not the validation split the other papers report",
      evidence: [
        { page: 2, quote: "MotionTiny reaches 79.2% top-1 accuracy on the ED-Bench test split at 8" },
      ],
    }),
    accuracy: answer({
      outcome: "found",
      value: "79.2",
      unit: "% top-1",
      conditions: "ED-Bench TEST split, 8 frames per clip",
      evidence: [
        { page: 2, quote: "MotionTiny reaches 79.2% top-1 accuracy on the ED-Bench test split at 8" },
      ],
    }),
    runtime: answer({
      outcome: "found",
      value: "12 ms per clip",
      conditions: "NVIDIA A100 datacentre GPU — the authors state this is NOT comparable to embedded numbers",
      evidence: [
        { page: 2, quote: "We report 12 ms per clip on an NVIDIA A100 GPU" },
        { page: 2, quote: "Because the reported latency comes from a datacentre GPU, it is not" },
      ],
    }),
  },
  clipformer: {
    method: answer({
      outcome: "ambiguous",
      value: "ViT-B at 8 frames, or ViT-L at 16 frames",
      note: "The paper reports two operating points rather than one configuration. Split the row to compare them separately.",
      evidence: [
        { page: 2, quote: "ClipFormer-B with a ViT-B backbone and 8 frames per clip reaches 77.0%" },
        { page: 2, quote: "top-1 accuracy. ClipFormer-L with a ViT-L backbone and 16 frames per clip" },
      ],
    }),
    training: answer({
      outcome: "found",
      value: "DemoKinetics-200 training split",
      evidence: [{ page: 1, quote: "train on the DemoKinetics-200 training split with supervised labels and" }],
    }),
    supervision: answer({
      outcome: "found",
      value: "Supervised",
      evidence: [{ page: 1, quote: "train on the DemoKinetics-200 training split with supervised labels and" }],
    }),
    evaluation: answer({
      outcome: "found",
      value: "ED-Bench, validation split",
      evidence: [{ page: 2, quote: "Table 2 reports both configurations on the ED-Bench validation split" }],
    }),
    accuracy: answer({
      outcome: "ambiguous",
      value: "77.0 or 83.1",
      unit: "% top-1",
      note:
        "Two operating points on the same split: 77.0 for ClipFormer-B and 83.1 for ClipFormer-L. Taking the higher number alone would misstate the paper.",
      evidence: [
        { page: 2, quote: "ClipFormer-B with a ViT-B backbone and 8 frames per clip reaches 77.0%" },
        { page: 2, quote: "reaches 83.1% top-1 accuracy" },
      ],
    }),
    runtime: answer({
      outcome: "not_found",
      note: "The paper states outright that it does not report inference latency.",
      evidence: [{ page: 2, quote: "We do not report inference latency in this version of the paper" }],
    }),
  },
};

export const SAMPLE_DOC_ORDER = SAMPLE_DOCS.map((doc) => doc.slug);
