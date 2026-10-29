"""Report release blockers from an isolated smoke report; never enable production."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from integration_gate import readiness,mode
from model_cpu_lab import lab_path


def check(path,environ=None):
    path=lab_path(path)
    if path.stat().st_size>1_000_000:raise ValueError('Smoke report too large')
    report=json.loads(path.read_text(encoding='utf-8'));contract=report['contract']
    # Evidence booleans are informational, not authorization. Even a complete
    # report cannot enable a live backend; production dispatcher is unavailable.
    gates=dict(real_image_smoke=report.get('status')=='PASS_REAL_IMAGE_SMOKE_ONLY')
    # Published mean/std is not proof of the complete crop/alignment/export
    # boundary, nor CPU/HEF parity. No URL/filename automatically clears it.
    result=readiness(contract,gates)
    result.update(requested_mode=mode(environ),evidence_scope='LOCAL_REPORT_NOT_SIGNED_RELEASE_APPROVAL')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('smoke_report',type=Path)
    args=parser.parse_args();result=check(args.smoke_report)
    print(json.dumps(result,indent=2));raise SystemExit(2 if result['blocked_gates'] else 0)
