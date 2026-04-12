import subprocess
import sys
import os
import signal
import time

def main():
    watch_mode = '--watch' in sys.argv
    npm_cmd_str = 'npm.cmd' if sys.platform == 'win32' else 'npm'
    
    proxy_toggle = os.environ.get('FRS_BAP_PROXY_ENABLED', '').strip().lower()
    skip_proxy = proxy_toggle in ['0', 'false', 'no', 'off']
    
    backend_args = ['run', 'start:dev:api'] if watch_mode else ['run', 'start:api']
    proxy_args = ['run', 'start:frs-proxy']
    
    # Spawn backend
    backend = subprocess.Popen(
        f"{npm_cmd_str} " + " ".join(backend_args), 
        shell=True, 
        env=os.environ.copy()
    )
    
    # Spawn proxy if not skipped
    proxy = None
    if not skip_proxy:
        proxy = subprocess.Popen(
            f"{npm_cmd_str} " + " ".join(proxy_args), 
            shell=True, 
            env=os.environ.copy()
        )
        
    exiting = False
    
    def shutdown(signum, frame):
        nonlocal exiting
        if exiting:
            return
        exiting = True
        
        if backend.poll() is None:
            backend.terminate()
            
        if proxy and proxy.poll() is None:
            proxy.terminate()
            
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    
    def handle_exit(name, code):
        nonlocal exiting
        if exiting:
            return
            
        if name == 'frs-proxy':
            if code == 0:
                print('[start-with-proxy] frs-proxy is disabled or skipped. Backend continues.')
                return
            
            print(f'[start-with-proxy] {name} exited with code {code}', file=sys.stderr)
            shutdown(None, None)
            sys.exit(code if code is not None else 1)
            
        if code != 0:
            print(f'[start-with-proxy] backend exited with code {code}', file=sys.stderr)
            
        shutdown(None, None)
        sys.exit(code if code is not None else 0)

    try:
        while True:
            if backend.poll() is not None:
                handle_exit('backend', backend.returncode)
                break
                
            if proxy and proxy.poll() is not None:
                code = proxy.returncode
                if code == 0:
                    print('[start-with-proxy] frs-proxy is disabled or skipped. Backend continues.')
                    proxy = None
                else:
                    handle_exit('frs-proxy', code)
                    break
                    
            time.sleep(0.5)
    except KeyboardInterrupt:
        shutdown(None, None)
        sys.exit(130)

if __name__ == '__main__':
    main()
