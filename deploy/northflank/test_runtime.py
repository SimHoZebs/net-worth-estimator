import importlib.util
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("runtime", Path(__file__).with_name("runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.provider = MagicMock()
        self.api = MagicMock()
        self.provider.poll.return_value = None
        self.api.poll.return_value = None
        self.handlers = {}

    def signal(self, signum, handler):
        self.handlers[signum] = handler

    def test_ready_provider_then_api_and_graceful_shutdown(self):
        health = MagicMock()
        health.__enter__.return_value.status = 200

        def launch(args):
            if args == ["/app/api-boot.sh"]:
                self.handlers[runtime.signal.SIGTERM](None, None)
                return self.api
            return self.provider

        with patch.object(runtime.signal, "signal", self.signal), \
             patch.object(runtime.subprocess, "Popen", side_effect=launch) as popen, \
             patch.object(runtime.urllib.request, "urlopen", return_value=health):
            self.assertEqual(runtime.run(), 0)
        self.assertEqual(popen.call_count, 2)
        self.provider.terminate.assert_called_once()
        self.api.terminate.assert_called_once()
        self.provider.wait.assert_called_once()
        self.api.wait.assert_called_once()

    def test_provider_startup_failure_never_starts_api(self):
        self.provider.poll.return_value = 1
        with patch.object(runtime.signal, "signal"), \
             patch.object(runtime.subprocess, "Popen", return_value=self.provider) as popen:
            with self.assertRaisesRegex(RuntimeError, "during startup"):
                runtime.run()
        self.assertEqual(popen.call_count, 1)

    def test_api_exit_stops_provider_and_reports_failure(self):
        health = MagicMock()
        health.__enter__.return_value.status = 200
        self.api.poll.return_value = 0
        self.api.returncode = 0
        with patch.object(runtime.signal, "signal"), \
             patch.object(runtime.subprocess, "Popen", side_effect=[self.provider, self.api]), \
             patch.object(runtime.urllib.request, "urlopen", return_value=health):
            with self.assertRaisesRegex(RuntimeError, "child exited"):
                runtime.run()
        self.provider.terminate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
