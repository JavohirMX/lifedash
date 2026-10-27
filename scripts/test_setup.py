"""Setup command tests use fake subprocesses only, never Docker."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('lifedash_setup', Path(__file__).with_name('setup.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_missing_docker_no_subprocess(self):
        with patch.object(setup.shutil, 'which', return_value=None), patch.object(setup.subprocess, 'run') as run:
            self.assertEqual(setup.main(['--check']), 1)
            run.assert_not_called()

    def test_check_never_starts_stack(self):
        with patch.object(setup.shutil, 'which', return_value='/fake/docker'), patch.object(setup.subprocess, 'run') as run:
            run.return_value.returncode = 0
            self.assertEqual(setup.main(['--check']), 0)
            self.assertEqual([c.args[0] for c in run.call_args_list], [
                ['docker', 'compose', 'version'], ['docker', 'info'], ['docker', 'compose', 'config', '--quiet']])

    def test_failed_preflight_stops(self):
        with patch.object(setup.shutil, 'which', return_value='/fake/docker'), patch.object(setup.subprocess, 'run') as run:
            run.return_value.returncode = 1
            self.assertEqual(setup.main(['--check']), 1)
            self.assertEqual(run.call_count, 1)

    def test_noninteractive_no_start(self):
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=False), patch.object(setup.subprocess, 'run') as run:
            self.assertEqual(setup.main([]), 1)
            run.assert_not_called()

    def test_decline_no_start(self):
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='n'), patch.object(setup.subprocess, 'run') as run:
            self.assertEqual(setup.main([]), 0)
            run.assert_not_called()

    def test_failed_start_does_not_claim_ready(self):
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='y'), patch.object(setup.subprocess, 'run') as run:
            run.return_value.returncode = 1
            self.assertEqual(setup.main([]), 1)
            self.assertEqual(run.call_args.args[0], ['docker', 'compose', 'up', '-d', '--build'])

    def test_success_checks_health_and_no_extra_commands(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.read.return_value = b'{"ok":true}'
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run, patch.object(setup.urllib.request, 'urlopen', return_value=response):
            run.return_value.returncode = 0
            self.assertEqual(setup.main([]), 0)
            self.assertEqual(run.call_count, 1)

    def test_health_timeout_fails_without_stopping_services(self):
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run, patch.object(setup.urllib.request, 'urlopen', side_effect=OSError), patch.object(setup.time, 'monotonic', side_effect=[0, 31]):
            run.return_value.returncode = 0
            self.assertEqual(setup.main([]), 1)
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
