# model/

`nib-data.json` is the data `build.py` puts into `dist/nib.js` in place of `/*__DATA__*/ null` (`src/core.js`), byte
for byte as it is embedded: compact JSON, one line. With it the engine builds from a clone with nothing but Python's
standard library (`python3 build.py`).

What is in it:

- `classes`: the symbol classifier's 104 classes
- `cnn`: the classifier, quantized to int8 (`q`, with per-channel scales `s` and float biases `b`, base64), its `layout`,
  and `id` = `d74ed302a03a` (the first 12 hex digits of the SHA-1 of the int8 weights and scales)
- `join`, `rel`: the stroke-join and layout-relation MLPs (`training/geo_models_v2.py`)
- `lm`: the context model (`training/lm_v2.py`); `prior`: the school-vs-CROHME symbol prior (`training/prior.py`)
- `tsfm`, `tsfont`: KaTeX's metrics and three of its fonts for the typeset view (SIL Open Font License 1.1,
  `licenses/OFL-KaTeX-fonts.txt`); frozen from KaTeX 0.16.11, and byte for byte the same from 0.16.47, the version
  `package.json` pins now

The classifier is `model_v4s50` (shipped in 1.5.3): v3 fine-tuned on the owner's Board drill, blended halfway back to
v3 in weight space (`training/README.md` §2c).

It is made by `tools/freeze_model.py` from the trained files in `training/scratch/work/` and KaTeX in
`node_modules/` (or `python3 build.py path/to/model.npz`, which freezes that model and then builds). The int8 weights
here cannot be trained further: fine-tuning starts from the float checkpoints (`model_v3.npz.ckpt`, `model_v4.npz.ckpt`,
`model_v4s50.npz`), which are kept with the classes and the small models on the repo's `checkpoints` branch, apart from
`main`. `npm run checkpoints` puts them in `training/scratch/work/` and checks them against their SHA-256 sums.
Checked on 14 Nov 2026: freezing those files gives this `nib-data.json` byte for byte.
