"""Exercise the workflow's actual shell block with a fake gh command."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/release.yml"
SCRIPT = WORKFLOW.read_text(encoding="utf-8").split("        run: |\n", 1)[1]
SCRIPT = "\n".join(line[10:] for line in SCRIPT.splitlines())
MOCK = r'''
gh() {
  if [[ "$1" == api ]]; then
    if [[ "${API_FAIL:-}" == yes ]]; then return 42; fi
    printf '%s\n' "${TAGS:-}"
  elif [[ "$2" == view ]]; then
    printf '%s\n' "${ASSETS:-}"
  elif [[ "$2" == create ]]; then
    printf 'CREATE %s\n' "$3"
  elif [[ "$2" == upload ]]; then
    printf 'UPLOAD %s\n' "$4"
  else
    return 43
  fi
}
'''


class ReleaseTests(unittest.TestCase):
    def run_release(self, **settings):
        with tempfile.TemporaryDirectory() as temp:
            assets = Path(temp) / "dist"
            assets.mkdir()
            (assets / "app.zip").write_bytes(b"fixture")
            env = dict(os.environ, GITHUB_REPOSITORY="owner/repo", GITHUB_REF_NAME="v1", **settings)
            return subprocess.run(["bash", "-s"], input=MOCK + SCRIPT,
                                  cwd=temp, env=env, text=True, capture_output=True)

    def test_first_release(self):
        result = self.run_release(TAGS="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CREATE v1", result.stdout)
        self.assertIn("UPLOAD dist/app.zip", result.stdout)

    def test_existing_asset_is_preserved(self):
        result = self.run_release(TAGS="v0\nv1\nv2", ASSETS="app.zip")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("CREATE", result.stdout)
        self.assertNotIn("UPLOAD", result.stdout)
        self.assertIn("Already published", result.stdout)

    def test_partial_release_adds_missing_asset(self):
        result = self.run_release(TAGS="v1", ASSETS="other.zip")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("CREATE", result.stdout)
        self.assertIn("UPLOAD dist/app.zip", result.stdout)

    def test_api_failure_stops_publication(self):
        result = self.run_release(API_FAIL="yes")
        self.assertEqual(result.returncode, 42)
        self.assertNotIn("CREATE", result.stdout)
        self.assertNotIn("UPLOAD", result.stdout)


if __name__ == "__main__":
    unittest.main()
