#!/usr/bin/env python3
"""Resume the approved, bounded October 18 recovery; never write production.

Keys are read from private files, never placed in command arguments or reports.
The input is the retained storage.objects manifest. Every restored object is
downloaded in full and checked against both the manifest and source bytes.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote
from datetime import datetime, timezone

SOURCE = 'pihtougaocftqvcfcdhj'
TARGET = 'yepfxqntsjeavpplwqwt'
BUCKETS = {'admin-media', 'course-videos', 'journal-charts'}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def timestamp():
    return datetime.now(timezone.utc).isoformat()

def digest(path):
    h = hashlib.md5()
    size = 0
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
            size += len(chunk)
    return size, h.hexdigest()

def validate(manifest):
    seen = set()
    for item in manifest:
        bucket, name, meta = item['bucket_id'], item['name'], item['metadata']
        require(bucket in BUCKETS and name and not name.startswith('/'), 'Invalid bucket or path')
        require(not any(part in ('.', '..', '') for part in name.split('/')), 'Unsafe object path')
        require((bucket, name) not in seen, 'Duplicate object path')
        seen.add((bucket, name))
        require(type(meta['size']) is int and meta['size'] >= 0, 'Invalid object size')
        require(re.fullmatch('[0-9a-f]{32}', meta['eTag'].strip('"')), 'Invalid object checksum')
        require(not any(c in meta['mimetype'] + meta.get('cacheControl', '') for c in '\r\n'), 'Invalid object headers')
    require(len(manifest) == 18, 'Unexpected manifest count')
    require(sum(i['metadata']['size'] for i in manifest) == 2724591047, 'Unexpected manifest total')

def headers(key_path, destination, project):
    key = Path(key_path).read_text().strip()
    require(key.startswith('eyJ') and not any(c in key for c in '\r\n'), 'Invalid credential format')
    claims = json.loads(base64.urlsafe_b64decode(key.split('.')[1] + '==='))
    require(claims.get('ref') == project and claims.get('role') == 'service_role', 'Wrong key scope')
    destination.write_text(f'apikey: {key}\nAuthorization: Bearer {key}\n')
    destination.chmod(0o600)

def transfer(project, item, output, header_file=None, upload=None, public=False):
    # Credentials are never forwarded to redirects or a different service.
    encoded = quote(item['name'], safe='/')
    route = 'object' if upload is not None else ('object/public' if public else 'object/authenticated')
    require(project in (SOURCE, TARGET), 'Unexpected project')
    url = f'https://{project}.supabase.co/storage/v1/{route}/{item["bucket_id"]}/{encoded}'
    args = ['curl', '--silent', '--show-error', '--proto', '=https', '--connect-timeout', '20',
            '--max-time', '1200', '--output', str(output), '--write-out', '%{http_code}', url]
    if header_file:
        args += ['--header', '@' + str(header_file)]
    if upload is not None:
        require(project == TARGET and project != SOURCE, 'Production writes are forbidden')
        args += ['--request', 'POST', '--upload-file', str(upload), '--header', 'x-upsert: true',
                 '--header', 'Content-Type: ' + item['metadata']['mimetype'],
                 '--header', 'Cache-Control: ' + item['metadata'].get('cacheControl', 'max-age=3600')]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'Transfer failed: curl {result.returncode}; response not logged')
    return int(result.stdout)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--source-key-file')
    parser.add_argument('--target-key-file')
    parser.add_argument('--report', required=True)
    parser.add_argument('--cache-dir', help='Private directory for checksum-validated source downloads across interruptions')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--verify-only', action='store_true', help='Read recovered bytes only; never upload or read source')
    parser.add_argument('--indices', help='Optional comma-separated manifest indices for an explicitly approved subset')
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text())
    validate(manifest)
    selected = list(range(len(manifest))) if args.indices is None else [int(v) for v in args.indices.split(',')]
    require(selected and len(selected) == len(set(selected)), 'Empty or duplicate selection')
    require(all(0 <= i < len(manifest) for i in selected), 'Selection outside manifest')
    report = {'sourceProject': SOURCE, 'recoveryProject': TARGET, 'totalObjects': len(manifest),
              'expectedBytes': sum(i['metadata']['size'] for i in manifest),
              'selectedIndices': selected, 'selectedObjects': len(selected),
              'selectedBytes': sum(manifest[i]['metadata']['size'] for i in selected), 'objects': []}
    require(not (args.apply and args.verify_only), 'Choose apply or verify-only, never both')
    if not args.apply and not args.verify_only:
        print(json.dumps({**report, 'mode': 'manifest-validation-only'}))
        return
    require(args.target_key_file and (args.verify_only or args.source_key_file), 'Required credential file missing')
    report['mode'] = 'verify-only' if args.verify_only else 'restore'
    os.umask(0o077)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='alpha-recovery-') as directory:
        root = Path(directory)
        source_headers, target_headers = root/'source.headers', root/'target.headers'
        if not args.verify_only:
            headers(args.source_key_file, source_headers, SOURCE)
        headers(args.target_key_file, target_headers, TARGET)
        cache = Path(args.cache_dir) if args.cache_dir else root
        cache.mkdir(mode=0o700, parents=True, exist_ok=True)
        for index, item in enumerate(manifest):
            if index not in selected:
                continue
            expected = (item['metadata']['size'], item['metadata']['eTag'].strip('"'))
            source_file, target_file = cache/(expected[1]+'.bin'), root/'target.bin'
            record = {'index': index, 'bucket': item['bucket_id'], 'objectPathHash': hashlib.sha256(item['name'].encode()).hexdigest(),
                      'bytes': expected[0], 'md5': expected[1], 'status': 'PENDING'}
            report['objects'].append(record)
            report['updatedAt'] = timestamp()
            report_path.write_text(json.dumps(report, indent=2))
            print(json.dumps({'index': index, 'stage': 'checking-recovered-bytes', 'bytes': expected[0]}), flush=True)
            try:
                current_status = transfer(TARGET, item, target_file, target_headers)
                if current_status == 200 and digest(target_file) == expected:
                    record.update(status='PASS', action='already-recovered')
                else:
                    require(not args.verify_only, f'Recovered bytes unavailable or mismatched (HTTP {current_status})')
                    require(current_status in (200, 400, 404), f'Unexpected recovery GET: {current_status}')
                    if not source_file.exists() or digest(source_file) != expected:
                        print(json.dumps({'index': index, 'stage': 'downloading-source'}), flush=True)
                        source_status = transfer(SOURCE, item, source_file, source_headers)
                        require(source_status == 200, f'Source GET: {source_status}')
                    require(digest(source_file) == expected, 'Source bytes differ from retained manifest')
                    print(json.dumps({'index': index, 'stage': 'uploading-recovery'}), flush=True)
                    upload_status = transfer(TARGET, item, root/'upload-response.json', target_headers, source_file)
                    require(upload_status in (200, 201), f'Recovery upload: {upload_status}')
                    print(json.dumps({'index': index, 'stage': 'verifying-recovered-download'}), flush=True)
                    verify_status = transfer(TARGET, item, target_file, target_headers)
                    require(verify_status == 200, f'Recovered GET: {verify_status}')
                    require(digest(target_file) == expected, 'Recovered checksum or size mismatch')
                    record.update(status='PASS', action='restored-and-verified')
                if item['bucket_id'] == 'journal-charts':
                    unauth_status = transfer(TARGET, item, root/'private-denial.json')
                    require(unauth_status in (400, 401, 403, 404), 'Unauthenticated private access was not denied')
                    public_status = transfer(TARGET, item, root/'public-denial.json', public=True)
                    require(public_status in (400, 401, 403, 404), 'Public private-bucket access was not denied')
                    record['unauthenticatedAccessDenied'] = True
                    record['publicAccessDenied'] = True
                print(json.dumps(record), flush=True)
            except Exception as error:
                record.update(status='FAIL', error=str(error))
                print(json.dumps(record), flush=True)
                if not args.verify_only:
                    raise
            finally:
                report['updatedAt'] = timestamp()
                report_path.write_text(json.dumps(report, indent=2))
                if record['status'] == 'PASS':
                    source_file.unlink(missing_ok=True)
                target_file.unlink(missing_ok=True)
    report['status'] = 'PASS' if all(r['status'] == 'PASS' for r in report['objects']) else 'INCOMPLETE'
    report_path.write_text(json.dumps(report, indent=2))
    return 0 if report['status'] == 'PASS' else 1

if __name__ == '__main__':
    raise SystemExit(main())
