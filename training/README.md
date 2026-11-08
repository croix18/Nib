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

## 2b. Fine-tune for messy writing (v3)

```sh
python3 make_epochs_v3.py 4 2      # v2's augmentation plus strokes drawn backwards, the strokes of a symbol in another
                                   # order, mouse-like sparse points and finger-like wobble (aug3.py)
                                   # -> scratch/work/ep3/valid_aug.npz and train_aug1..4.npz
python3 train_v3.py                # 6 epochs from the v2 checkpoint, alternating ep3 and ep2 epochs, one of them clean
                                   # -> scratch/work/model_v3.npz (checkpoints every epoch and resumes)
```

On the 2013 writers' held-out symbols v3 keeps v2's accuracy on clean ink (90.4%) and reads the same symbols
rewritten messily much better (87.4% vs 82.0%); `python3 ../build.py` now builds from `model_v3.npz` by default.
Check the int8 engine against the float model with `node ../test/parity.js scratch/work/model_v3.npz`
(299/300 top-1 agreement, largest probability difference 0.011).

## 2c. The owner's own hand (v4, shipped in 1.5.3 as a blend)

```sh
python3 -I ../tools/training_to_jsonl.py ../test/fixtures/training_2026-11-07*.json scratch/data/board.jsonl --repeat-fixed 3
python3 make_epochs_v4.py split                    # hold-out split -> scratch/work/board_split.json
python3 make_epochs_v4.py samples                  # his checked symbols + junk -> scratch/work/samples_board_v4.pkl
python3 make_epochs_v4.py epochs 5 2 24 135000     # 5 epochs: 24 renderings of each of his samples + 135k CROHME anchor
python3 train_v4.py scratch/work/model_v4.npz 5 2e-4   # from the v3 checkpoint; evaluates his held-out symbols per epoch
python3 soup_v4.py scratch/work/model_v3.npz.ckpt scratch/work/model_v4.npz.ckpt 0.5 scratch/work/model_v4s50.npz
NIB=../dist/nib.js node eval_board.js              # his drill rows through the engine, held-out and trained
```

Data: the Board's training drill (Croix, S Pen and finger on a Galaxy Tab S9+, four files, 7 Nov 2026). Only rows
whose labels he checked are used: gold rows (verified, and read as the prompt) and verified rows with a Fix.
**Held out:** every drill item that is a multiple of 5 (items 5, 10, …, 60: 13 expressions, 93 symbols); no record
of those items is ever trained on. Keep that rule in every later round, or the before/after numbers mean nothing.
Training: 47 expressions, 348 symbols and 188 junk groups, about 8.7% of each epoch.

The fine-tune alone (`model_v4.npz`) read his hand better but cost the school set two expressions (70.3% →
70.0%) — mostly a handwritten × read as x, which his drill teaches (every cross he writes is the letter) — and a
gentler second run (`model_v4b.npz`: 12 copies, lr 1e-4, 3 epochs) did worse there (69.2%). What shipped is the
straight line halfway between v3 and v4 in weight space (`soup_v4.py`, WiSE-FT): every parameter and batch-norm
statistic `0.5·v3 + 0.5·v4`, folded as usual. Measured against v3 (dist built from `model_v3.npz`):

| | v3 | v4 (fine-tune) | v4s50 (shipped) |
|---|---|---|---|
| his held-out drill items, exact | 11/13 | 12/13 | 12/13 |
| his held-out symbols | 90/93 | 91/93 | 91/93 |
| his trained items, exact / symbols | 43/47, 340/348 | 44/47, 345/348 | 44/47, 342/348 |
| school set (2019 writers, real) | 70.3% (384/546) | 70.0% (382) | 70.3% (384) |
| composed school set | 90.6% | 91.0% | 90.6% |
| full 2019 test set | 55.9% (663/1187) | 55.6% | 55.6% (660; 9 new misses, 3 of them × read as x, 6 fixed) |
| int8 parity | 299/300 | 300/300 | 299/300, largest difference 0.018 |

Records he had to Fix, read raw by v4s50: 69+96 and 3.14·2 (both held out), 46·9 and 4x+4−x now read right;
17+71 still reads 17+7) and the large 144·69 reads H4·69 (v4 alone read it right). Still wrong among his
drill items: 1(1+1)= (his 1s as bars, held out), 10³·10⁻¹ (a 1 as a bar), g+g+g (his g as 9).
`python3 ../build.py` builds from `model_v4s50.npz` by default.

## 3. Geometry and context models

```sh
python3 geo_models_v2.py           # stroke-join and layout-relation MLPs -> scratch/work/geo_models_v2.json
python3 lm_v2.py                   # bigram model over layout rows + synthetic school corpus -> scratch/work/lm_v2.json
python3 prior.py                   # school-vs-CROHME symbol frequency ratios -> scratch/work/prior.json
```

## 4. Build and measure

```sh
python3 ../build.py scratch/work/model_v3.npz   # -> dist/nib.js (the default)
node ../test/eval.js test full school       # exact-match rate on the reported test set (real expressions)
node ../test/eval_synth.js                  # the composed middle-school set (2019 test writers)
POOL=scratch/data/t13.jsonl OUT=scratch/data/synth_t13.jsonl node ../test/compose.js   # tuning copy (2013 writers)
node ../test/tune_all.js '{"lm":[0.2,0.35,0.5]}'   # tune knobs on both tuning sets
```
