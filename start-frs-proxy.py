import os
import sys
import subprocess
from pathlib import Path

def parse_env(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        k, v = line.split('=', 1)
                        os.environ[k.strip()] = v.strip().strip("'\"")
    except Exception as e:
        print(f"[frs-proxy] Warning: Failed to parse .env file: {e}", file=sys.stderr)

def main():
    backend_root = Path(__file__).resolve().parent.parent
    env_path = backend_root / '.env'
    repo_root = backend_root.parent.parent

    if env_path.exists():
        parse_env(env_path)

    proxy_toggle = os.environ.get('FRS_BAP_PROXY_ENABLED', '').strip().lower()
    force_proxy = proxy_toggle in ['1', 'true', 'yes', 'on', 'required']
    skip_proxy = proxy_toggle in ['0', 'false', 'no', 'off']

    if skip_proxy:
        print('[frs-proxy] Disabled via FRS_BAP_PROXY_ENABLED. Skipping proxy startup.')
        sys.exit(0)

    api_key = os.environ.get('FRS_BAP_GEMINI_API_KEY') or os.environ.get('GEMINI_API_KEY')
    if not api_key:
        msg = '[frs-proxy] Missing API key. Set FRS_BAP_GEMINI_API_KEY (or GEMINI_API_KEY) in apps/backend/.env'
        if force_proxy:
            print(f"{msg}. FRS_BAP_PROXY_ENABLED is forcing startup, so exiting.", file=sys.stderr)
            sys.exit(1)
        print(f"{msg}. Skipping proxy startup for local development.")
        sys.exit(0)

    os.environ['FRS_BAP_GEMINI_API_KEY'] = api_key
    os.environ['FRS_BAP_PROXY_PORT'] = os.environ.get('FRS_BAP_PROXY_PORT') or os.environ.get('GEMINI_PROXY_PORT') or '3011'

    runtime_root = repo_root
    proxy_script_path_py = runtime_root / 'srs_to_bap_srs.py'
    proxy_script_path_js = runtime_root / 'srs-to-bap-srs.js'

    def ensure_frs_runtime_deps():
        runtime_packages = ['docx', 'pdf-lib', '@pdf-lib/fontkit']
        required_modules = [
            runtime_root / 'node_modules' / 'docx' / 'package.json',
            runtime_root / 'node_modules' / 'pdf-lib' / 'package.json',
            runtime_root / 'node_modules' / '@pdf-lib' / 'fontkit' / 'package.json',
        ]

        all_present = all(p.exists() for p in required_modules)
        if all_present:
            return

        if not (runtime_root / 'package.json').exists():
            print(f"[frs-proxy] package.json not found at {runtime_root}", file=sys.stderr)
            sys.exit(1)

        print('[frs-proxy] Installing missing runtime dependencies for proxy scripts (docx/pdf-lib)...')
        npm_cmd = 'npm.cmd' if sys.platform == 'win32' else 'npm'
        args = [npm_cmd, 'install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund'] + runtime_packages
        
        try:
            install = subprocess.run(args, cwd=str(runtime_root), shell=(sys.platform == 'win32'))
            if install.returncode != 0:
                print('[frs-proxy] Failed to install runtime dependencies.', file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"[frs-proxy] Failed to execute npm install: {e}", file=sys.stderr)
            sys.exit(1)

    ensure_frs_runtime_deps()

    # Determine which script to run
    proxy_script_path = None
    args = []
    if proxy_script_path_py.exists():
        proxy_script_path = proxy_script_path_py
        args = [sys.executable, str(proxy_script_path)]
    elif proxy_script_path_js.exists():
        proxy_script_path = proxy_script_path_js
        node_cmd = 'node.exe' if sys.platform == 'win32' else 'node'
        args = [node_cmd, str(proxy_script_path)]
    else:
        print(f"[frs-proxy] Proxy script not found. Looked for .py and .js locally at {runtime_root}", file=sys.stderr)
        sys.exit(1)

    print(f"[frs-proxy] Starting proxy on port {os.environ['FRS_BAP_PROXY_PORT']} using {proxy_script_path.name}")
    
    try:
        proc = subprocess.Popen(args, env=os.environ.copy())
        proc.wait()
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        sys.exit(130)
    except Exception as e:
        print(f"[frs-proxy] Failed to start proxy: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
