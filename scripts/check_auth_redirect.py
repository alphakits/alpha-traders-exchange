#!/usr/bin/env python3
"""Check Supabase's production auth fallback without accounts or email delivery.

The request uses a deliberately invalid recovery token. It never follows the
redirect and never sends an account identifier, session, key, or valid token.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit

from production_health import header_blocks

VERIFY_URL = ('https://pihtougaocftqvcfcdhj.supabase.co/auth/v1/verify'
              '?token=alpha-audit-deliberately-invalid-token&type=recovery')
EXPECTED_ORIGIN = 'https://www.alphatraders.co.il'


def evaluate_response(curl_exit, status_code, raw_headers):
    blocks = header_blocks(raw_headers)
    last = blocks[-1] if blocks else {'status': 0, 'headers': {}}
    result = {'status': 'VERIFICATION_LIMITED', 'curlExit': curl_exit,
              'httpStatus': status_code, 'expectedOrigin': EXPECTED_ORIGIN}
    if curl_exit or not status_code or status_code == 429 or status_code >= 500:
        result['reason'] = 'No complete, available authentication response'
        return result
    if last['status'] != status_code:
        result['reason'] = 'Response status and headers do not agree'
        return result
    destination = urlsplit(last['headers'].get('location', ''))
    # Do not preserve redirect query strings/fragments or credentials in evidence.
    result['redirectOrigin'] = f'{destination.scheme}://{destination.hostname or ""}'
    expected = urlsplit(EXPECTED_ORIGIN)
    valid = (status_code == 303 and destination.scheme == expected.scheme
             and destination.netloc == expected.netloc and destination.path in ('', '/'))
    result['status'] = 'PASS' if valid else 'FAIL'
    result['reason'] = ('Invalid recovery link returns to the official website'
                        if valid else 'Unexpected authentication fallback response')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='alpha-auth-redirect-') as directory:
        headers = Path(directory) / 'headers'
        command = ['curl', '--silent', '--show-error', '--proto', '=https',
                   '--connect-timeout', '20', '--max-time', '30', '--dump-header', str(headers),
                   '--output', '/dev/null', '--write-out', '%{http_code}', VERIFY_URL]
        response = subprocess.run(command, capture_output=True, text=True)
        status = int(response.stdout) if response.stdout.isdigit() else 0
        result = evaluate_response(response.returncode, status,
                                   headers.read_text() if headers.exists() else '')
    result['observedAt'] = datetime.now(timezone.utc).isoformat()
    result['scope'] = 'Invalid synthetic recovery token; no account, email, or real token used'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    return {'PASS': 0, 'FAIL': 1, 'VERIFICATION_LIMITED': 2}[result['status']]


if __name__ == '__main__':
    raise SystemExit(main())
