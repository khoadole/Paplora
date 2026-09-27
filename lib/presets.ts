import type { AnswerType } from "./types";

/**
 * Column presets. Starting points the user edits, not a fixed schema —
 * every field stays editable after it lands in a project.
 */

export interface PresetColumn {
  label: string;
  instruction: string;
  answerType: AnswerType;
  unit?: string;
  options?: string[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  columns: PresetColumn[];
}

export const PRESETS: Preset[] = [
  {
    id: "literature-review",
    name: "General literature review",
    description: "Works for most disciplines: what was asked, how, on whom, and what the authors claim.",
    columns: [
      {
        label: "Research question",
        instruction: "What question or hypothesis does this paper set out to answer? Quote the authors' own framing.",
        answerType: "text",
      },
      {
        label: "Method",
        instruction: "What method or study design was used? Name it as the authors name it.",
        answerType: "text",
      },
      {
        label: "Data / population",
        instruction:
          "What data or population was studied — sample size, source, and selection criteria where stated?",
        answerType: "text",
      },
      {
        label: "Main findings",
        instruction:
          "What do the authors report as their main result? Keep any effect size or statistic with the conditions it was measured under.",
        answerType: "text",
      },
      {
        label: "Author-stated limitations",
        instruction:
          "Which limitations do the AUTHORS state? Only what they say themselves — do not add your own critique.",
        answerType: "text",
      },
    ],
  },
  {
    id: "ml-comparison",
    name: "ML model comparison",
    description: "For comparing model papers, with the conditions that decide whether numbers are comparable at all.",
    columns: [
      {
        label: "Method / backbone",
        instruction: "Name the architecture or backbone and the configuration the headline result used.",
        answerType: "text",
      },
      {
        label: "Training data",
        instruction: "Which dataset and split was the model trained on? Include extra or unlabelled data.",
        answerType: "text",
      },
      {
        label: "Supervision",
        instruction: "Is training supervised, self-supervised, distilled, or a mixture?",
        answerType: "categorical",
        options: ["Supervised", "Self-supervised", "Self-distilled", "Mixed", "Unclear"],
      },
      {
        label: "Evaluation dataset / split",
        instruction:
          "Which dataset AND split were the headline numbers measured on? Validation and test are not interchangeable.",
        answerType: "text",
      },
      {
        label: "Metric and aggregation",
        instruction:
          "Which metric is reported, and how is it aggregated (per clip, per video, macro, micro)? Quote the definition if the paper gives one.",
        answerType: "text",
      },
      {
        label: "Input configuration",
        instruction: "Input resolution, sequence length, frames per clip, or context window as reported.",
        answerType: "text",
      },
      {
        label: "Runtime conditions",
        instruction:
          "Reported latency or throughput AND the hardware it was measured on. A datacentre GPU number is not an embedded number.",
        answerType: "text",
      },
      {
        label: "Reported result",
        instruction:
          "The headline number, with its unit and the configuration it was measured under. If several operating points are reported, say so instead of choosing one.",
        answerType: "number",
        unit: "%",
      },
    ],
  },
];

export const BLANK_COLUMN: PresetColumn = {
  label: "New column",
  instruction: "What should be extracted from each paper for this column?",
  answerType: "text",
};
