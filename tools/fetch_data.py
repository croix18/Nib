"""Make the data sets the tests and training read (training/scratch/data, git-ignored): `npm run data`.

  python3 tools/fetch_data.py [--force]

  1. clones the CROHME sources of training/README.md §1 into training/scratch/raw (shallow, at the commits below),
     when a set made from them is missing
  2. training/parse_crohme.py over CROHME 2019 -> train.jsonl, valid.jsonl, test.jsonl (2019 train, 2014 test,
     2019 test); test.jsonl is checked by its SHA-256: it is the one test/school_synth.jsonl was composed from
  3. the 2012 and 2013 test sets out of CROHME_extractor's CROHME_full_v2.zip -> t12.jsonl, t13.jsonl
  4. the owner's Board writing from the committed fixtures -> board.jsonl (training/README.md §2c)
  5. test/stress.js over test/school_synth.jsonl -> stress_*.jsonl (the composed set written messily), and
     test/compose.js over t13.jsonl -> synth_t13.jsonl (the tuning copy of the composed set, training/README.md §4)

Each step is skipped when what it makes is already there; --force makes everything again. Needs git, node and
python3 (standard library only). NIB_SCRATCH moves training/scratch, as for the training scripts
(then point the tests at its data with NIB_DATA=$NIB_SCRATCH/data/)."""
import glob, hashlib, os, shutil, subprocess, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRATCH = os.environ.get('NIB_SCRATCH', os.path.join(ROOT, 'training', 'scratch'))
RAW, DATA = os.path.join(SCRATCH, 'raw'), os.path.join(SCRATCH, 'data')
FORCE = '--force' in sys.argv[1:]

SOURCES = [  # (folder in raw/, repository, commit)
    ('crohme2019', 'https://github.com/Mahdiyeh-Asgharpour/CROHME2019', '942c7f15d80a327e0f22c5afae4f2e6c13cee07f'),
    ('crohme_extractor', 'https://github.com/ThomasLech/CROHME_extractor', 'ca2d9328b8ad4dabec94587d8f98f94851ff3a49'),
]
# test.jsonl as test/compose.js makes the committed test/school_synth.jsonl from it, byte for byte
TEST_SHA256 = 'c6bddb277fcd6945791dfd6647509c41f82433f0296b26fd975dfcfdc418b137'
# the 2012 and 2013 test sets inside CROHME_full_v2.zip
OLD_TESTS = [('t12', 'CROHME_full_v2/CROHME2012_data/testDataGT/'), ('t13', 'CROHME_full_v2/CROHME2013_data/TestINKMLGT/')]
STRESS = ['reverse', 'order', 'delayed', 'mouse', 'finger', 'slope', 'drift', 'mixed']


def fail(msg):
    sys.exit('fetch_data.py: ' + msg)


def run(*cmd, **kw):
    r = subprocess.run(cmd, **kw)
    if r.returncode:
        fail('failed: ' + ' '.join(cmd))
    return r


def have(*names):
    return not FORCE and all(os.path.exists(os.path.join(DATA, n)) for n in names)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def clone(name, url, commit):
    d = os.path.join(RAW, name)
    if os.path.isdir(os.path.join(d, '.git')):
        head = subprocess.run(['git', '-C', d, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        if head == commit:
            print(f'  {os.path.relpath(d, SCRATCH)}: there')
            return d
        print(f'  {os.path.relpath(d, SCRATCH)}: at {head[:12] or "nothing"}, not {commit[:12]}: cloning again')
    shutil.rmtree(d, ignore_errors=True)
    print(f'  {os.path.relpath(d, SCRATCH)}: cloning {url}')
    run('git', 'init', '-q', d)
    run('git', '-C', d, 'fetch', '-q', '--depth', '1', url, commit)
    run('git', '-C', d, 'checkout', '-q', 'FETCH_HEAD')
    return d


def crohme2019():
    if have('train.jsonl', 'valid.jsonl', 'test.jsonl'):
        print('  train, valid, test.jsonl: there')
    else:
        src = clone(*SOURCES[0])
        tmp = os.path.join(DATA, '.parse')
        shutil.rmtree(tmp, ignore_errors=True)
        run(sys.executable, '-I', os.path.join(ROOT, 'training', 'parse_crohme.py'), os.path.join(src, 'crohme2019', 'crohme2019'), tmp)
        for n in ('train.jsonl', 'valid.jsonl', 'test.jsonl'):
            os.replace(os.path.join(tmp, n), os.path.join(DATA, n))
        os.rmdir(tmp)
    got = sha256(os.path.join(DATA, 'test.jsonl'))
    if got != TEST_SHA256:
        fail(f'test.jsonl is not the one test/school_synth.jsonl was composed from (sha256 {got[:16]}…, want {TEST_SHA256[:16]}…). '
             'If training/parse_crohme.py was changed on purpose, check test/compose.js still makes test/school_synth.jsonl '
             'from it and update TEST_SHA256; otherwise run this again with --force')


def old_tests():
    if have(*(n + '.jsonl' for n, _ in OLD_TESTS)):
        print('  t12, t13.jsonl: there')
        return
    src = clone(*SOURCES[1])
    sys.argv = ['parse_crohme.py', '', '']   # parse_crohme reads its arguments when it is imported
    sys.path.insert(0, os.path.join(ROOT, 'training'))
    import json
    import xml.etree.ElementTree as ET
    import parse_crohme
    out = os.path.join(RAW, 'crohme_full')
    with zipfile.ZipFile(os.path.join(src, 'data', 'CROHME_full_v2.zip')) as z:
        for name, folder in OLD_TESTS:
            members = [m for m in z.namelist() if m.startswith(folder) and m.endswith('.inkml')]
            z.extractall(out, members)
            n = ok = 0
            part = os.path.join(DATA, name + '.jsonl.part')
            with open(part, 'w') as fo:
                for f in sorted(glob.glob(os.path.join(out, folder, '*.inkml'))):
                    n += 1
                    try:
                        r = parse_crohme.parse_file(f)
                    except ET.ParseError:
                        continue
                    ok += r['tree'] is not None
                    r['split'] = name
                    fo.write(json.dumps(r, separators=(',', ':')) + '\n')
            os.replace(part, os.path.join(DATA, name + '.jsonl'))
            print(f'  {name}.jsonl: {n} files, {ok} trees')


def board():
    if have('board.jsonl'):
        print('  board.jsonl: there')
        return
    fx = sorted(glob.glob(os.path.join(ROOT, 'test', 'fixtures', 'training_2026-11-07*.json')))
    part = os.path.join(DATA, 'board.part.jsonl')
    run(sys.executable, '-I', os.path.join(ROOT, 'tools', 'training_to_jsonl.py'), *fx, part, '--repeat-fixed', '3')
    os.replace(part, os.path.join(DATA, 'board.jsonl'))


def stress():
    if have(*(f'stress_{v}.jsonl' for v in STRESS)):
        print('  stress_*.jsonl: there')
        return
    run('node', os.path.join(ROOT, 'test', 'stress.js'), os.path.join(ROOT, 'test', 'school_synth.jsonl'), os.path.join(DATA, 'stress_'))


def synth_t13():
    if have('synth_t13.jsonl'):
        print('  synth_t13.jsonl: there')
        return
    part = os.path.join(DATA, 'synth_t13.part.jsonl')
    run('node', os.path.join(ROOT, 'test', 'compose.js'), env=dict(os.environ, POOL=os.path.join(DATA, 't13.jsonl'), OUT=part))
    os.replace(part, os.path.join(DATA, 'synth_t13.jsonl'))


def main():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)
    print('data sets in', DATA)
    crohme2019()
    old_tests()
    board()
    stress()
    synth_t13()
    print('done')


if __name__ == '__main__':
    main()
