"""Build the Nib Board twice: dist/Board.html (one offline file: fonts and Nib inlined) and
dist/artifact/board.html (fonts from Google Fonts, Nib inline)."""
import base64, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NPM = os.environ.get('NIB_NPM', os.path.join(ROOT, 'demo', 'node_modules'))


def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()


def font_faces():
    faces = [('DM Sans', 'dm-sans', w) for w in (400, 500, 600)] + [('DM Serif Display', 'dm-serif-display', 400)]
    return '\n'.join(f'@font-face{{font-family:"{fam}";font-style:normal;font-weight:{w};font-display:swap;'
                     f'src:url(data:font/woff2;base64,{b64(f"{NPM}/@fontsource/{slug}/files/{slug}-latin-{w}-normal.woff2")}) format("woff2")}}'
                     for fam, slug, w in faces)


def main():
    tpl = open(os.path.join(HERE, 'template.html')).read()
    nib = open(os.path.join(ROOT, 'dist', 'nib.js')).read().replace('</script', '<\\/script')
    board = open(os.path.join(HERE, 'board.js')).read().replace('</script', '<\\/script')
    base = tpl.replace('/*BOARD_SCRIPT*/', board).replace('/*ENGINE*/', nib)
    off = base.replace('/*FONT_FACES*/', font_faces()).replace('<!--FONT_LINK-->', '')
    off = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           + off.replace('<div class="board"', '</head>\n<body>\n<div class="board"', 1) + '\n</body>\n</html>\n')
    open(os.path.join(ROOT, 'dist', 'Board.html'), 'w').write(off)
    link = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap">')
    art = base.replace('/*FONT_FACES*/', '').replace('<!--FONT_LINK-->', link)
    os.makedirs(os.path.join(ROOT, 'dist', 'artifact'), exist_ok=True)
    open(os.path.join(ROOT, 'dist', 'artifact', 'board.html'), 'w').write(art)
    print('Board.html', len(off) // 1024, 'KB;  artifact', len(art) // 1024, 'KB')


if __name__ == '__main__':
    main()
