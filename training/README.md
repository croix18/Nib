# Retraining Nib

Everything here runs on a CPU (the shipped model was trained on two cores). Scratch data lives in
`training/scratch/` (git-ignored); point the scripts elsewhere with `NIB_SCRATCH=/path`.

## 1. Data

```sh
git clone --depth 1 https://github.com/Mahdiyeh-Asgharpour/CROHME2019 raw/crohme2019        # 2019 train / 2014 test / 2019 test
git clone --depth 1 https://github.com/ThomasLech/CROHME_extractor raw/crohme_extractor     # has the 2012 and 2013 test sets
python3 parse_crohme.py raw/crohme2019/crohme2019/crohme2019 scratch/data                    # -> train/valid/test.jsonl
# 2012 and 2013 test sets: unzip CROHME_full_v2.zip, take testDataGT/ and TestINKMLGT/,
# and run parse_crohme.parse_file over them into scratch/data/t12.jsonl and t13.jsonl
```

Splits used: train = 2019 train + 2014 test (`valid`) + 2012 test (`t12`); tuning = 2013 test (`t13`) and
the school set composed from the 2013 writers; reported test = 2019 test (`test`) and the school set composed
from the 2019 test writers (`test/school_synth.jsonl`), never trained or tuned on.

## 2. Symbol classifier (v2)

```sh
python3 build_samples_v2.py        # symbols, junk stroke groups, mirrored and synthetic samples -> scratch/work/samples_v2.pkl
python3 make_epochs_v2.py 6 2      # 6 augmented epochs + a clean one -> scratch/work/ep2/*.npz (about 5 GB)
python3 train_v2.py 14 6           # ~2 h on 2 cores -> scratch/work/model_v2.npz; checkpoints every epoch and resumes
```

`raster.py` and `online.py` must stay in step with `rasterize()` and `onlineFeatures()` in `src/core.js`
(check with `test/np_forward_v2.py` against the built engine).

## 3. Geometry and context models

```sh
python3 geo_models_v2.py           # stroke-join and layout-relation MLPs -> scratch/work/geo_models_v2.json
python3 lm_v2.py                   # bigram model over layout rows + synthetic school corpus -> scratch/work/lm_v2.json
python3 prior.py                   # school-vs-CROHME symbol frequency ratios -> scratch/work/prior.json
```

## 4. Build and measure

```sh
python3 ../build.py scratch/work/model_v2.npz   # -> dist/nib.js
node ../test/eval.js test full school       # exact-match rate on the reported test set (real expressions)
node ../test/eval_synth.js                  # the composed middle-school set (2019 test writers)
POOL=scratch/data/t13.jsonl OUT=scratch/data/synth_t13.jsonl node ../test/compose.js   # tuning copy (2013 writers)
node ../test/tune_all.js '{"lm":[0.2,0.35,0.5]}'   # tune knobs on both tuning sets
```
