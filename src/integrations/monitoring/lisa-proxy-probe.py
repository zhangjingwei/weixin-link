#!/usr/bin/env python3
"""Verify REALITY and a randomly selected foreign HTTPS target without a bare TCP pre-probe."""
import concurrent.futures
import json
import os
from pathlib import Path
import random
import socket
import subprocess
import sys
import tempfile
import time


FOREIGN_TARGETS = (
    {
        'name': 'cloudflare-trace',
        'url': 'https://www.cloudflare.com/cdn-cgi/trace',
        'statuses': {200},
        'marker': 'loc=',
    },
    {
        'name': 'apple-success',
        'url': 'https://www.apple.com/library/test/success.html',
        'statuses': {200},
        'marker': 'success',
    },
    {
        'name': 'gstatic-204',
        'url': 'https://www.gstatic.com/generate_204',
        'statuses': {204},
        'marker': '',
    },
)
DOMESTIC_TARGETS = (
    {'name': 'baidu', 'url': 'https://www.baidu.com/'},
    {'name': 'qq', 'url': 'https://www.qq.com/'},
)


def response_matches(target, status, ssl_result, body):
    return (
        status in target['statuses']
        and ssl_result == 0
        and target['marker'].lower() in body.lower()
    )


def curl(url, proxy=None):
    command = ['curl', '--noproxy', '' if proxy else '*']
    if proxy:
        command += ['--proxy', proxy]
    command += [
        '--connect-timeout', '4',
        '--max-time', '8',
        '--silent',
        '--show-error',
        '--output', '-',
        '--write-out', '\n%{http_code} %{ssl_verify_result}',
        url,
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=10)
    try:
        body, trailer = result.stdout.rsplit('\n', 1)
        status, ssl_result = map(int, trailer.strip().split())
    except (ValueError, AttributeError):
        raise RuntimeError('CURL_RESULT_INVALID') from None
    return result.returncode, status, ssl_result, body


def domestic_access():
    """Stop foreign probes when a domestic HTTPS baseline is unavailable."""
    selected = list(DOMESTIC_TARGETS)
    random.SystemRandom().shuffle(selected)
    evidence = []
    for target in selected:
        try:
            code, status, ssl_result, body = curl(target['url'])
            ok = code == 0 and response_matches(
                {'statuses': set(range(200, 400)), 'marker': ''},
                status,
                ssl_result,
                body,
            )
            evidence.append({'target': target['name'], 'ok': ok})
            if ok:
                return {'ok': True, 'targets': evidence}
        except (OSError, RuntimeError, subprocess.SubprocessError):
            evidence.append({'target': target['name'], 'ok': False})
    return {'ok': False, 'targets': evidence}


def select_targets(rounds):
    rounds = max(1, min(int(rounds), len(FOREIGN_TARGETS)))
    return random.SystemRandom().sample(list(FOREIGN_TARGETS), rounds)


def check(node, binary, targets=None):
    """Run local Xray, then make application-level HTTPS requests through its loopback inbound."""
    port = node['port']
    selected = targets or select_targets(1)
    with tempfile.TemporaryDirectory(prefix='lisa-proxy-probe-') as directory:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            local_port = sock.getsockname()[1]
        outbound = {
            'protocol': 'vless',
            'settings': {
                'vnext': [{
                    'address': node['server'],
                    'port': port,
                    'users': [{
                        'id': node['uuid'],
                        'encryption': 'none',
                        'flow': 'xtls-rprx-vision',
                    }],
                }],
            },
            'streamSettings': {
                'network': 'tcp',
                'security': 'reality',
                'realitySettings': {
                    'serverName': node['serverName'],
                    'fingerprint': 'chrome',
                    'publicKey': node['publicKey'],
                    'shortId': node['shortId'],
                },
            },
        }
        path = Path(directory) / 'config.json'
        path.write_text(json.dumps({
            'log': {'loglevel': 'none'},
            'inbounds': [{'listen': '127.0.0.1', 'port': local_port, 'protocol': 'http'}],
            'outbounds': [outbound],
        }))
        path.chmod(0o600)
        process = None
        try:
            process = subprocess.Popen(
                [str(binary), 'run', '-config', str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(40):
                if process.poll() is not None:
                    return {'port': port, 'ok': False, 'reason': 'probe_client_exited', 'targets': []}
                try:
                    with socket.create_connection(('127.0.0.1', local_port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.05)
            else:
                return {'port': port, 'ok': False, 'reason': 'probe_client_exited', 'targets': []}

            evidence = []
            for target in selected:
                try:
                    code, status, ssl_result, body = curl(
                        target['url'],
                        f'http://127.0.0.1:{local_port}',
                    )
                    ok = code == 0 and response_matches(target, status, ssl_result, body)
                    evidence.append({
                        'target': target['name'],
                        'ok': ok,
                        'http_status': status,
                        'ssl_verify_result': ssl_result,
                    })
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    evidence.append({'target': target['name'], 'ok': False})
            ok = all(item['ok'] for item in evidence)
            return {
                'port': port,
                'ok': ok,
                'reason': 'proxy_https_verified' if ok else 'proxy_https_failed',
                'targets': evidence,
            }
        except (OSError, subprocess.SubprocessError):
            return {'port': port, 'ok': False, 'reason': 'probe_execution_failed', 'targets': []}
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)


def main(argv):
    config_path = Path(argv[1]) if len(argv) > 1 and argv[1] != '--report' else Path(
        os.environ.get('LISA_PROBE_CONFIG') or Path.home() / '.config/wechat-assistant/lisa-probe.json'
    )
    if len(argv) > 1 and argv[1] == '--report':
        config_path = Path(argv[2])
        rounds = int(argv[3]) if len(argv) > 3 else 1
        config = json.loads(config_path.read_text())
        domestic = domestic_access()
        results = []
        if domestic['ok']:
            probe_binary = Path.home() / '.local/lib/lisa-monitor/xray'
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(
                    lambda node: check(node, probe_binary, select_targets(rounds)),
                    config['proxies'],
                ))
        print(json.dumps({'domestic': domestic, 'results': results}, ensure_ascii=False))
        return
    config = json.loads(config_path.read_text())
    probe_binary = Path.home() / '.local/lib/lisa-monitor/xray'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda node: check(node, probe_binary), config['proxies']))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main(sys.argv)
    except Exception:
        print(json.dumps({'error': 'LISA_PROBE_FAILED'}))
        sys.exit(1)
