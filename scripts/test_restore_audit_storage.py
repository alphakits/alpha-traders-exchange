import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore_audit_storage', Path(__file__).with_name('restore-audit-storage.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RecoveryBoundaries(unittest.TestCase):
    def manifest(self):
        return [{'bucket_id': 'admin-media', 'name': f'fixture-{i}.bin',
                 'metadata': {'size': 2724591047 if i == 17 else 0,
                              'eTag': 'd41d8cd98f00b204e9800998ecf8427e',
                              'mimetype': 'application/octet-stream'}} for i in range(18)]

    def test_cannot_upload_to_production(self):
        with patch.object(restore.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Production writes'):
                restore.transfer(restore.SOURCE, self.manifest()[0], Path('/unused'), upload=Path('/unused'))
            run.assert_not_called()

    def test_rejects_unexpected_buckets_paths_duplicates_and_headers(self):
        for field, value in [('bucket_id', 'unknown'), ('name', '../secret'), ('name', '/absolute'),
                             ('name', 'nested/../secret'), ('name', 'nested//secret')]:
            manifest = self.manifest()
            manifest[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                restore.validate(manifest)
        for field in ['mimetype', 'cacheControl']:
            manifest = self.manifest()
            manifest[0]['metadata'][field] = 'text/plain\r\nInjected: yes'
            with self.assertRaisesRegex(ValueError, 'headers'):
                restore.validate(manifest)
        manifest = self.manifest()
        manifest[1]['name'] = manifest[0]['name']
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            restore.validate(manifest)

    def test_rejects_expanded_manifest(self):
        manifest = self.manifest()
        manifest[17]['metadata']['size'] += 1
        with self.assertRaisesRegex(ValueError, 'total'):
            restore.validate(manifest)

    def test_credential_scope_checked_before_headers_written(self):
        with tempfile.TemporaryDirectory() as directory:
            key, output = Path(directory)/'key', Path(directory)/'headers'
            claims = base64.urlsafe_b64encode(json.dumps({'ref': restore.SOURCE, 'role': 'service_role'}).encode()).decode()
            key.write_text('eyJtest.' + claims + '.synthetic')
            with self.assertRaisesRegex(ValueError, 'Wrong key scope'):
                restore.headers(key, output, restore.TARGET)
            self.assertFalse(output.exists())

    def test_verify_only_never_reads_source_or_uploads_missing_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, report = Path(directory)/'manifest.json', Path(directory)/'report.json'
            manifest.write_text(json.dumps(self.manifest()))
            argv = ['restore', '--manifest', str(manifest), '--report', str(report),
                    '--target-key-file', 'synthetic-target', '--verify-only']
            with patch.object(restore, 'headers') as credentials, patch.object(restore, 'transfer', return_value=404) as transfer, \
                 patch('sys.argv', argv), patch('builtins.print'):
                self.assertEqual(restore.main(), 1)
            self.assertEqual(credentials.call_count, 1)
            self.assertEqual(credentials.call_args.args[2], restore.TARGET)
            self.assertEqual(transfer.call_count, 18)
            for call in transfer.call_args_list:
                self.assertEqual(call.args[0], restore.TARGET)
                self.assertNotIn('upload', call.kwargs)
                self.assertEqual(len(call.args), 4)
            self.assertEqual(json.loads(report.read_text())['status'], 'INCOMPLETE')

    def test_explicit_subset_excludes_all_other_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest, report = Path(directory)/'manifest.json', Path(directory)/'report.json'
            manifest.write_text(json.dumps(self.manifest()))
            argv = ['restore', '--manifest', str(manifest), '--report', str(report),
                    '--target-key-file', 'synthetic-target', '--verify-only', '--indices', '16,17']
            with patch.object(restore, 'headers'), patch.object(restore, 'transfer', return_value=404) as transfer, \
                 patch('sys.argv', argv), patch('builtins.print'):
                self.assertEqual(restore.main(), 1)
            self.assertEqual([c.args[1]['name'] for c in transfer.call_args_list], ['fixture-16.bin','fixture-17.bin'])
            evidence = json.loads(report.read_text())
            self.assertEqual(evidence['selectedObjects'], 2)
            self.assertEqual([x['index'] for x in evidence['objects']], [16,17])

    def test_invalid_subset_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory)/'manifest.json'
            manifest.write_text(json.dumps(self.manifest()))
            for selection in ['-1','18','11,11']:
                argv = ['restore', '--manifest', str(manifest), '--report', str(Path(directory)/'report.json'), '--indices', selection]
                with self.subTest(selection=selection), patch('sys.argv', argv), patch.object(restore, 'transfer') as transfer:
                    with self.assertRaises(ValueError):restore.main()
                    transfer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
