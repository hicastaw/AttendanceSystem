"""Read-only syntax/model checks. Never imports config or opens application DBs."""
import ast
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def main():
    # Explicit exclusions also work in release archives without the root .gitignore.
    excluded=['-g','!**/node_modules/**','-g','!**/.venv/**','-g','!**/__pycache__/**','-g','!**/data/**']
    files=subprocess.check_output(['rg','--files',*excluded,'-g','*.py','-g','*.js','-g','*.mjs','-g','*.sh'],cwd=ROOT,text=True).splitlines()
    counts={'python':0,'javascript':0,'bash':0,'onnx':0}
    bash=shutil.which('bash') if sys.platform!='win32' else r'C:\Program Files\Git\bin\bash.exe'
    for relative in files:
        path=ROOT/relative
        if path.suffix=='.py':
            ast.parse(path.read_text(encoding='utf-8-sig'),filename=relative);counts['python']+=1
        elif path.suffix in ('.js','.mjs'):
            subprocess.run(['node','--check',str(path)],check=True,cwd=ROOT);counts['javascript']+=1
        elif path.suffix=='.sh':
            subprocess.run([bash,'-n',str(path)],check=True,cwd=ROOT);counts['bash']+=1
    import onnx
    # Source archives have no Git metadata. Model discovery must not require Git.
    models=subprocess.check_output(['rg','--files',*excluded,'-g','*.onnx'],cwd=ROOT,text=True).splitlines()
    for relative in models:
        onnx.checker.check_model(onnx.load(str(ROOT/relative)));counts['onnx']+=1
    print('PASS:',counts,'(syntax/graph only; no R50/Hailo/hardware claims)')


if __name__=='__main__':main()
