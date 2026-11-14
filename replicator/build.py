"""Build the Replicator twice: dist/Replicator.html (one offline file: fonts, Nib and the app inlined) and
dist/artifact/replicator.html (fonts from Google Fonts, no Nib, the rest inline)."""
import base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# npm packages: NIB_NPM, else the root node_modules (npm ci), else demo/node_modules (where they were installed before package.json)
NPM = os.environ.get('NIB_NPM') or next((p for p in (os.path.join(ROOT, 'node_modules'), os.path.join(ROOT, 'demo', 'node_modules'))
                                         if os.path.isdir(p)), os.path.join(ROOT, 'node_modules'))


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def font_faces():
    faces = [('DM Sans', 'dm-sans', w) for w in (400, 500, 600, 700)] + [('DM Serif Display', 'dm-serif-display', 400)] + \
            [('DM Mono', 'dm-mono', w) for w in (400, 500)]
    return '\n'.join(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{w};font-display:swap;'
                     f'src:url(data:font/woff2;base64,{b64(f"{NPM}/@fontsource/{slug}/files/{slug}-latin-{w}-normal.woff2")}) format("woff2")}}'
                     for fam, slug, w in faces)


def main():
    tpl = open(os.path.join(HERE, 'template.html')).read()
    core = open(os.path.join(HERE, 'core.js')).read().replace('</script', '<\\/script')
    nib = open(os.path.join(ROOT, 'dist', 'nib.js')).read().replace('</script', '<\\/script')
    base = tpl.replace('/*CORE_JS*/', core)

    # the offline file carries Nib, so "Teach Nib" can fill the memory every local Nib tool shares
    off = base.replace('<!--NIB_JS-->', f'<script>{nib}</script>').replace('/*FONT_FACES*/', font_faces()).replace('<!--FONT_LINK-->', '')
    off = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + off.replace('<div class="app">', '</head>\n<body>\n<div class="app">', 1) + '\n</body>\n</html>\n')
    open(os.path.join(ROOT, 'dist', 'Replicator.html'), 'w').write(off)

    link = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700'
            '&family=DM+Serif+Display&display=swap">')
    # a published page's storage is its own, so it has no use for Nib
    art = base.replace('<!--NIB_JS-->', '').replace('/*FONT_FACES*/', '').replace('<!--FONT_LINK-->', link + '<script>window.REPLICATOR_PUBLISHED = true;</script>')
    os.makedirs(os.path.join(ROOT, 'dist', 'artifact'), exist_ok=True)
    open(os.path.join(ROOT, 'dist', 'artifact', 'replicator.html'), 'w').write(art)
    print('Replicator.html', len(off) // 1024, 'KB;  artifact', len(art) // 1024, 'KB')


if __name__ == '__main__':
    main()
