"""Read-only installed-version/dependency checks for an explicit AIOT profile."""
import argparse
import importlib.metadata as metadata
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpi_release import ROOT, requirements_profile


def check_environment(profile='tools/requirements-test.txt'):
    from packaging.requirements import Requirement
    selected = requirements_profile(ROOT, profile)
    installed = {re.sub(r'[-_.]+', '-', d.metadata['Name']).lower(): d for d in metadata.distributions()}
    errors = []
    for name, version in selected['requirements'].items():
        if name not in installed:
            errors.append('Missing ' + name)
        elif installed[name].version != version:
            errors.append(f'{name}: installed {installed[name].version}, expected {version}')
    for name, version in selected['constraints'].items():
        if name in installed and installed[name].version != version:
            errors.append(f'Constraint mismatch {name}: {installed[name].version} != {version}')
    for name, distribution in installed.items():
        for raw in distribution.requires or []:
            required = Requirement(raw)
            if required.marker and not required.marker.evaluate({'extra': ''}):
                continue
            target = re.sub(r'[-_.]+', '-', required.name).lower()
            if target not in installed or installed[target].version not in required.specifier:
                errors.append(f'{name} requires {required}')
    return {'status': 'FAIL' if errors else 'PASS', 'profile': profile,
            'direct_requirements': len(selected['requirements']), 'installed_distributions': len(installed),
            'errors': sorted(set(errors))}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default='tools/requirements-test.txt')
    result = check_environment(parser.parse_args().profile)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['status']=='PASS' else 1)
