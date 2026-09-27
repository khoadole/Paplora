/**
 * The sample project's documents.
 *
 * These are ORIGINAL fictional papers written for this demo. They are not real
 * publications, the numbers are invented, and every page carries a visible
 * "Demo document — not a scientific publication" banner. Nothing here is
 * attributed to a real model, author or benchmark.
 *
 * scripts/make-samples.ts renders these lines into public/samples/*.pdf, and
 * lib/sample/data.ts quotes from the same lines — so the fixtures and the PDFs
 * cannot drift apart.
 */

export interface SampleDoc {
  slug: string;
  title: string;
  filename: string;
  pages: string[][];
}

const BANNER = "Demo document — not a scientific publication";

export const SAMPLE_DOCS: SampleDoc[] = [
  {
    slug: "framelite",
    title: "FrameLite: lightweight clip sampling for on-device action recognition",
    filename: "demo-framelite.pdf",
    pages: [
      [
        BANNER,
        "",
        "FrameLite: lightweight clip sampling for on-device",
        "action recognition",
        "",
        "A. Demo, B. Example — Institute of Fictional Computing",
        "",
        "Abstract",
        "We present FrameLite, a clip sampling scheme for action recognition on",
        "embedded hardware. FrameLite is trained on the DemoKinetics-200 training",
        "split and uses a MobileViT-S backbone with supervised labels only.",
        "",
        "1. Method",
        "The backbone is MobileViT-S, pretrained on DemoImage-1k and fine-tuned",
        "end to end. We sample 16 frames per clip at an input resolution of",
        "224x224 pixels.",
      ],
      [
        BANNER,
        "",
        "3. Results",
        "On the ED-Bench validation split FrameLite reaches 81.4% top-1 accuracy",
        "at 16 frames per clip. We did not evaluate on the held-out test split.",
        "",
        "Latency was measured on a single Jetson Orin NX at 34 ms per clip with",
        "INT8 quantisation enabled.",
        "",
        "4. Limitations",
        "The authors note that accuracy was measured on the validation split only,",
        "and that INT8 quantisation costs roughly 0.6 points of accuracy compared",
        "with the FP16 model.",
      ],
    ],
  },
  {
    slug: "motiontiny",
    title: "MotionTiny: distilled motion features for streaming video",
    filename: "demo-motiontiny.pdf",
    pages: [
      [
        BANNER,
        "",
        "MotionTiny: distilled motion features for streaming video",
        "",
        "C. Sample, D. Placeholder — Fictional Systems Lab",
        "",
        "Abstract",
        "MotionTiny distils a large teacher network into a compact student for",
        "streaming action recognition. Training uses the DemoKinetics-200 training",
        "split together with unlabelled clips from DemoStream-1M, so supervision",
        "is partly self-distilled rather than fully supervised.",
        "",
        "2. Method",
        "The student uses a ResNet-18 backbone with a temporal shift module. We",
        "sample 8 frames per clip at 168x168 pixels.",
      ],
      [
        BANNER,
        "",
        "4. Results",
        "MotionTiny reaches 79.2% top-1 accuracy on the ED-Bench test split at 8",
        "frames per clip. For reference, the teacher network reaches 84.0% top-1",
        "on the same split but is far too large for embedded deployment.",
        "",
        "We report 12 ms per clip on an NVIDIA A100 GPU. We did not measure",
        "latency on embedded hardware.",
        "",
        "5. Limitations",
        "Because the reported latency comes from a datacentre GPU, it is not",
        "comparable with numbers measured on embedded devices.",
      ],
    ],
  },
  {
    slug: "clipformer",
    title: "ClipFormer: a transformer baseline at two operating points",
    filename: "demo-clipformer.pdf",
    pages: [
      [
        BANNER,
        "",
        "ClipFormer: a transformer baseline at two operating points",
        "",
        "E. Fixture, F. Sample — Department of Invented Vision",
        "",
        "Abstract",
        "ClipFormer is a plain transformer baseline for action recognition. We",
        "train on the DemoKinetics-200 training split with supervised labels and",
        "report two operating points rather than a single configuration.",
      ],
      [
        BANNER,
        "",
        "3. Results",
        "Table 2 reports both configurations on the ED-Bench validation split.",
        "ClipFormer-B with a ViT-B backbone and 8 frames per clip reaches 77.0%",
        "top-1 accuracy. ClipFormer-L with a ViT-L backbone and 16 frames per clip",
        "reaches 83.1% top-1 accuracy.",
        "",
        "We do not report inference latency in this version of the paper.",
        "",
        "4. Limitations",
        "Both configurations were trained with the same recipe, so the comparison",
        "between them is internally consistent but says nothing about runtime cost.",
      ],
    ],
  },
];
