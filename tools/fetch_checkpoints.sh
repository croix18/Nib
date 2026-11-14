#!/usr/bin/env bash
# Put the training checkpoints (the `checkpoints` branch: float checkpoints, classes, the small models) in
# training/scratch/work/, where train_v4.py, soup_v4.py and tools/freeze_model.py look. Not needed to build or test Nib.
set -euo pipefail
cd "$(dirname "$0")/.."
W=${NIB_WORK:-${NIB_SCRATCH:-training/scratch}/work}
mkdir -p "$W"
git fetch -q --depth 1 origin checkpoints
git archive FETCH_HEAD | tar -x -C "$W"
(cd "$W" && sha256sum -c --quiet SHA256SUMS)
echo "checkpoints in $W (checked against SHA256SUMS)"
