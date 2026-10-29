"""Pinned legacy contract. R50 must have a new manifest and new enrollment."""
import hashlib
import json
from pathlib import Path

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / 'embedding-contract.json').read_text(encoding='utf-8'))
LEGACY_CONTRACT = MANIFEST['legacy']
MOCK_CONTRACT = MANIFEST['mock']


def verify_legacy_model(path):
    path = Path(path)
    expected = MANIFEST['sha256'].get(path.name)
    if expected is None or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError('Model checksum mismatch; refusing legacy embedding space')


def validate_backend(name):
    from integration_gate import guard_legacy_entrypoint
    guard_legacy_entrypoint()
    if name not in ('cv2dnn', 'remote'):
        raise ValueError('Unsupported backend; Hailo requires a verified adapter. No automatic fallback.')
    return name
