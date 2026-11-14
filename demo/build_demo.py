"""Build the Nib demo page twice: an offline single file (everything inlined) and the artifact page."""
import base64, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# npm packages: NIB_NPM, else the root node_modules (npm ci), else demo/node_modules (where they were installed before package.json)
NPM = os.environ.get('NIB_NPM') or next((p for p in (os.path.join(ROOT, 'node_modules'), os.path.join(ROOT, 'demo', 'node_modules'))
                                         if os.path.isdir(p)), os.path.join(ROOT, 'node_modules'))
KATEX_VER = '0.16.11'


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def katex_css():
    css = open(f'{NPM}/katex/dist/katex.min.css').read()
    def repl(m):
        name = m.group(1)
        return f'src:url(data:font/woff2;base64,{b64(f"{NPM}/katex/dist/fonts/{name}.woff2")}) format("woff2")'
    css = re.sub(r'src:url\(fonts/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\)(,url\([^)]*\) format\("[a-z]+"\))*', repl, css)
    assert 'url(fonts/' not in css, 'unconverted KaTeX font url'
    return css


def font_faces():
    faces = [('DM Sans', 'dm-sans', w) for w in (400, 500, 600, 700)] + [('DM Serif Display', 'dm-serif-display', 400)] + \
            [('DM Mono', 'dm-mono', w) for w in (400, 500)]
    out = []
    for fam, slug, w in faces:
        p = f'{NPM}/@fontsource/{slug}/files/{slug}-latin-{w}-normal.woff2'
        out.append(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{w};font-display:swap;'
                   f'src:url(data:font/woff2;base64,{b64(p)}) format("woff2")}}')
    return '\n'.join(out)


def main():
    tpl = open(os.path.join(HERE, 'template.html')).read()
    engine = open(os.path.join(ROOT, 'dist', 'nib.js')).read().replace('</script', '<\\/script')
    sample_path = os.path.join(HERE, 'sample.json')
    sample = open(sample_path).read().strip() if os.path.exists(sample_path) else 'null'
    kcss = katex_css()
    base = tpl.replace('/*KATEX_CSS*/', kcss).replace('/*ENGINE*/', engine).replace('/*SAMPLE*/null', sample)

    # offline: one complete HTML file, nothing fetched
    kjs = open(f'{NPM}/katex/dist/katex.min.js').read().replace('</script', '<\\/script')
    off = base.replace('/*FONT_FACES*/', font_faces()).replace('<!--FONT_LINK-->', '').replace('<!--KATEX_JS-->', f'<script>{kjs}</script>')
    off = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + off.replace('<div class="app">', '</head>\n<body>\n<div class="app">', 1) + '\n</body>\n</html>\n')
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    open(os.path.join(ROOT, 'dist', 'Nib.html'), 'w').write(off)

    # artifact: Google Fonts + KaTeX script from cdnjs; KaTeX CSS and the engine inline
    link = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700'
            '&family=DM+Serif+Display&display=swap">')
    art = base.replace('/*FONT_FACES*/', '').replace('<!--FONT_LINK-->', link).replace(
        '<!--KATEX_JS-->', f'<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/{KATEX_VER}/katex.min.js"></script>')
    os.makedirs(os.path.join(ROOT, 'dist', 'artifact'), exist_ok=True)
    open(os.path.join(ROOT, 'dist', 'artifact', 'nib.html'), 'w').write(art)
    print('Nib.html', len(off) // 1024, 'KB;  artifact', len(art) // 1024, 'KB')


if __name__ == '__main__':
    main()
