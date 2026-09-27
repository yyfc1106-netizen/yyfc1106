# Paper navigation

Use exact headings to locate current line numbers. Read relevant passages, not both complete documents. This index locates evidence; it does not summarize findings.

## Main paper — [paper.md](paper.md)

| Exact heading | Look here for |
| --- | --- |
| ABSTRACT | Summary of the method and claims |
| 1 INTRODUCTION | Motivation: collapse in joint-embedding self-supervised learning and contributions |
| 2 VICREG: INTUITION | Intuition for the variance, invariance and covariance terms; Figure 1 architecture |
| 3 RELATED WORK | Contrastive, clustering, distillation and information-maximization methods |
| 4 VICREG: DETAILED DESCRIPTION | Parent section for method and implementation |
| 4.1 METHOD | Loss definitions, Equations 1-6 |
| 4.2 IMPLEMENTATION DETAILS | Coefficients, architecture, optimizer and training schedule |
| 5 RESULTS | Parent section for ImageNet, transfer and multi-modal results |
| 5.1 EVALUATION ON IMAGENET | Linear and semi-supervised ImageNet results (Table 1) |
| 5.2 TRANSFER TO OTHER DOWNSTREAM TASKS | Places205, VOC07, iNat18, detection and segmentation transfer (Table 2) |
| 5.3 MULTI-MODAL PRETRAINING ON MS-COCO | Image-text retrieval (Table 3) |
| 6 ANALYSIS | Adding variance/covariance terms to other methods, weight sharing (Tables 4-5) |
| 7 CONCLUSION | Conclusions and limitations |
| REFERENCES | Bibliography |
| A ALGORITHM | Algorithm 1 PyTorch pseudocode of the loss |
| B RELATION TO OTHER SELF-SUPERVISED METHODS | Comparison with Barlow Twins, W-MSE, BYOL, SimSiam, SimCLR, SwAV (Figure 2) |
| C ADDITIONAL IMPLEMENTATION DETAILS | Augmentations, evaluation and transfer protocols |
| D ADDITIONAL RESULTS | Ablations: architectures, ESC-50 audio, k-NN, loss coefficients, normalization, expander size, batch size, BYOL/SimSiam (Tables 6-13, Figure 3) |
| E RUNNING TIME | Time and memory comparison (Table 14); feature statistics (Figures 4-5) |

For long sections, search a narrower subsection or prompt. Headings inside fenced quotations are source content, not document section boundaries.

## Supplementary information — [supplement.md](supplement.md)

| Exact heading | Look here for |
| --- | --- |
| Document beginning | Source text or supplied-material notes |

For long sections, search a narrower subsection or prompt. Headings inside fenced quotations are source content, not document section boundaries.

## Assets

Figure and table captions in the documents link to the files below. Open only the needed image; for a table, read its header and relevant rows first.

- `assets/figure/`: main figures (JPEG).
- `assets/supp_figs/`: supplementary and extended-data figures (JPEG).
- `assets/table/`: main tables (CSV, or JPEG when transcription is unreliable).
- `assets/supp_table/`: supplementary tables (CSV, or JPEG fallback).

Asset paths are relative to the skill root. CSVs retain internal blank rows; captions and merged headers may also occupy rows. Consult the document notes before treating every row as data.
