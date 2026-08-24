from pathlib import Path

path = Path('scripts/_tmp_v02292_patch.py')
text = path.read_text(encoding='utf-8')
marker = "\ndef replace_function(text, name, replacement, async_fn=False):\n"
helper = r'''

def function_body_brace(text, start):
    paren = text.find('(', start)
    if paren < 0:
        raise SystemExit('function parameter list not found')
    depth = 0
    quote = None
    escape = False
    for i in range(paren, len(text)):
        ch = text[i]
        if quote:
            if escape:
                escape = False
                continue
            if ch == '\\':
                escape = True
                continue
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', '`'):
            quote = ch
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                brace = text.find('{', i + 1)
                if brace < 0:
                    raise SystemExit('function body brace not found')
                return brace
    raise SystemExit('function parameter list did not close')
'''
if 'def function_body_brace' not in text:
    if marker not in text:
        raise SystemExit('replace_function marker not found')
    text = text.replace(marker, helper + marker, 1)
count = text.count("    brace = text.find('{', start)\n")
if count != 2:
    raise SystemExit(f'expected 2 brace finder lines, found {count}')
text = text.replace("    brace = text.find('{', start)\n", "    brace = function_body_brace(text, start)\n")
path.write_text(text, encoding='utf-8')
print('temporary patch parser fixed')
