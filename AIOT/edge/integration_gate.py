"""Release preparation only. No flag can activate R50 in the live worker yet."""
import hashlib
import json
import os
import re

FLAG='AIOT_R50_MODE'
REQUIRED_GATES=('checkpoint_export_provenance','weights_license_approved','preprocessing_verified',
                'real_image_smoke','identity_disjoint_calibration','hef_metadata','hef_cpu_parity',
                'target_hardware','gallery_reenrollment','backend_enrollment_contract','owner_release_approval')


def candidate_contract_id(contract):
    payload={key:value for key,value in contract.items() if key!='contract_id'}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,allow_nan=False).encode()).hexdigest()


def validate_candidate_contract(contract):
    if not isinstance(contract,dict) or type(contract.get('schema')) is not int or contract['schema'] not in (1,2):raise ValueError('Unsupported candidate contract schema')
    if contract.get('mode')!='experimental-cpu-only' or contract.get('production_approved') is not False:
        raise ValueError('Only unactivated experimental candidate contracts accepted')
    if type(contract.get('dimension')) is not int or contract['dimension']!=512:raise ValueError('Expected 512-D candidate space')
    for name in ('detector_sha256','recognizer_sha256'):
        if not isinstance(contract.get(name),str) or not re.fullmatch('[0-9a-f]{64}',contract[name]):raise ValueError('Expected artifact SHA-256')
    for name in ('preprocess_id','alignment_id','numeric_mode'):
        if not isinstance(contract.get(name),str) or not contract[name]:raise ValueError('Incomplete candidate contract')
    if contract.get('contract_id')!=candidate_contract_id(contract):raise ValueError('Candidate contract digest mismatch')
    return contract


def mode(environ=None):
    value=(os.environ if environ is None else environ).get(FLAG,'disabled')
    if value not in ('disabled','shadow','production'):raise ValueError('AIOT_R50_MODE must be disabled/shadow/production')
    return value


def guard_legacy_entrypoint(environ=None):
    if mode(environ)!='disabled':
        raise ValueError('R50 activation is not implemented in the production worker; use isolated shadow tooling. No fallback.')


def readiness(contract,gates):
    validate_candidate_contract(contract)
    if not isinstance(gates,dict):raise ValueError('Expected explicit release evidence gates')
    unknown=set(gates)-set(REQUIRED_GATES)
    if unknown:raise ValueError('Unknown release evidence gate')
    # Strict bool: strings/numbers cannot silently satisfy a release gate.
    missing=[key for key in REQUIRED_GATES if gates.get(key) is not True]
    return dict(status='BLOCKED' if missing else 'EVIDENCE_COMPLETE_REVIEW_REQUIRED',blocked_gates=missing,
                contract_id=contract['contract_id'],production_activation_available=False,
                production_activated=False)
