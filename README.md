# Nib training checkpoints (model v4s50)

The float checkpoints and small models behind the recognizer Nib ships (1.5.3 to 1.6.6, `cnn.id` d74ed302a03a).
This branch shares no history with `main` and is not needed to build or run Nib: `model/nib-data.json` on `main`
is enough for that. It is what fine-tuning a new model starts from.

On `main`, `npm run checkpoints` puts these files in `training/scratch/work/`.

| File | What |
| --- | --- |
| `model_v3.npz.ckpt` | v3, trained on CROHME: full training checkpoint (weights, batch-norm state, optimizer state, RNG, epoch). `train_v4.py` starts from it |
| `model_v4.npz.ckpt` | v4: v3 fine-tuned on Croix's drill writing from the Board, 7 Nov 2026 |
| `model_v4s50.npz` | the shipped weights: halfway between v3 and v4 (`soup_v4.py`) |
| `ep/classes.txt` | the classifier's classes |
| `geo_models_v2.json`, `lm_v2.json`, `prior.json` | the stroke-join and layout models, the context model, the school prior |
| `board_split.json` | the hold-out split of the Board writing used for v4 |

Checked on 14 Nov 2026: the two checkpoints blended at 0.5 give `model_v4s50.npz` exactly, and
`tools/freeze_model.py` on these files gives `model/nib-data.json` byte for byte.

The two `.ckpt` files are pickles written by `train_v4.py` (numpy and optax objects). Load only these, and only after
`sha256sum -c SHA256SUMS` passes.
