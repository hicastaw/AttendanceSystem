"""One-shot read-only outbox/pipeline monitor; exit 2 means operator attention.

No automatic requeue/recovery and no identities, payloads, embeddings or raw errors.
Pipeline URL is opt-in, loopback-only; readiness semantics remain owned by worker.
"""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit


def outbox_diagnostics(path,*,now=None,max_pending_age=300):
    if not 0<max_pending_age<=86400:raise ValueError('Invalid monitoring age limit')
    path=Path(path).resolve()
    if not path.is_file():raise FileNotFoundError('Explicit existing outbox required')
    now=time.time() if now is None else now
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=.25)) as db:
        if db.execute('PRAGMA user_version').fetchone()[0]!=2:raise ValueError('Expected outbox schema v2')
        counts=dict(db.execute('SELECT status,count(*) FROM events GROUP BY status'))
        oldest=db.execute("SELECT min(created_at) FROM events WHERE status IN ('pending','blocked')").fetchone()[0]
        attempts=db.execute("SELECT coalesce(max(attempts),0) FROM events WHERE status IN ('pending','blocked')").fetchone()[0]
    age=max(0,now-oldest) if oldest is not None else None
    warnings=[]
    if counts.get('blocked',0):warnings.append('OUTBOX_BLOCKED_OPERATOR_ACTION_REQUIRED')
    if age is not None and age>max_pending_age:warnings.append('OUTBOX_OLDEST_UNDELIVERED_TOO_OLD')
    return dict(counts=counts,oldest_undelivered_age_seconds=age,max_undelivered_attempts=attempts,warnings=warnings)


def pipeline_diagnostics(url):
    import requests
    parsed=urlsplit(url)
    if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost','::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Explicit plain HTTP loopback health URL required, no credentials')
    # Never inherit proxies/cookies; no redirects from trusted loopback to remote.
    with requests.Session() as session:
        session.trust_env=False
        response=session.get(url,timeout=(1,2),allow_redirects=False,stream=True)
        try:
            if response.status_code not in (200,503):raise ValueError('Unexpected worker health status')
            data=bytearray()
            for chunk in response.iter_content(4096):
                data.extend(chunk)
                if len(data)>65536:raise ValueError('Health response too large')
            body=json.loads(data)
        finally:response.close()
    if not isinstance(body,dict):raise ValueError('Expected worker health object')
    # Whitelist only operational values and types, never echo untrusted text.
    flags={name:body.get(name) is True for name in ('ready','camera_opened','model_loaded','storage_ok','frame_fresh','inference_fresh')}
    warnings=[name.upper()+'_FALSE' for name,value in flags.items() if not value]
    return dict(**flags,warnings=warnings)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--outbox',type=Path,required=True);parser.add_argument('--health-url')
    parser.add_argument('--max-pending-age',type=float,default=300)
    args=parser.parse_args()
    try:
        result=dict(outbox=outbox_diagnostics(args.outbox,max_pending_age=args.max_pending_age))
        if args.health_url:result['pipeline']=pipeline_diagnostics(args.health_url)
        warnings=[warning for item in result.values() for warning in item['warnings']]
        result.update(status='ATTENTION_REQUIRED' if warnings else 'PASS_OBSERVED_CHECKS',exit_code=2 if warnings else 0)
    except Exception as exc:result=dict(status='DIAGNOSTIC_ERROR',error=type(exc).__name__,exit_code=2)
    print(json.dumps(result,indent=2));raise SystemExit(result['exit_code'])


if __name__=='__main__':main()
