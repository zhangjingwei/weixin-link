import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('lisaprobe', 'src/integrations/monitoring/lisa-proxy-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeTest(unittest.TestCase):
    def test_target_validation_requires_status_certificate_and_marker(self):
        target = {'statuses': {204}, 'marker': ''}
        self.assertTrue(probe.response_matches(target, 204, 0, ''))
        self.assertFalse(probe.response_matches(target, 200, 0, ''))
        self.assertFalse(probe.response_matches(target, 204, 1, ''))
        self.assertFalse(probe.response_matches({'statuses': {200}, 'marker': 'loc='}, 200, 0, 'blocked'))

    def test_multi_target_confirmation_uses_distinct_known_targets(self):
        selected = probe.select_targets(2)
        self.assertEqual(len(selected), 2)
        self.assertEqual(len({item['name'] for item in selected}), 2)
        self.assertTrue(all(item in probe.FOREIGN_TARGETS for item in selected))


if __name__ == '__main__':
    unittest.main()
