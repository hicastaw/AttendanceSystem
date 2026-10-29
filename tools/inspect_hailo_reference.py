"""Read-only HEF validation; requires genuine HailoRT metadata, no guessed bindings."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'AIOT/edge'))
from experimental_hailo import inspect_hef

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('hef',type=Path)
    args=parser.parse_args()
    try:print(json.dumps(inspect_hef(args.hef),indent=2))
    except (RuntimeError,ImportError) as exc:
        print(json.dumps(dict(status='BLOCKED_RUNTIME',reason=str(exc),hardware_status='BLOCKED_HARDWARE',production_approved=False)))
        raise SystemExit(2) from None
