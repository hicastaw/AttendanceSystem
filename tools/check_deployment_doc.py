"""Read-only consistency checks for the deployment handbook (stdlib only)."""
from pathlib import Path
import re
import sys

DOCUMENT = Path(__file__).resolve().parents[1] / "docs/RASPBERRY_PI5_ATTENDANCE_A_TO_Z.md"


def check_document(path=DOCUMENT):
    source = path.read_text(encoding="utf-8")
    errors = []
    anchors = re.findall(r'<a id="([^"]+)"', source)
    if len(anchors) != len(set(anchors)):
        errors.append("Duplicate explicit anchor")
    fences = re.findall(r"^```[^\n]*$", source, re.M)
    if len(fences) % 2:
        errors.append("Unbalanced code fences")
    phases = re.findall(r"^## Phase (\d+)\b", source, re.M)
    if phases != [str(index) for index in range(22)]:
        errors.append(f"Expected ordered Phases 0..21; found {phases}")
    for target in re.findall(r"\[[^\]\n]+\]\(([^\s)]+)\)", source):
        if target.startswith(("https://", "http://", "mailto:")):
            continue  # External URLs were checked with official-source research, not this tool.
        file_name, _, fragment = target.partition("#")
        linked = (path.parent / file_name).resolve() if file_name else path
        if not linked.is_file():
            errors.append(f"Missing linked file: {target}")
        elif fragment:
            linked_source = linked.read_text(encoding="utf-8")
            if f'id="{fragment}"' not in linked_source:
                errors.append(f"Missing explicit anchor: {target}")
    sections = re.split(r"(?=^### STEP )", source, flags=re.M)[1:]
    fields = ("Mục tiêu", "Chạy ở đâu", "Điều kiện", "Thao tác", "Code/command",
              "Kết quả mong đợi", "Cách kiểm tra", "Nếu lỗi", "Rollback", "Checkpoint")
    for section in sections:
        heading = section.splitlines()[0]
        for field in fields:
            if f"**{field}" not in section:
                errors.append(f"{heading}: missing {field}")
    if source.count("```mermaid") < 3:
        errors.append("Expected architecture, inference and attendance Mermaid diagrams")
    return {"phases": len(phases), "steps": len(sections),
            "fenced_blocks": len(fences) // 2, "anchors": len(anchors), "errors": errors}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    report = check_document()
    for key, value in report.items():
        print(f"{key}: {value}")
    sys.exit(bool(report["errors"]))
