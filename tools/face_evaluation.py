"""Offline comparison/identification metrics, NOT production calibration.

FAR/FRR denominators are comparisons; FPIR/FNIR denominators are probes.
No threshold is selected, deployed or recommended. Output contains no vectors/IDs.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'AIOT/edge'))
from integration_gate import validate_candidate_contract
from pipeline import normalize,normalized_centroid


def _rate(numerator,denominator):
    return None if denominator==0 else numerator/denominator


def evaluate(dataset,thresholds,*,minimum_margin):
    if not isinstance(dataset,dict) or type(dataset.get('synthetic')) is not bool or type(dataset.get('schema')) is not int or dataset['schema']!=1:
        raise ValueError('Explicit dataset schema and synthetic status required')
    contract=validate_candidate_contract(dataset.get('contract'))
    if not isinstance(thresholds,list) or not 1<=len(thresholds)<=1001 or any(type(t) not in (int,float) or not math.isfinite(t) or not -1<=t<=1 for t in thresholds):
        raise ValueError('Explicit finite threshold sweep required')
    if type(minimum_margin) not in (int,float) or not math.isfinite(minimum_margin) or not 0<=minimum_margin<=2:
        raise ValueError('Explicit finite evaluation margin required')
    enrollment,probes=dataset.get('enrollment'),dataset.get('probes')
    if not isinstance(enrollment,list) or not enrollment or len(enrollment)>10000 or not isinstance(probes,list) or not probes or len(probes)>100000:
        raise ValueError('Bounded nonempty enrollment/probe sets required')
    identities={};sample_ids=set()
    def sample(value):
        if not isinstance(value,dict) or value.get('contract_id')!=contract['contract_id']:
            raise ValueError('Sample model contract mismatch')
        for key in ('sample_id','subject','condition'):
            if not isinstance(value.get(key),str) or not 1<=len(value[key])<=128:raise ValueError('Pseudonymous sample metadata required')
        if value['sample_id'] in sample_ids:raise ValueError('Enrollment/probe overlap or duplicate sample ID')
        sample_ids.add(value['sample_id'])
        raw=value.get('embedding')
        if not isinstance(raw,list) or any(type(x) not in (int,float) for x in raw):raise ValueError('Numeric embedding required')
        return normalize(raw)
    for value in enrollment:
        vector=sample(value)
        identities.setdefault(value['subject'],[]).append(vector)
    if any(not 3<=len(values)<=8 for values in identities.values()):raise ValueError('Enrollment needs 3..8 vectors per identity')
    codes=sorted(identities);gallery=np.asarray([normalized_centroid(identities[code]) for code in codes])
    # Bound comparison work, not just input bytes; never allocate the full NxM matrix.
    if len(probes)*len(codes)*len(thresholds)>10_000_000:raise ValueError('Evaluation comparison budget exceeded')
    groups={}
    def counters():return dict(genuine=0,impostor=0,false_accepts=0,false_rejects=0,known=0,unknown=0,
                               correct_known=0,wrong_known=0,rejected_known=0,accepted_unknown=0)
    groups['all']=[counters() for _ in thresholds]
    for value in probes:
        vector=sample(value);condition=value['condition']
        if condition=='all':raise ValueError('Reserved condition label')
        if condition not in groups:
            if len(groups)>128:raise ValueError('Too many condition groups')
            groups[condition]=[counters() for _ in thresholds]
        scores=np.clip(gallery@vector,-1,1);order=np.argsort(-scores,kind='stable')
        known=value['subject'] in identities
        for i,threshold in enumerate(thresholds):
            accepted=bool(scores[order[0]]>=threshold and (len(codes)==1 or scores[order[0]]-scores[order[1]]>=minimum_margin))
            correct=accepted and codes[order[0]]==value['subject']
            for group in ('all',condition):
                counter=groups[group][i]
                for code,score in zip(codes,scores):
                    genuine=code==value['subject'];counter['genuine' if genuine else 'impostor']+=1
                    counter['false_rejects' if genuine else 'false_accepts']+=int(score<threshold if genuine else score>=threshold)
                counter['known' if known else 'unknown']+=1
                counter['correct_known']+=int(known and correct)
                counter['wrong_known']+=int(known and accepted and not correct)
                counter['rejected_known']+=int(known and not accepted)
                counter['accepted_unknown']+=int(not known and accepted)
    result={}
    for group,rows in groups.items():
        result[group]=[dict(threshold=t,**c,FAR=_rate(c['false_accepts'],c['impostor']),
                           FRR=_rate(c['false_rejects'],c['genuine']),FPIR=_rate(c['accepted_unknown'],c['unknown']),
                           FNIR=_rate(c['wrong_known']+c['rejected_known'],c['known'])) for t,c in zip(thresholds,rows)]
    return dict(schema=1,status='SYNTHETIC_METRICS_ONLY' if dataset['synthetic'] else 'UNVERIFIED_DATASET_METRICS',
                contract_id=contract['contract_id'],minimum_margin=minimum_margin,groups=result,
                accuracy_claim=False,threshold_recommendation=None,production_activated=False,
                limitations='No confidence bounds, identity-disjoint certification or production calibration. Zero denominator => null.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset',type=Path);parser.add_argument('--thresholds',required=True,help='Comma-separated explicit thresholds')
    parser.add_argument('--margin',type=float,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--allow-test-data',action='store_true');parser.add_argument('--rights-note')
    args=parser.parse_args()
    if not args.allow_test_data:parser.error('Explicit --allow-test-data required; never read production galleries')
    from model_cpu_lab import lab_path,write_new
    source=lab_path(args.dataset)
    if source.stat().st_size>64*1024*1024:parser.error('Dataset too large')
    data=json.loads(source.read_text(encoding='utf-8'))
    if data.get('synthetic') is not True and not (args.rights_note and args.rights_note.strip()):
        parser.error('Owner must supply a rights note for non-synthetic evaluation data')
    result=evaluate(data,[float(x) for x in args.thresholds.split(',')],minimum_margin=args.margin)
    write_new(args.output,result)
    print(json.dumps(dict(status=result['status'],accuracy_claim=False,production_activated=False)))


if __name__=='__main__':main()
