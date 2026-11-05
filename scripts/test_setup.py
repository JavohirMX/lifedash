"""Setup command tests use fake subprocesses only, never Docker."""
import importlib.util
from pathlib import Path
import unittest
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
                ['docker', 'compose', 'version'], ['docker', 'info'], [*setup.COMPOSE, 'config', '--quiet']])

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
            self.assertEqual(run.call_args.args[0], [*setup.COMPOSE, 'up', '-d', '--build'])

    def test_success_probes_selected_compose_container_not_host(self):
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run:
            run.return_value.returncode = 0
            self.assertEqual(setup.main([]), 0)
            self.assertEqual(run.call_count, 3)
            self.assertEqual(run.call_args_list[1].args[0], [*setup.COMPOSE, 'exec', '-T', 'sync', 'python', '-c', setup.HEALTH])
            self.assertEqual(run.call_args.args[0], [*setup.COMPOSE, 'exec', '-T', 'app', 'sh', '-c', setup.APP_HEALTH])

    def test_container_health_failure_is_not_masked_by_host_service(self):
        # No host URL request exists: even an unrelated host :8787 returning OK
        # cannot make this failing container probe succeed.
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run, patch.object(setup.time, 'monotonic', side_effect=[0, 31]):
            from types import SimpleNamespace
            run.side_effect = [SimpleNamespace(returncode=0), SimpleNamespace(returncode=1)]
            self.assertEqual(setup.main([]), 1)
            self.assertEqual(run.call_count, 2)
            self.assertIn('exec', run.call_args.args[0])

    def test_failed_app_probe_does_not_claim_stack_ready(self):
        from types import SimpleNamespace
        from io import StringIO
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run, patch.object(setup.time, 'monotonic', side_effect=[0, 0, 31]), patch('sys.stdout', new_callable=StringIO) as out:
            run.side_effect = [SimpleNamespace(returncode=0), SimpleNamespace(returncode=0), SimpleNamespace(returncode=1)]
            self.assertEqual(setup.main([]), 1)
            self.assertIn('app service health not confirmed', out.getvalue())
            self.assertNotIn('Both Compose services respond internally', out.getvalue())
            self.assertEqual(run.call_args.args[0][6], 'app')

    def test_app_timeout_can_recover_without_restarting_services(self):
        from types import SimpleNamespace
        with patch.object(setup, 'check', return_value=True), patch.object(setup.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'), patch.object(setup.subprocess, 'run') as run, patch.object(setup.time, 'monotonic', return_value=0), patch.object(setup.time, 'sleep'):
            run.side_effect = [SimpleNamespace(returncode=0), SimpleNamespace(returncode=0), setup.subprocess.TimeoutExpired('probe', 5), SimpleNamespace(returncode=0)]
            self.assertEqual(setup.main([]), 0)
            self.assertEqual(sum('up' in c.args[0] for c in run.call_args_list), 1)
            self.assertEqual(run.call_args_list[2].args[0], run.call_args_list[3].args[0])

    def test_app_probe_targets_internal_http_and_app_marker(self):
        self.assertIn('http://127.0.0.1/', setup.APP_HEALTH)
        self.assertIn('<title>Lifedash</title>', setup.APP_HEALTH)
        self.assertIn('-T 2', setup.APP_HEALTH)

    def test_explicit_file_excludes_compose_file_and_implicit_overrides(self):
        self.assertEqual(setup.COMPOSE, ['docker', 'compose', '-f', str(setup.ROOT / 'docker-compose.yml')])

    def test_nondefault_host_ports_do_not_change_internal_probe(self):
        # No host mapping or hardcoded host service is used for health.
        self.assertIn('127.0.0.1:8787/api/health', setup.HEALTH)
        self.assertIn('python', [*setup.COMPOSE, 'exec', '-T', 'sync', 'python', '-c', setup.HEALTH])


if __name__ == '__main__':
    unittest.main()
